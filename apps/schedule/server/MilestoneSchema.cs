using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;

public static class MilestoneSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='Description'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Milestones ADD COLUMN Description TEXT NOT NULL DEFAULT '';");
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='DeadlineMemo'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Milestones ADD COLUMN DeadlineMemo TEXT NOT NULL DEFAULT '';");
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='Type'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Milestones ADD COLUMN Type TEXT NOT NULL DEFAULT 'general';");
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='EndDate'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Milestones ADD COLUMN EndDate TEXT NULL;");
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='AdditionalSchedulesJson'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Milestones ADD COLUMN AdditionalSchedulesJson TEXT NOT NULL DEFAULT '[]';");
        foreach (var column in new[] { "CreatedBy", "UpdatedBy", "CreatedAt", "UpdatedAt" })
        {
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('Milestones') WHERE name='{column}'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            {
                command.CommandText = column switch
                {
                    "CreatedBy" => "ALTER TABLE Milestones ADD COLUMN CreatedBy INTEGER NULL;",
                    "UpdatedBy" => "ALTER TABLE Milestones ADD COLUMN UpdatedBy INTEGER NULL;",
                    "CreatedAt" => "ALTER TABLE Milestones ADD COLUMN CreatedAt TEXT NULL;",
                    _ => "ALTER TABLE Milestones ADD COLUMN UpdatedAt TEXT NULL;"
                };
                await command.ExecuteNonQueryAsync();
            }
        }
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS MilestoneRevisions (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                MilestoneId INTEGER NOT NULL,
                ActorId INTEGER NOT NULL,
                Action TEXT NOT NULL,
                BeforeSnapshot TEXT NOT NULL,
                AfterSnapshot TEXT NOT NULL,
                CreatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_MilestoneRevisions_MilestoneId_Id ON MilestoneRevisions(MilestoneId,Id);
            """);
        // Legacy ranges represented one deadline. Keep their final day and remove the range.
        foreach (var milestone in await db.Milestones.ToListAsync())
        {
            var changed = false;
            if (milestone.EndDate is { } deadline)
            {
                milestone.Date = deadline;
                milestone.EndDate = null;
                changed = true;
            }
            var schedules = milestone.AdditionalSchedules;
            if (schedules.Any(item => item.EndDate is not null))
            {
                milestone.AdditionalSchedules = schedules.Select(item => item with { Date = item.EndDate ?? item.Date, EndDate = null }).ToList();
                changed = true;
            }
            if (changed) milestone.Version++;
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
