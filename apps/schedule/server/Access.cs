using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

public class Access(ScheduleDb db, IHttpContextAccessor context)
{
    public async Task<Employee> Me()
    {
        var id = context.HttpContext!.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!long.TryParse(id, out var userId)) throw new ApiError(401, "회사 로그인이 필요합니다.");
        return await db.Employees.SingleOrDefaultAsync(x => x.Id == userId && x.Active && x.Access && !x.Shared)
            ?? throw new ApiError(403, "일정표 접근 권한이 없습니다.");
    }
    public IQueryable<Employee> VisibleEmployees(Employee me) => db.Employees.Where(e => e.Role != "master" && (me.IsAdmin || !e.IsPrivate));
    public IQueryable<Project> VisibleProjects(Employee me) => db.Projects.Where(p => me.IsAdmin || !p.IsPrivate);
    public IQueryable<WorkItem> VisibleTasks(Employee me) => db.Tasks.Where(t =>
        db.Employees.Any(e => e.Id == t.AssigneeId && e.Role != "master" && (me.IsAdmin || !e.IsPrivate)) &&
        (!t.ProjectId.HasValue || db.Projects.Any(p => p.Id == t.ProjectId && (me.IsAdmin || !p.IsPrivate))));
    public async Task RequireProject(Employee me, long? projectId)
    {
        if (projectId.HasValue && !await VisibleProjects(me).AnyAsync(p => p.Id == projectId)) throw new ApiError(404, "프로젝트를 찾을 수 없습니다.");
    }
    public async Task<bool> CanEdit(Employee me, long assigneeId)
    {
        if (me.IsAdmin || me.Id == assigneeId) return true;
        var target = await db.Employees.FindAsync(assigneeId);
        return target is not null && target.Active && target.DepartmentId.HasValue && target.DepartmentId == me.DepartmentId && await db.TeamLeads.AnyAsync(x => x.EmployeeId == me.Id && x.DepartmentId == target.DepartmentId);
    }
    public async Task<HashSet<long>> EditableAssignees(Employee me, IEnumerable<long> assignees)
    {
        var ids = assignees.Distinct().ToArray();
        if (me.IsAdmin) return ids.ToHashSet();
        var canLead = me.DepartmentId.HasValue && await db.TeamLeads.AnyAsync(x => x.EmployeeId == me.Id && x.DepartmentId == me.DepartmentId);
        return (await db.Employees.Where(x => ids.Contains(x.Id) && (x.Id == me.Id || (canLead && x.Active && x.DepartmentId == me.DepartmentId))).Select(x => x.Id).ToListAsync()).ToHashSet();
    }
    public async Task RequireEdit(Employee me, long assigneeId) { if (!await CanEdit(me, assigneeId)) throw new ApiError(403, "이 직원의 업무를 수정할 권한이 없습니다."); }
    public async Task RequireManager(Employee me)
    {
        if (!me.IsAdmin && !await db.TeamLeads.AnyAsync(x => x.EmployeeId == me.Id && x.DepartmentId == me.DepartmentId)) throw new ApiError(403, "팀 책임자 또는 관리자만 관리할 수 있습니다.");
    }
    public static void Admin(Employee me) { if (!me.IsAdmin) throw new ApiError(403, "회사 관리자만 사용할 수 있습니다."); }
    public static void Version(int current, int provided) { if (current != provided) throw new ApiError(409, "다른 사람이 수정했습니다. 작성 내용은 유지됩니다. 최신 내용을 확인해 주세요."); }
    public static string Text(string? value, int max, bool required = false)
    {
        var text = value?.Trim() ?? "";
        if (text.Length > max || (required && text.Length == 0)) throw new ApiError(400, $"입력 내용을 확인해 주세요. 최대 {max}자까지 입력할 수 있습니다.");
        return text;
    }
    public static void Status(string status) { if (status is not ("planned" or "progress" or "done")) throw new ApiError(400, "업무 상태가 올바르지 않습니다."); }
    public static void Dates(DateOnly? from, DateOnly? to) { if (from.HasValue != to.HasValue || from > to) throw new ApiError(400, "시작일과 종료일을 함께 지정하고 날짜 순서를 확인해 주세요."); }
    public void Log(Employee actor, long? taskId, string action, object? details = null) => db.Changes.Add(new() { ActorId = actor.Id, TaskId = taskId, Action = action, Details = details is null ? "" : System.Text.Json.JsonSerializer.Serialize(details) });
    public static HashSet<long> Mentions(string body) => Regex.Matches(body, @"@\[[^\]\r\n]{1,100}\]\((\d+)\)").Select(m => long.TryParse(m.Groups[1].Value, out var id) ? id : 0).Where(x => x > 0).ToHashSet();
    public async Task Notify(Employee actor, WorkItem item, long? commentId, string message, IEnumerable<long> recipients)
    {
        var ids = recipients.Where(x => x != actor.Id).Distinct().ToArray();
        var privateTask = await db.Employees.AnyAsync(e => e.Id == item.AssigneeId && e.IsPrivate) || (item.ProjectId.HasValue && await db.Projects.AnyAsync(p => p.Id == item.ProjectId && p.IsPrivate));
        var activeIds = await db.Employees.Where(x => ids.Contains(x.Id) && x.Active && x.Access && !x.Shared && (!privateTask || x.Role == "admin" || x.Role == "master")).Select(x => x.Id).ToListAsync();
        foreach (var id in activeIds) db.Notices.Add(new() { RecipientId = id, TaskId = item.Id, CommentId = commentId, Message = message, CreatedAt = DateTime.UtcNow });
    }
    public async Task Attach(Employee me, WorkItem item, long? commentId, string[]? supplied)
    {
        var ids = (supplied ?? []).Distinct().ToArray();
        if (ids.Length > 10) throw new ApiError(400, "이미지는 최대 10개까지 첨부할 수 있습니다.");
        var chosen = await db.Attachments.Where(x => ids.Contains(x.Id)).ToListAsync();
        if (chosen.Count != ids.Length || chosen.Any(x => x.TaskId is null ? x.FeedbackId is not null || x.OwnerId != me.Id || x.CreatedAt < DateTime.UtcNow.AddHours(-24) : x.TaskId != item.Id || x.CommentId != commentId)) throw new ApiError(400, "유효하지 않은 이미지 첨부입니다. 이미지를 다시 업로드해 주세요.");
        var old = await db.Attachments.Where(x => x.TaskId == item.Id && x.CommentId == commentId).ToListAsync();
        foreach (var image in old.Where(x => !ids.Contains(x.Id))) { image.TaskId = null; image.CommentId = null; image.CreatedAt = DateTime.UtcNow; }
        foreach (var image in chosen) { image.TaskId = item.Id; image.CommentId = commentId; }
    }
}
