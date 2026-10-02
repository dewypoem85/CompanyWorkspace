using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;

public static class LeaveProjectionOutboxStore
{
    public const string TableName = "LeaveProjectionOutbox";

    public const string CreateTableSql = """
        CREATE TABLE IF NOT EXISTS "LeaveProjectionOutbox" (
            "CompanyUserId" INTEGER NOT NULL CONSTRAINT "PK_LeaveProjectionOutbox" PRIMARY KEY,
            "Version" INTEGER NOT NULL DEFAULT 1,
            "QueuedAtUtc" TEXT NOT NULL,
            "NextAttemptAtUtc" TEXT NOT NULL,
            "AttemptCount" INTEGER NOT NULL DEFAULT 0,
            "LastError" TEXT NULL
        );
        """;

    public const string CreateDueIndexSql = """
        CREATE INDEX IF NOT EXISTS "IX_LeaveProjectionOutbox_NextAttemptAtUtc"
        ON "LeaveProjectionOutbox" ("NextAttemptAtUtc");
        """;

    public static Task<int> EnqueueAsync(
        AppDbContext db,
        long companyUserId,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        return db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO "LeaveProjectionOutbox"
                ("CompanyUserId", "Version", "QueuedAtUtc", "NextAttemptAtUtc", "AttemptCount", "LastError")
            VALUES
                ({companyUserId}, 1, {now}, {now}, 0, NULL)
            ON CONFLICT("CompanyUserId") DO UPDATE SET
                "Version" = "LeaveProjectionOutbox"."Version" + 1,
                "QueuedAtUtc" = excluded."QueuedAtUtc",
                "NextAttemptAtUtc" = excluded."NextAttemptAtUtc",
                "AttemptCount" = 0,
                "LastError" = NULL;
            """,
            cancellationToken);
    }

    public static Task<int> DeleteIfVersionAsync(
        AppDbContext db,
        long companyUserId,
        long version,
        CancellationToken cancellationToken = default)
        => db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DELETE FROM "LeaveProjectionOutbox"
            WHERE "CompanyUserId" = {companyUserId} AND "Version" = {version};
            """,
            cancellationToken);

    public static Task<int> RecordFailureIfVersionAsync(
        AppDbContext db,
        long companyUserId,
        long version,
        int attemptCount,
        DateTime nextAttemptAtUtc,
        string error,
        CancellationToken cancellationToken = default)
    {
        var normalizedError = error.Length <= 2000 ? error : error[..2000];
        return db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "LeaveProjectionOutbox"
            SET "AttemptCount" = {attemptCount},
                "NextAttemptAtUtc" = {nextAttemptAtUtc},
                "LastError" = {normalizedError}
            WHERE "CompanyUserId" = {companyUserId} AND "Version" = {version};
            """,
            cancellationToken);
    }
}
