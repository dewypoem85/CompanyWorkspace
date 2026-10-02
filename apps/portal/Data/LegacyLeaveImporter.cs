using CompanyPortal.Models;
using Microsoft.Data.Sqlite;

namespace CompanyPortal.Data;

public sealed record LegacyLeaveImportResult(
    int ImportedUsers,
    int UpdatedUsers,
    int LinkedEmployees,
    string PortalBackupPath,
    string LeaveBackupPath);

public static class LegacyLeaveImporter
{
    public static async Task<LegacyLeaveImportResult> ImportAsync(
        string portalDbPath,
        string leaveDbPath,
        CancellationToken cancellationToken = default)
    {
        portalDbPath = Path.GetFullPath(portalDbPath);
        leaveDbPath = Path.GetFullPath(leaveDbPath);
        if (!File.Exists(portalDbPath))
            throw new FileNotFoundException("Company Portal DB를 찾을 수 없습니다.", portalDbPath);
        if (!File.Exists(leaveDbPath))
            throw new FileNotFoundException("LeaveManager DB를 찾을 수 없습니다.", leaveDbPath);

        var timestamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
        var portalBackupPath = await BackupAsync(portalDbPath, $"pre-leave-import-{timestamp}.db", cancellationToken);
        var leaveBackupPath = await BackupAsync(leaveDbPath, $"pre-portal-link-{timestamp}.db", cancellationToken);

        await using var connection = new SqliteConnection($"Data Source={portalDbPath}");
        await connection.OpenAsync(cancellationToken);
        await using (var attach = connection.CreateCommand())
        {
            attach.CommandText = "ATTACH DATABASE $leaveDbPath AS leaveDb;";
            attach.Parameters.AddWithValue("$leaveDbPath", leaveDbPath);
            await attach.ExecuteNonQueryAsync(cancellationToken);
        }

        await EnsureRoleSchemaAsync(connection, cancellationToken);
        await EnsureOutboxSchemaAsync(connection, cancellationToken);

        await using var transaction = connection.BeginTransaction();
        var employees = new List<LegacyEmployee>();
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = """
                SELECT "Id", lower(trim("Email")), "Name", "Department", "HireDate",
                       "Role", "IsActive", "CompanyUserId"
                FROM leaveDb."Employees"
                ORDER BY "Id";
                """;
            await using var reader = await read.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                employees.Add(new LegacyEmployee(
                    reader.GetInt64(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetString(4),
                    reader.GetInt32(5),
                    reader.GetBoolean(6),
                    reader.IsDBNull(7) ? null : reader.GetInt64(7)));
            }
        }

        var importedUsers = 0;
        var updatedUsers = 0;
        var linkedEmployees = 0;
        foreach (var employee in employees)
        {
            if (string.IsNullOrWhiteSpace(employee.Email))
                throw new InvalidOperationException($"Leave 직원 ID {employee.Id}의 이메일이 비어 있습니다.");

            var portalUser = await FindPortalUserAsync(connection, transaction, employee.Email, cancellationToken);
            if (portalUser is null)
            {
                var permissions = PermissionsForRole(employee.Role);
                var isAdmin = IsAdministratorRole(employee.Role);
                var now = DateTime.UtcNow;
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = """
                    INSERT INTO main."Users"
                        ("Email", "Name", "Department", "HireDate", "IsActive", "IsAdmin", "IsMaster",
                         "Permissions", "CreatedAtUtc", "UpdatedAtUtc")
                    VALUES
                        ($email, $name, $department, $hireDate, $isActive, $isAdmin, 0,
                         $permissions, $now, $now);
                    SELECT last_insert_rowid();
                    """;
                insert.Parameters.AddWithValue("$email", employee.Email);
                insert.Parameters.AddWithValue("$name", employee.Name);
                insert.Parameters.AddWithValue("$department", (object?)employee.Department ?? DBNull.Value);
                insert.Parameters.AddWithValue("$hireDate", employee.HireDate);
                insert.Parameters.AddWithValue("$isActive", employee.IsActive);
                insert.Parameters.AddWithValue("$isAdmin", isAdmin);
                insert.Parameters.AddWithValue("$permissions", permissions);
                insert.Parameters.AddWithValue("$now", now);
                var id = (long)(await insert.ExecuteScalarAsync(cancellationToken)
                    ?? throw new InvalidOperationException("Portal 사용자 ID를 생성하지 못했습니다."));
                portalUser = new PortalUser(id, isAdmin, false, permissions);
                importedUsers++;
            }
            else
            {
                var merged = PermissionCatalog.Normalize(
                    PermissionCatalog.Parse(portalUser.Permissions)
                        .Concat(PermissionCatalog.Parse(PermissionsForRole(employee.Role))));
                var promoteToAdmin = IsAdministratorRole(employee.Role)
                    && !portalUser.IsAdmin
                    && !portalUser.IsMaster;
                if (promoteToAdmin || !string.Equals(merged, portalUser.Permissions, StringComparison.Ordinal))
                {
                    await using var updatePermissions = connection.CreateCommand();
                    updatePermissions.Transaction = transaction;
                    updatePermissions.CommandText = """
                        UPDATE main."Users"
                        SET "IsAdmin" = CASE WHEN $promoteToAdmin = 1 THEN 1 ELSE "IsAdmin" END,
                            "Permissions" = $permissions,
                            "UpdatedAtUtc" = $now
                        WHERE "Id" = $id;
                        """;
                    updatePermissions.Parameters.AddWithValue("$promoteToAdmin", promoteToAdmin);
                    updatePermissions.Parameters.AddWithValue("$permissions", merged);
                    updatePermissions.Parameters.AddWithValue("$now", DateTime.UtcNow);
                    updatePermissions.Parameters.AddWithValue("$id", portalUser.Id);
                    await updatePermissions.ExecuteNonQueryAsync(cancellationToken);
                    portalUser = portalUser with { IsAdmin = portalUser.IsAdmin || promoteToAdmin, Permissions = merged };
                    updatedUsers++;
                }
            }

            if (employee.CompanyUserId is not null && employee.CompanyUserId != portalUser.Id)
            {
                throw new InvalidOperationException(
                    $"Leave 직원 ID {employee.Id}에 다른 Portal 사용자 ID가 이미 연결되어 있습니다.");
            }
            if (employee.CompanyUserId is null)
            {
                await using var link = connection.CreateCommand();
                link.Transaction = transaction;
                link.CommandText = """
                    UPDATE leaveDb."Employees"
                    SET "CompanyUserId" = $companyUserId
                    WHERE "Id" = $employeeId AND "CompanyUserId" IS NULL;
                    """;
                link.Parameters.AddWithValue("$companyUserId", portalUser.Id);
                link.Parameters.AddWithValue("$employeeId", employee.Id);
                linkedEmployees += await link.ExecuteNonQueryAsync(cancellationToken);
            }

            await QueueLeaveProjectionAsync(
                connection,
                transaction,
                portalUser.Id,
                cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new LegacyLeaveImportResult(
            importedUsers,
            updatedUsers,
            linkedEmployees,
            portalBackupPath,
            leaveBackupPath);
    }

    private static async Task<string> BackupAsync(
        string sourcePath,
        string backupFileName,
        CancellationToken cancellationToken)
    {
        var backupDirectory = Path.Combine(Path.GetDirectoryName(sourcePath)!, "backups");
        Directory.CreateDirectory(backupDirectory);
        var backupPath = Path.Combine(backupDirectory, backupFileName);
        await using var source = new SqliteConnection($"Data Source={sourcePath};Mode=ReadWrite");
        await using var backup = new SqliteConnection($"Data Source={backupPath};Mode=ReadWriteCreate");
        await source.OpenAsync(cancellationToken);
        await backup.OpenAsync(cancellationToken);
        source.BackupDatabase(backup);
        return backupPath;
    }

    private static async Task<PortalUser?> FindPortalUserAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string email,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT "Id", "IsAdmin", "IsMaster", "Permissions"
            FROM main."Users"
            WHERE lower(trim("Email")) = $email
            LIMIT 2;
            """;
        command.Parameters.AddWithValue("$email", email);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var result = new PortalUser(
            reader.GetInt64(0),
            reader.GetBoolean(1),
            reader.GetBoolean(2),
            reader.GetString(3));
        if (await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException("Portal에 동일 이메일 계정이 둘 이상 존재합니다.");
        return result;
    }

    private static string PermissionsForRole(int role) => role switch
    {
        0 or 1 or 2 => "",
        _ => throw new InvalidOperationException($"알 수 없는 Leave 직원 역할 값입니다: {role}")
    };

    private static bool IsAdministratorRole(int role) => role switch
    {
        0 => false,
        1 or 2 => true,
        _ => throw new InvalidOperationException($"알 수 없는 Leave 직원 역할 값입니다: {role}")
    };

    private static async Task EnsureRoleSchemaAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        var hasAdminColumn = false;
        await using (var columns = connection.CreateCommand())
        {
            columns.CommandText = "PRAGMA main.table_info(\"Users\");";
            await using var reader = await columns.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (string.Equals(reader.GetString(1), "IsAdmin", StringComparison.OrdinalIgnoreCase))
                {
                    hasAdminColumn = true;
                    break;
                }
            }
        }

        if (!hasAdminColumn)
        {
            await using var addColumn = connection.CreateCommand();
            addColumn.CommandText = "ALTER TABLE main.\"Users\" ADD COLUMN \"IsAdmin\" INTEGER NOT NULL DEFAULT 0;";
            await addColumn.ExecuteNonQueryAsync(cancellationToken);

            await using var migrateRoles = connection.CreateCommand();
            migrateRoles.CommandText = """
                UPDATE main."Users"
                SET "IsAdmin" = 1, "UpdatedAtUtc" = CURRENT_TIMESTAMP
                WHERE instr(',' || lower("Permissions") || ',', ',leave.admin,') > 0
                   OR instr(',' || lower("Permissions") || ',', ',leave.master,') > 0;
                """;
            await migrateRoles.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var enforceMasterRole = connection.CreateCommand();
        enforceMasterRole.CommandText = """
            UPDATE main."Users"
            SET "IsAdmin" = 1, "UpdatedAtUtc" = CURRENT_TIMESTAMP
            WHERE "IsMaster" = 1 AND "IsAdmin" = 0;
            """;
        await enforceMasterRole.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task EnsureOutboxSchemaAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using (var createTable = connection.CreateCommand())
        {
            createTable.CommandText = LeaveProjectionOutboxStore.CreateTableSql;
            await createTable.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var createIndex = connection.CreateCommand())
        {
            createIndex.CommandText = LeaveProjectionOutboxStore.CreateDueIndexSql;
            await createIndex.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var queueExisting = connection.CreateCommand();
        queueExisting.CommandText = """
            INSERT OR IGNORE INTO main."LeaveProjectionOutbox"
                ("CompanyUserId", "Version", "QueuedAtUtc", "NextAttemptAtUtc", "AttemptCount", "LastError")
            SELECT "Id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL
            FROM main."Users";
            """;
        await queueExisting.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task QueueLeaveProjectionAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        long companyUserId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO main."LeaveProjectionOutbox"
                ("CompanyUserId", "Version", "QueuedAtUtc", "NextAttemptAtUtc", "AttemptCount", "LastError")
            VALUES
                ($companyUserId, 1, $now, $now, 0, NULL)
            ON CONFLICT("CompanyUserId") DO UPDATE SET
                "Version" = "LeaveProjectionOutbox"."Version" + 1,
                "QueuedAtUtc" = excluded."QueuedAtUtc",
                "NextAttemptAtUtc" = excluded."NextAttemptAtUtc",
                "AttemptCount" = 0,
                "LastError" = NULL;
            """;
        command.Parameters.AddWithValue("$companyUserId", companyUserId);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private sealed record LegacyEmployee(
        long Id,
        string Email,
        string Name,
        string? Department,
        string HireDate,
        int Role,
        bool IsActive,
        long? CompanyUserId);

    private sealed record PortalUser(long Id, bool IsAdmin, bool IsMaster, string Permissions);
}
