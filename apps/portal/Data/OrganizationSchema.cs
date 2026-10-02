using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;
public static class OrganizationSchema
{
    public static async Task ApplyAsync(AppDbContext db)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS Departments (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Archived INTEGER NOT NULL DEFAULT 0, Version INTEGER NOT NULL DEFAULT 1, HandlesScheduleFeedback INTEGER NOT NULL DEFAULT 0);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_Departments_Name ON Departments(Name);
            CREATE TABLE IF NOT EXISTS Projects (Id INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Color TEXT NOT NULL, Archived INTEGER NOT NULL DEFAULT 0, Version INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS ProjectMemberships (EmployeeId INTEGER NOT NULL, ProjectId INTEGER NOT NULL, PRIMARY KEY(EmployeeId, ProjectId));
            CREATE TABLE IF NOT EXISTS DepartmentLeads (DepartmentId INTEGER NOT NULL, EmployeeId INTEGER NOT NULL, PRIMARY KEY(DepartmentId, EmployeeId));
            CREATE TABLE IF NOT EXISTS OrganizationImports (Id TEXT PRIMARY KEY NOT NULL, ImportedAtUtc TEXT NOT NULL);
            """);
        using var cmd = db.Database.GetDbConnection().CreateCommand();
        cmd.Transaction = tx.GetDbTransaction();
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Users') WHERE name='DepartmentId'";
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Users ADD COLUMN DepartmentId INTEGER NULL;");
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Projects') WHERE name='IsPrivate'";
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync()) == 0)
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Projects ADD COLUMN IsPrivate INTEGER NOT NULL DEFAULT 0;");
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Departments') WHERE name='HandlesScheduleFeedback'";
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync()) == 0)
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE Departments ADD COLUMN HandlesScheduleFeedback INTEGER NOT NULL DEFAULT 0;");
            await db.Database.ExecuteSqlRawAsync("UPDATE Departments SET HandlesScheduleFeedback=1 WHERE Archived=0 AND trim(Name)='개발';");
        }
        if (!await db.OrganizationImports.AnyAsync(x => x.Id == "department-names-v1"))
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT OR IGNORE INTO Departments(Name,Archived,Version,HandlesScheduleFeedback)
                    SELECT DISTINCT trim(Department),0,1,CASE WHEN trim(Department)='개발' THEN 1 ELSE 0 END
                    FROM Users WHERE IsSharedAccount=0 AND length(trim(coalesce(Department,'')))>0;
                UPDATE Users SET DepartmentId=(SELECT Id FROM Departments WHERE Name=trim(Users.Department)), Department=nullif(trim(Department),'') WHERE IsSharedAccount=0;
                INSERT INTO OrganizationImports(Id,ImportedAtUtc) VALUES('department-names-v1',CURRENT_TIMESTAMP);
                """);
        }
        await tx.CommitAsync();
    }
}

