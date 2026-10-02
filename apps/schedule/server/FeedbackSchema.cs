using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;

public static class FeedbackSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        using var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        async Task AddColumn(string table, string column, string sql)
        {
            command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name='{column}'";
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) == 0) await db.Database.ExecuteSqlRawAsync(sql);
        }
        await AddColumn("Departments", "HandlesScheduleFeedback", "ALTER TABLE Departments ADD COLUMN HandlesScheduleFeedback INTEGER NOT NULL DEFAULT 0;");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS FeedbackItems (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                ProjectId INTEGER NOT NULL REFERENCES Projects(Id) ON DELETE RESTRICT,
                ReporterId INTEGER NOT NULL REFERENCES Employees(Id) ON DELETE RESTRICT,
                AssigneeId INTEGER NULL REFERENCES Employees(Id) ON DELETE SET NULL,
                LinkedTaskId INTEGER NULL REFERENCES Tasks(Id) ON DELETE SET NULL,
                Type TEXT NOT NULL,
                Priority TEXT NOT NULL,
                Status TEXT NOT NULL,
                Title TEXT NOT NULL,
                Body TEXT NOT NULL,
                Resolution TEXT NOT NULL DEFAULT '',
                Version INTEGER NOT NULL DEFAULT 1,
                CreatedAt TEXT NOT NULL,
                UpdatedAt TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_FeedbackItems_LinkedTaskId ON FeedbackItems(LinkedTaskId) WHERE LinkedTaskId IS NOT NULL;
            CREATE INDEX IF NOT EXISTS IX_FeedbackItems_Status_UpdatedAt ON FeedbackItems(Status,UpdatedAt);
            CREATE INDEX IF NOT EXISTS IX_FeedbackItems_ProjectId_Status_Id ON FeedbackItems(ProjectId,Status,Id);
            CREATE TABLE IF NOT EXISTS FeedbackComments (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                FeedbackId INTEGER NOT NULL REFERENCES FeedbackItems(Id) ON DELETE RESTRICT,
                AuthorId INTEGER NOT NULL REFERENCES Employees(Id) ON DELETE RESTRICT,
                ParentId INTEGER NULL REFERENCES FeedbackComments(Id) ON DELETE RESTRICT,
                Body TEXT NOT NULL,
                Deleted INTEGER NOT NULL DEFAULT 0,
                Version INTEGER NOT NULL DEFAULT 1,
                CreatedAt TEXT NOT NULL,
                EditedAt TEXT NULL);
            CREATE INDEX IF NOT EXISTS IX_FeedbackComments_FeedbackId_CreatedAt ON FeedbackComments(FeedbackId,CreatedAt);
            CREATE TABLE IF NOT EXISTS FeedbackRevisions (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                FeedbackId INTEGER NOT NULL REFERENCES FeedbackItems(Id) ON DELETE RESTRICT,
                ActorId INTEGER NOT NULL REFERENCES Employees(Id) ON DELETE RESTRICT,
                Action TEXT NOT NULL,
                BeforeSnapshot TEXT NOT NULL,
                AfterSnapshot TEXT NOT NULL,
                CreatedAt TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS IX_FeedbackRevisions_FeedbackId_Id ON FeedbackRevisions(FeedbackId,Id);
            """);
        await AddColumn("Attachments", "FeedbackId", "ALTER TABLE Attachments ADD COLUMN FeedbackId INTEGER NULL REFERENCES FeedbackItems(Id) ON DELETE RESTRICT;");
        await AddColumn("Attachments", "FeedbackCommentId", "ALTER TABLE Attachments ADD COLUMN FeedbackCommentId INTEGER NULL REFERENCES FeedbackComments(Id) ON DELETE RESTRICT;");
        await db.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS IX_Attachments_FeedbackId ON Attachments(FeedbackId);");
        await transaction.CommitAsync();
    }
}
