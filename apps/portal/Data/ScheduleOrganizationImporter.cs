using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;
public static class ScheduleOrganizationImporter
{
    public record ImportResult(int Projects, int Leads, int SkippedLeads, bool AlreadyImported);
    public static async Task<ImportResult> RunAsync(string portalFile, string scheduleFile, bool apply)
    {
        portalFile = Path.GetFullPath(portalFile); scheduleFile = Path.GetFullPath(scheduleFile);
        if (portalFile == scheduleFile || !File.Exists(portalFile) || !File.Exists(scheduleFile)) throw new InvalidOperationException("서로 다른 Portal·Schedule DB 파일이 필요합니다.");
        var temp = Path.Combine(Path.GetTempPath(), "organization-import-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temp);
        try
        {
            // Use stopped-service backups; copies allow WAL recovery without writing the source.
            foreach (var (file, name) in new[] { (portalFile, "portal.db"), (scheduleFile, "schedule.db") })
                foreach (var suffix in new[] { "", "-wal", "-shm" })
                    if (File.Exists(file + suffix)) File.Copy(file + suffix, Path.Combine(temp, name + suffix));
            var source = Path.Combine(temp, "schedule.db");
            var result = await ImportIntoAsync(Path.Combine(temp, "portal.db"), source);
            if (apply) result = await ImportIntoAsync(portalFile, source);
            return result;
        }
        finally { SqliteConnection.ClearAllPools(); Directory.Delete(temp, true); }
    }
    static async Task<ImportResult> ImportIntoAsync(string portalFile, string source)
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={portalFile};Pooling=False").Options);
        await SchemaMigrator.ApplyAsync(db); await OrganizationSchema.ApplyAsync(db);
        if (await db.OrganizationImports.AnyAsync(x => x.Id == "schedule-catalog-v1")) return new(0, 0, 0, true);
        using var connection = new SqliteConnection($"Data Source={source};Mode=ReadOnly;Pooling=False"); await connection.OpenAsync();
        using var command = connection.CreateCommand(); command.CommandText = "PRAGMA integrity_check";
        if (Convert.ToString(await command.ExecuteScalarAsync()) != "ok") throw new InvalidOperationException("일정 DB 무결성 검사 실패");
        command.CommandText = "SELECT Id,Name,Color,Archived,Version FROM Projects";
        var projects = new List<CompanyProject>();
        using (var reader = await command.ExecuteReaderAsync()) while (await reader.ReadAsync()) projects.Add(new() { Id = reader.GetInt64(0), Name = reader.GetString(1), Color = reader.GetString(2), Archived = reader.GetBoolean(3), Version = reader.GetInt32(4) });
        command.CommandText = "SELECT Department,EmployeeId FROM TeamLeads";
        var sourceLeads = new List<(string Department, long EmployeeId)>();
        using (var reader = await command.ExecuteReaderAsync()) while (await reader.ReadAsync()) sourceLeads.Add((reader.GetString(0).Trim(), reader.GetInt64(1)));
        await using var tx = await db.Database.BeginTransactionAsync();
        var existing = await db.Projects.ToListAsync();
        if (existing.Count > 0) throw new InvalidOperationException("이전 완료 표시 없이 포털 프로젝트가 이미 있습니다. ID 충돌을 수동 확인해야 합니다.");
        db.Projects.AddRange(projects);
        var users = await db.Users.ToDictionaryAsync(x => x.Id);
        var valid = sourceLeads.Distinct().Where(l => users.TryGetValue(l.EmployeeId, out var u) && u.DepartmentId.HasValue && u.Department?.Trim() == l.Department && OrganizationService.EligibleLead(u)).ToList();
        foreach (var l in valid) db.DepartmentLeads.Add(new() { EmployeeId = l.EmployeeId, DepartmentId = users[l.EmployeeId].DepartmentId!.Value });
        db.OrganizationImports.Add(new() { Id = "schedule-catalog-v1" });
        await db.SaveChangesAsync(); await tx.CommitAsync();
        return new(projects.Count, valid.Count, sourceLeads.Count - valid.Count, false);
    }
}
