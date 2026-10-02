using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class PersonalTodoSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS PersonalTodos (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                OwnerId INTEGER NOT NULL REFERENCES Employees(Id) ON DELETE RESTRICT,
                Title TEXT NOT NULL,
                SortOrder INTEGER NOT NULL,
                CompletedAt TEXT NULL,
                Version INTEGER NOT NULL,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_PersonalTodos_OwnerId_CompletedAt_SortOrder
                ON PersonalTodos(OwnerId, CompletedAt, SortOrder);
            """);
    }
}
