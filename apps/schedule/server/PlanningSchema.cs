using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;
public static class PlanningSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = tx.GetDbTransaction();
        await db.Database.ExecuteSqlRawAsync("DROP INDEX IF EXISTS IX_Tasks_ActualStartDate_ActualEndDate;");
        foreach (var column in new[] { "ActualStartDate", "ActualEndDate" })
        {
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('Tasks') WHERE name='{column}'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) > 0)
            {
                if (column == "ActualStartDate") await db.Database.ExecuteSqlRawAsync("ALTER TABLE Tasks DROP COLUMN ActualStartDate;");
                else await db.Database.ExecuteSqlRawAsync("ALTER TABLE Tasks DROP COLUMN ActualEndDate;");
            }
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS Releases (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, ProjectId INTEGER NOT NULL REFERENCES Projects(Id),
                BaseVersion INTEGER NOT NULL, Minor INTEGER NOT NULL,
                ReleasedOn TEXT NOT NULL, Notes TEXT NOT NULL, Status TEXT NOT NULL, Issue TEXT NOT NULL,
                RollbackTargetId INTEGER NULL, ResolvedInId INTEGER NULL, CreatedBy INTEGER NOT NULL, Version INTEGER NOT NULL, UpdatedAt TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_Releases_ProjectId_BaseVersion_Minor ON Releases(ProjectId,BaseVersion,Minor);
            CREATE TABLE IF NOT EXISTS ReleaseRevisions (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, ReleaseId INTEGER NOT NULL REFERENCES Releases(Id),
                ActorId INTEGER NOT NULL, Snapshot TEXT NOT NULL, CreatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_ReleaseRevisions_ReleaseId_Id ON ReleaseRevisions(ReleaseId,Id);
            """);
        await tx.CommitAsync();
    }
}
