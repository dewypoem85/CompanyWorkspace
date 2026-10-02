using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace CompanyPortal.Services;

public class OrganizationService(AppDbContext db)
{
    public static void RequireAdmin(CompanyUser actor)
    {
        if (!actor.IsActive || actor.IsSharedAccount || !PermissionCatalog.IsAdministrator(actor)) throw new OrganizationValidationException("회사 관리자만 조직 정보를 변경할 수 있습니다.");
    }
    public static void RequireManage(CompanyUser actor, CompanyUser target)
    {
        RequireAdmin(actor);
        if (!actor.IsMaster && PermissionCatalog.IsAdministrator(target)) throw new OrganizationValidationException("관리자·마스터의 소속 변경은 마스터만 할 수 있습니다.");
    }
    static string Name(string? value)
    {
        var name = value?.Trim() ?? "";
        if (name.Length is < 1 or > 100) throw new OrganizationValidationException("이름은 1~100자로 입력해 주세요.");
        return name;
    }
    static void Version(int expected, int actual) { if (expected != actual) throw new DbUpdateConcurrencyException("다른 곳에서 변경되었습니다. 최신 정보를 확인한 뒤 다시 저장해 주세요."); }

    // Caller owns the transaction so employee fields, memberships and outbox commit together.
    public async Task<bool> ApplyEmployeeAsync(CompanyUser actor, CompanyUser user, long? departmentId, long[]? suppliedProjects)
    {
        RequireAdmin(actor);
        // Existing role checks run before changing employee roles in UsersModel.
        var ids = (suppliedProjects ?? []).Distinct().Order().ToArray();
        if (user.IsSharedAccount) { departmentId = null; ids = []; }
        if (user.IsMaster) ids = [];
        var department = departmentId.HasValue ? await db.Departments.FindAsync(departmentId.Value) : null;
        if (departmentId.HasValue && (department is null || department.Archived)) throw new OrganizationValidationException("사용 중인 부서를 선택해 주세요.");
        var previous = user.Id == 0 ? [] : await db.ProjectMemberships.Where(x => x.EmployeeId == user.Id).ToListAsync();
        var existingIds = previous.Select(x => x.ProjectId).ToHashSet();
        var projects = await db.Projects.Where(x => ids.Contains(x.Id)).ToListAsync();
        if (projects.Count != ids.Length || projects.Any(x => x.Archived && !existingIds.Contains(x.Id))) throw new OrganizationValidationException("새 참여 프로젝트는 사용 중인 프로젝트만 선택할 수 있습니다.");
        var changed = user.DepartmentId != departmentId || !existingIds.SetEquals(ids);
        user.DepartmentId = departmentId; user.Department = department?.Name;
        foreach (var old in previous.Where(x => !ids.Contains(x.ProjectId))) db.ProjectMemberships.Remove(old);
        // New employees must first receive their stable ID inside the transaction.
        if (user.Id == 0) await db.SaveChangesAsync();
        foreach (var id in ids.Where(x => !existingIds.Contains(x))) db.ProjectMemberships.Add(new() { EmployeeId = user.Id, ProjectId = id });
        foreach (var id in existingIds.SymmetricExcept(ids))
        {
            var project = await db.Projects.FindAsync(id);
            if (project is not null) project.Version++;
        }
        var leads = await db.DepartmentLeads.Where(x => x.EmployeeId == user.Id).ToListAsync();
        foreach (var lead in leads.Where(x => x.DepartmentId != user.DepartmentId || !EligibleLead(user)))
        {
            db.DepartmentLeads.Remove(lead);
            var d = await db.Departments.FindAsync(lead.DepartmentId); if (d is not null) d.Version++;
            changed = true;
        }
        if (changed) user.UpdatedAtUtc = DateTime.UtcNow;
        return changed;
    }
    public static bool EligibleLead(CompanyUser user) => user.IsActive && !user.IsSharedAccount && !user.IsMaster  && PermissionCatalog.Has(user, "schedule.access");

    public async Task<Department> SaveDepartmentAsync(CompanyUser actor, long? id, string name, bool archived, int version, long[]? leadIds, bool handlesScheduleFeedback = false)
    {
        RequireAdmin(actor); name = Name(name);
        await using var tx = await db.Database.BeginTransactionAsync();
        var item = id.HasValue ? await db.Departments.FindAsync(id.Value) ?? throw new OrganizationValidationException("부서를 찾을 수 없습니다.") : new Department();
        if (id.HasValue) Version(version, item.Version);
        if (await db.Departments.AnyAsync(x => x.Name == name && x.Id != item.Id)) throw new OrganizationValidationException("같은 이름의 부서가 있습니다.");
        var members = await db.Users.Where(x => x.DepartmentId == item.Id).ToListAsync();
        var chosen = (leadIds ?? []).Distinct().ToHashSet();
        var oldLeads = id.HasValue ? await db.DepartmentLeads.Where(x => x.DepartmentId == item.Id).ToListAsync() : [];
        if (chosen.Any(x => !members.Any(u => u.Id == x && EligibleLead(u)))) throw new OrganizationValidationException("책임자는 해당 부서의 일정 접근 가능한 활성 직원이어야 합니다.");
        if (archived && (members.Count > 0 || chosen.Count > 0)) throw new OrganizationValidationException("소속 직원과 책임자를 먼저 정리해 주세요.");
        var oldIds = oldLeads.Select(x => x.EmployeeId).ToHashSet();
        foreach (var user in members.Where(u => oldIds.Contains(u.Id) != chosen.Contains(u.Id))) RequireManage(actor, user);
        var renamed = item.Name != name;
        item.Name = name; item.Archived = archived; item.HandlesScheduleFeedback = !archived && handlesScheduleFeedback; if (id.HasValue) item.Version++; else db.Departments.Add(item);
        await db.SaveChangesAsync();
        foreach (var row in oldLeads.Where(x => !chosen.Contains(x.EmployeeId))) db.DepartmentLeads.Remove(row);
        foreach (var employeeId in chosen.Where(x => !oldIds.Contains(x))) db.DepartmentLeads.Add(new() { DepartmentId = item.Id, EmployeeId = employeeId });
        foreach (var user in members)
        {
            if (renamed) { user.Department = name; await LeaveProjectionOutboxStore.EnqueueAsync(db, user.Id); }
            if (renamed || oldIds.Contains(user.Id) != chosen.Contains(user.Id)) user.UpdatedAtUtc = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(); await tx.CommitAsync();
        return item;
    }
    public async Task<CompanyProject> SaveProjectAsync(CompanyUser actor, long? id, string name, string color, bool archived, int version, long[]? memberIds, bool isPrivate = false)
    {
        RequireAdmin(actor); name = Name(name);
        if (!Regex.IsMatch(color ?? "", "\\A#[0-9a-fA-F]{6}\\z")) throw new OrganizationValidationException("프로젝트 색상을 확인해 주세요.");
        await using var tx = await db.Database.BeginTransactionAsync();
        var item = id.HasValue ? await db.Projects.FindAsync(id.Value) ?? throw new OrganizationValidationException("프로젝트를 찾을 수 없습니다.") : new CompanyProject();
        if (id.HasValue) Version(version, item.Version);
        if (await db.Projects.AnyAsync(x => x.Name == name && x.Id != item.Id)) throw new OrganizationValidationException("같은 이름의 프로젝트가 있습니다.");
        var old = id.HasValue ? await db.ProjectMemberships.Where(x => x.ProjectId == item.Id).ToListAsync() : [];
        var chosen = (memberIds ?? []).Distinct().ToHashSet(); var oldIds = old.Select(x => x.EmployeeId).ToHashSet();
        var users = await db.Users.Where(x => chosen.Contains(x.Id) || oldIds.Contains(x.Id)).ToListAsync();
        if (chosen.Any(x => !users.Any(u => u.Id == x && !u.IsSharedAccount && !u.IsMaster  && (u.IsActive || oldIds.Contains(x))))) throw new OrganizationValidationException("새 참여자는 활성 직원이어야 합니다. 공유 계정은 제외됩니다.");
        if (archived && chosen.Except(oldIds).Any()) throw new OrganizationValidationException("보관 프로젝트에는 새 참여자를 추가할 수 없습니다.");
        // Hidden legacy master memberships are retained, but never exported as participants.
        foreach (var user in users.Where(u => u.IsMaster && oldIds.Contains(u.Id))) chosen.Add(user.Id);
        foreach (var user in users.Where(u => oldIds.Contains(u.Id) != chosen.Contains(u.Id))) RequireManage(actor, user);
        item.Name = name; item.Color = color!; item.IsPrivate = isPrivate; item.Archived = archived; if (id.HasValue) item.Version++; else db.Projects.Add(item);
        await db.SaveChangesAsync();
        foreach (var row in old.Where(x => !chosen.Contains(x.EmployeeId))) db.ProjectMemberships.Remove(row);
        foreach (var employeeId in chosen.Where(x => !oldIds.Contains(x))) db.ProjectMemberships.Add(new() { EmployeeId = employeeId, ProjectId = item.Id });
        foreach (var user in users.Where(u => oldIds.Contains(u.Id) != chosen.Contains(u.Id))) user.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(); await tx.CommitAsync();
        return item;
    }
}
internal static class OrganizationSets
{
    public static IEnumerable<long> SymmetricExcept(this HashSet<long> values, IEnumerable<long> other)
    { var result = values.ToHashSet(); result.SymmetricExceptWith(other); return result; }
}

public sealed class OrganizationValidationException(string message) : InvalidOperationException(message);
