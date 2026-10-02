using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;

public static class SchemaMigrator
{
    public static async Task ApplyAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        var connection = db.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose) await connection.OpenAsync(cancellationToken);
        try
        {
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            var addedAdminColumn = !await HasColumnAsync(
                connection,
                transaction,
                "Users",
                "IsAdmin",
                cancellationToken);
            if (addedAdminColumn)
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    "ALTER TABLE \"Users\" ADD COLUMN \"IsAdmin\" INTEGER NOT NULL DEFAULT 0;",
                    cancellationToken);

                // 최초 중앙화 전환 때 Leave 관리자/마스터였던 직원을 회사 관리자로 승격합니다.
                // 컬럼을 새로 추가한 딱 한 번만 실행되므로 이후 수동 강등을 되돌리지 않습니다.
                await ExecuteAsync(
                    connection,
                    transaction,
                    """
                    UPDATE "Users"
                    SET "IsAdmin" = 1, "UpdatedAtUtc" = CURRENT_TIMESTAMP
                    WHERE "IsMaster" = 0
                      AND (
                        instr(',' || lower("Permissions") || ',', ',leave.admin,') > 0
                        OR instr(',' || lower("Permissions") || ',', ',leave.master,') > 0
                      );
                    """,
                    cancellationToken);
            }

            if (!await HasColumnAsync(
                    connection,
                    transaction,
                    "Users",
                    "IsSharedAccount",
                    cancellationToken))
            {
                await ExecuteAsync(
                    connection,
                    transaction,
                    "ALTER TABLE \"Users\" ADD COLUMN \"IsSharedAccount\" INTEGER NOT NULL DEFAULT 0;",
                    cancellationToken);
            }

            // Master는 항상 Admin을 포함한다는 역할 불변식을 유지합니다.
            if (!await HasColumnAsync(connection, transaction, "Users", "IsPrivate", cancellationToken))
                await ExecuteAsync(connection, transaction, "ALTER TABLE Users ADD COLUMN IsPrivate INTEGER NOT NULL DEFAULT 0;", cancellationToken);

            if (!await HasColumnAsync(connection, transaction, "Users", "BirthDate", cancellationToken))
                await ExecuteAsync(connection, transaction, "ALTER TABLE \"Users\" ADD COLUMN \"BirthDate\" TEXT NULL;", cancellationToken);

            // 생일은 월·일 정보만 소유한다. 윤일을 보존할 수 있는 2000년으로 기존 값을 정규화한다.
            await ExecuteAsync(
                connection,
                transaction,
                """
                UPDATE "Users"
                SET "BirthDate" = '2000-' || substr("BirthDate", 6, 5)
                WHERE "BirthDate" IS NOT NULL
                  AND length("BirthDate") = 10
                  AND substr("BirthDate", 5, 1) = '-'
                  AND substr("BirthDate", 8, 1) = '-'
                  AND date('2000-' || substr("BirthDate", 6, 5)) IS NOT NULL
                  AND substr("BirthDate", 1, 4) <> '2000';
                """,
                cancellationToken);

            await ExecuteAsync(
                connection,
                transaction,
                "UPDATE \"Users\" SET \"IsAdmin\" = 1 WHERE \"IsMaster\" = 1 AND \"IsAdmin\" = 0;",
                cancellationToken);

            // 공용 계정은 사람이 맡는 회사 역할을 가질 수 없다. UI 우회를 포함해 DB 상태도 보정한다.
            await ExecuteAsync(
                connection,
                transaction,
                "UPDATE \"Users\" SET \"IsAdmin\" = 0, \"IsMaster\" = 0 WHERE \"IsSharedAccount\" = 1;",
                cancellationToken);

            await ExecuteAsync(
                connection,
                transaction,
                LeaveProjectionOutboxStore.CreateTableSql,
                cancellationToken);
            await ExecuteAsync(
                connection,
                transaction,
                LeaveProjectionOutboxStore.CreateDueIndexSql,
                cancellationToken);

            // 재시작 때마다 pending이 없는 사용자를 다시 큐에 넣어 하위 서비스 투영을 조정합니다.
            await ExecuteAsync(
                connection,
                transaction,
                """
                INSERT OR IGNORE INTO "LeaveProjectionOutbox"
                    ("CompanyUserId", "Version", "QueuedAtUtc", "NextAttemptAtUtc", "AttemptCount", "LastError")
                SELECT "Id", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, NULL
                FROM "Users"
                WHERE "IsSharedAccount" = 0;
                """,
                cancellationToken);

            await transaction.CommitAsync(cancellationToken);
        }
        finally
        {
            if (shouldClose) await connection.CloseAsync();
        }
    }

    private static async Task<bool> HasColumnAsync(
        DbConnection connection,
        DbTransaction transaction,
        string table,
        string column,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"PRAGMA table_info(\"{table}\");";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            if (string.Equals(reader.GetString(1), column, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static async Task ExecuteAsync(
        DbConnection connection,
        DbTransaction transaction,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
