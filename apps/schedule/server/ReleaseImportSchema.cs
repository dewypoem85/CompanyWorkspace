using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;
public static class ReleaseImportSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        using var command = db.Database.GetDbConnection().CreateCommand(); command.Transaction = tx.GetDbTransaction();
        foreach (var name in new[] { "ReleasedOnUnknown", "SourceReference" })
        {
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('Releases') WHERE name='{name}'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
                await db.Database.ExecuteSqlRawAsync(name == "ReleasedOnUnknown" ? "ALTER TABLE Releases ADD COLUMN ReleasedOnUnknown INTEGER NOT NULL DEFAULT 0;" : "ALTER TABLE Releases ADD COLUMN SourceReference TEXT NOT NULL DEFAULT '';" );
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS IX_Releases_SourceReference ON Releases(SourceReference) WHERE SourceReference <> '';
            CREATE TABLE IF NOT EXISTS LegacyReleases (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, ProjectId INTEGER NOT NULL REFERENCES Projects(Id),
                ReleasedOn TEXT NULL, Notes TEXT NOT NULL, Issue TEXT NOT NULL, SourceReference TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_LegacyReleases_SourceReference ON LegacyReleases(SourceReference);
            CREATE INDEX IF NOT EXISTS IX_LegacyReleases_ProjectId ON LegacyReleases(ProjectId);
            """);
        await tx.CommitAsync();
    }
}
