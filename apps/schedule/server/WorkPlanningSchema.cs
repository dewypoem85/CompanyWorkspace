using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;

public static class WorkPlanningSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Tasks') WHERE name='GoalId'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Tasks ADD COLUMN GoalId INTEGER NULL REFERENCES WorkGoals(Id) ON DELETE SET NULL;");

        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS WorkGoals (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                Title TEXT NOT NULL,
                Description TEXT NOT NULL DEFAULT '',
                ProjectId INTEGER NULL REFERENCES Projects(Id),
                CreatedBy INTEGER NOT NULL,
                ClosedAt TEXT NULL,
                ClosedBy INTEGER NULL,
                Version INTEGER NOT NULL DEFAULT 1,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_WorkGoals_ClosedAt_ProjectId_Title ON WorkGoals(ClosedAt,ProjectId,Title);
            CREATE INDEX IF NOT EXISTS IX_Tasks_GoalId ON Tasks(GoalId);
            CREATE TABLE IF NOT EXISTS TaskScheduleItems (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TaskId INTEGER NOT NULL REFERENCES Tasks(Id) ON DELETE CASCADE,
                Title TEXT NOT NULL,
                Date TEXT NOT NULL,
                EndDate TEXT NOT NULL,
                CreatedBy INTEGER NOT NULL,
                Version INTEGER NOT NULL DEFAULT 1,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_TaskScheduleItems_TaskId_Date_Id ON TaskScheduleItems(TaskId,Date,Id);
            CREATE TABLE IF NOT EXISTS SharedTaskTodos (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                TaskId INTEGER NOT NULL REFERENCES Tasks(Id) ON DELETE CASCADE,
                Title TEXT NOT NULL,
                CreatedBy INTEGER NOT NULL,
                CompletedBy INTEGER NULL,
                CompletedAt TEXT NULL,
                Version INTEGER NOT NULL DEFAULT 1,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_SharedTaskTodos_TaskId_CompletedAt_Id ON SharedTaskTodos(TaskId,CompletedAt,Id);
            """);
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info('TaskScheduleItems') WHERE name='EndDate'";
        if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0)
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE TaskScheduleItems ADD COLUMN EndDate TEXT NULL;");
        }
        await db.Database.ExecuteSqlRawAsync("UPDATE TaskScheduleItems SET EndDate = Date WHERE EndDate IS NULL;");
        await transaction.CommitAsync();
    }
}
