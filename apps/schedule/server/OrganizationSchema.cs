using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Schedule;
public static class OrganizationSchema
{
    public static async Task ApplyAsync(ScheduleDb db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS Departments (Id INTEGER PRIMARY KEY, Name TEXT NOT NULL, Archived INTEGER NOT NULL, Version INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS Memberships (EmployeeId INTEGER NOT NULL, ProjectId INTEGER NOT NULL, PRIMARY KEY(EmployeeId,ProjectId));
            """);
        foreach (var table in new[] { "Employees", "TeamLeads" })
        {
            using var cmd = db.Database.GetDbConnection().CreateCommand(); cmd.Transaction = tx.GetDbTransaction();
            cmd.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name='DepartmentId'";
            if (Convert.ToInt32(await cmd.ExecuteScalarAsync()) == 0) await db.Database.ExecuteSqlRawAsync(table == "Employees" ? "ALTER TABLE Employees ADD COLUMN DepartmentId INTEGER NULL;" : "ALTER TABLE TeamLeads ADD COLUMN DepartmentId INTEGER NULL;");
        }
        using var hiddenColumn = db.Database.GetDbConnection().CreateCommand(); hiddenColumn.Transaction = tx.GetDbTransaction();
        hiddenColumn.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Employees') WHERE name='IsPrivate'";
        if (Convert.ToInt32(await hiddenColumn.ExecuteScalarAsync()) == 0) await db.Database.ExecuteSqlRawAsync("ALTER TABLE Employees ADD COLUMN IsPrivate INTEGER NOT NULL DEFAULT 0;");
        hiddenColumn.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Projects') WHERE name='IsPrivate'";
        if (Convert.ToInt32(await hiddenColumn.ExecuteScalarAsync()) == 0) await db.Database.ExecuteSqlRawAsync("ALTER TABLE Projects ADD COLUMN IsPrivate INTEGER NOT NULL DEFAULT 0;");
        await tx.CommitAsync();
    }
}
