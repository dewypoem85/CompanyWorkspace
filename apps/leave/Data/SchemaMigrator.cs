using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Data;

public static class SchemaMigrator
{
    public static async Task ApplyAsync(AppDbContext db)
    {
        var connection = db.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose) await connection.OpenAsync();

        try
        {
            await EnsureAdditionalTablesAsync(connection);

            await EnsureColumnsAsync(connection, "Employees", new Dictionary<string, string>
            {
                ["CompanyUserId"] = "INTEGER NULL",
                ["Department"] = "TEXT NULL",
                ["BirthDate"] = "TEXT NULL",
                ["Role"] = "INTEGER NOT NULL DEFAULT 0",
                ["IsSharedAccount"] = "INTEGER NOT NULL DEFAULT 0",
                ["IsPrivate"] = "INTEGER NOT NULL DEFAULT 0",
                ["IsCompanyMaster"] = "INTEGER NOT NULL DEFAULT 0",
                ["IsActive"] = "INTEGER NOT NULL DEFAULT 1",
                ["KakaoNotificationsEnabled"] = "INTEGER NOT NULL DEFAULT 0",
                ["KakaoAccessTokenProtected"] = "TEXT NULL",
                ["KakaoRefreshTokenProtected"] = "TEXT NULL",
                ["KakaoAccessTokenExpiresAtUtc"] = "TEXT NULL",
                ["DiscordUserId"] = "TEXT NULL",
                ["DiscordUsername"] = "TEXT NULL",
                ["DiscordLinkedAtUtc"] = "TEXT NULL",
                ["DiscordDmEnabled"] = "INTEGER NOT NULL DEFAULT 0",
                ["DiscordDmNotificationTypes"] = "TEXT NULL",
                ["CalendarSelfOnly"] = "INTEGER NOT NULL DEFAULT 0",
                ["CalendarShowApprovedOthers"] = "INTEGER NOT NULL DEFAULT 0",
                ["CreatedAtUtc"] = "TEXT NOT NULL DEFAULT '0001-01-01T00:00:00'"
            });

            // Portal과 동일하게 생일은 월·일만 보존하고, DateOnly 저장에는 윤일 기준연도 2000을 사용한다.
            await ExecuteAsync(connection, """
                UPDATE "Employees"
                SET "BirthDate" = '2000-' || substr("BirthDate", 6, 5)
                WHERE "BirthDate" IS NOT NULL
                  AND length("BirthDate") = 10
                  AND substr("BirthDate", 5, 1) = '-'
                  AND substr("BirthDate", 8, 1) = '-'
                  AND date('2000-' || substr("BirthDate", 6, 5)) IS NOT NULL
                  AND substr("BirthDate", 1, 4) <> '2000';
                """);

            await EnsureColumnsAsync(connection, "LeaveRequests", new Dictionary<string, string>
            {
                ["WorkPlan"] = "TEXT NULL",
                ["IsAdvance"] = "INTEGER NOT NULL DEFAULT 0",
                ["AdvanceDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["AdvanceRepaymentDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["MonthlyAdvanceDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["AnnualAdvanceDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["MonthlyAdvanceRepaymentDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["AnnualAdvanceRepaymentDays"] = "TEXT NOT NULL DEFAULT '0.0'",
                ["BirthdayBenefitDate"] = "TEXT NULL",
                ["IsBirthdayPolicyOverride"] = "INTEGER NOT NULL DEFAULT 0",
                ["CancelRequestedAtUtc"] = "TEXT NULL",
                ["CancelDecidedAtUtc"] = "TEXT NULL",
                ["CancelDecidedByEmployeeId"] = "INTEGER NULL"
            });

            await EnsureColumnsAsync(connection, "LeaveRequestDates", new Dictionary<string, string>
            {
                ["IsBirthdayLeave"] = "INTEGER NOT NULL DEFAULT 0"
            });

            await EnsureColumnsAsync(connection, "LeaveGrants", new Dictionary<string, string>
            {
                ["SourceGrantId"] = "INTEGER NULL",
                ["BenefitYear"] = "INTEGER NULL",
                ["Note"] = "TEXT NULL",
                ["IsImported"] = "INTEGER NOT NULL DEFAULT 0",
                ["CreatedAtUtc"] = "TEXT NOT NULL DEFAULT '0001-01-01T00:00:00'"
            });

            await EnsureColumnsAsync(connection, "LeaveSettlements", new Dictionary<string, string>
            {
                ["CreatedGrantId"] = "INTEGER NULL",
                ["AdvanceLeaveRequestId"] = "INTEGER NULL",
                ["CreatedAtUtc"] = "TEXT NOT NULL DEFAULT '0001-01-01T00:00:00'"
            });

            await EnsureColumnsAsync(connection, "AuditLogs", new Dictionary<string, string>
            {
                ["BeforeJson"] = "TEXT NULL",
                ["AfterJson"] = "TEXT NULL",
                ["Reason"] = "TEXT NULL",
                ["IpAddress"] = "TEXT NULL",
                ["UserAgent"] = "TEXT NULL",
                ["CreatedAtUtc"] = "TEXT NOT NULL DEFAULT '0001-01-01T00:00:00'"
            });

            await EnsureColumnsAsync(connection, "Holidays", new Dictionary<string, string>
            {
                ["CreatedAtUtc"] = "TEXT NOT NULL DEFAULT '0001-01-01T00:00:00'",
                ["CreatedByEmployeeId"] = "INTEGER NULL"
            });

            await EnsureIndexesAsync(connection);
        }
        finally
        {
            if (shouldClose) await connection.CloseAsync();
        }
    }

    private static async Task EnsureAdditionalTablesAsync(DbConnection connection)
    {
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS "AppNotifications" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_AppNotifications" PRIMARY KEY AUTOINCREMENT,
                "RecipientEmployeeId" INTEGER NOT NULL,
                "Type" TEXT NOT NULL,
                "Title" TEXT NOT NULL,
                "Message" TEXT NOT NULL,
                "Link" TEXT NULL,
                "IsRead" INTEGER NOT NULL DEFAULT 0,
                "CreatedAtUtc" TEXT NOT NULL,
                "ReadAtUtc" TEXT NULL,
                CONSTRAINT "FK_AppNotifications_Employees_RecipientEmployeeId"
                    FOREIGN KEY ("RecipientEmployeeId") REFERENCES "Employees" ("Id") ON DELETE CASCADE
            );
            """);

        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS "DiscordWebhooks" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_DiscordWebhooks" PRIMARY KEY AUTOINCREMENT,
                "Url" TEXT NOT NULL,
                "Memo" TEXT NULL,
                "CreatedByEmployeeId" INTEGER NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_DiscordWebhooks_Employees_CreatedByEmployeeId"
                    FOREIGN KEY ("CreatedByEmployeeId") REFERENCES "Employees" ("Id") ON DELETE SET NULL
            );
            """);

        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS "ExternalSchedules" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_ExternalSchedules" PRIMARY KEY AUTOINCREMENT,
                "EmployeeId" INTEGER NOT NULL,
                "StartDate" TEXT NOT NULL,
                "EndDate" TEXT NOT NULL,
                "Category" TEXT NOT NULL,
                "Memo" TEXT NOT NULL,
                "CreatedByEmployeeId" INTEGER NULL,
                "UpdatedByEmployeeId" INTEGER NULL,
                "CreatedAtUtc" TEXT NOT NULL,
                "UpdatedAtUtc" TEXT NOT NULL,
                CONSTRAINT "FK_ExternalSchedules_Employees_EmployeeId"
                    FOREIGN KEY ("EmployeeId") REFERENCES "Employees" ("Id") ON DELETE RESTRICT
            );
            """);
    }

    private static async Task EnsureColumnsAsync(
        DbConnection connection,
        string table,
        IReadOnlyDictionary<string, string> columns)
    {
        var existing = await ReadColumnsAsync(connection, table);
        if (existing.Count == 0) return;

        foreach (var (column, definition) in columns)
        {
            if (existing.Contains(column)) continue;
            await ExecuteAsync(connection, $"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {definition};");
        }
    }

    private static async Task<HashSet<string>> ReadColumnsAsync(DbConnection connection, string table)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info(\"{table}\");";
        await using var reader = await command.ExecuteReaderAsync();
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadAsync())
        {
            if (!reader.IsDBNull(1)) result.Add(reader.GetString(1));
        }
        return result;
    }

    private static async Task EnsureIndexesAsync(DbConnection connection)
    {
        var statements = new[]
        {
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_Employees_Email\" ON \"Employees\" (\"Email\");",
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_Employees_CompanyUserId\" ON \"Employees\" (\"CompanyUserId\") WHERE \"CompanyUserId\" IS NOT NULL;",
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_Holidays_Date\" ON \"Holidays\" (\"Date\");",
            "CREATE INDEX IF NOT EXISTS \"IX_LeaveRequestDates_Date\" ON \"LeaveRequestDates\" (\"Date\");",
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_LeaveRequests_EmployeeId_BirthdayBenefitDate_Active\" ON \"LeaveRequests\" (\"EmployeeId\", \"BirthdayBenefitDate\") WHERE \"BirthdayBenefitDate\" IS NOT NULL AND \"IsBirthdayPolicyOverride\" = 0 AND \"Status\" IN (0, 1, 3);",
            "CREATE INDEX IF NOT EXISTS \"IX_LeaveGrants_EmployeeId_GrantedDate_GrantType\" ON \"LeaveGrants\" (\"EmployeeId\", \"GrantedDate\", \"GrantType\");",
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_LeaveGrants_EmployeeId_GrantType_BenefitYear\" ON \"LeaveGrants\" (\"EmployeeId\", \"GrantType\", \"BenefitYear\");",
            "CREATE INDEX IF NOT EXISTS \"IX_LeaveSettlements_AdvanceLeaveRequestId\" ON \"LeaveSettlements\" (\"AdvanceLeaveRequestId\");",
            "CREATE INDEX IF NOT EXISTS \"IX_AuditLogs_CreatedAtUtc\" ON \"AuditLogs\" (\"CreatedAtUtc\");",
            "CREATE INDEX IF NOT EXISTS \"IX_AppNotifications_RecipientEmployeeId_IsRead_CreatedAtUtc\" ON \"AppNotifications\" (\"RecipientEmployeeId\", \"IsRead\", \"CreatedAtUtc\");",
            "CREATE UNIQUE INDEX IF NOT EXISTS \"IX_DiscordWebhooks_Url\" ON \"DiscordWebhooks\" (\"Url\");",
            "CREATE INDEX IF NOT EXISTS \"IX_ExternalSchedules_StartDate_EndDate\" ON \"ExternalSchedules\" (\"StartDate\", \"EndDate\");",
            "CREATE INDEX IF NOT EXISTS \"IX_ExternalSchedules_EmployeeId_StartDate\" ON \"ExternalSchedules\" (\"EmployeeId\", \"StartDate\");"
        };

        foreach (var statement in statements)
            await ExecuteAsync(connection, statement);
    }

    private static async Task ExecuteAsync(DbConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }
}
