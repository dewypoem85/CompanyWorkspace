using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Schedule;
public static class ManagementRoutes
{
    public static void MapManagement(this WebApplication app)
    {
        foreach (var path in new[] { "/api/projects", "/api/projects/{id:long}", "/api/leads", "/api/leads/{id:long}" })
            app.MapMethods(path, ["POST", "PUT", "PATCH", "DELETE"], () => Results.Json(new { error = "부서·프로젝트·책임자는 회사 포털에서 관리합니다.", url = "https://company.example.com/Admin/Users" }, statusCode: 410));
        app.MapGet("/api/milestones", async (HttpRequest request, DateOnly from, DateOnly to, ScheduleDb db, Access access) =>
        {
            if (from > to || to.DayNumber - from.DayNumber > 366) throw new ApiError(400, "조회 기간을 확인해 주세요.");
            var me = await access.Me();
            var projectIds = await access.VisibleProjects(me).Select(p => p.Id).ToListAsync();
            var candidatesQuery = db.Milestones.AsNoTracking().Where(x => x.ProjectId == null || projectIds.Contains(x.ProjectId.Value));
            var projectFilter = request.Query["projectId"].ToString();
            if (projectFilter == "mine")
                candidatesQuery = candidatesQuery.Where(x => x.ProjectId.HasValue && db.Memberships.Any(m => m.EmployeeId == me.Id && m.ProjectId == x.ProjectId.Value));
            else if (projectFilter.Length > 0)
            {
                if (!long.TryParse(projectFilter, out var projectId) || projectId <= 0) throw new ApiError(400, "프로젝트를 확인해 주세요.");
                candidatesQuery = candidatesQuery.Where(x => x.ProjectId == projectId);
            }
            var candidates = await candidatesQuery.ToListAsync();
            var items = candidates.Where(x => InRange(x.Date, x.EndDate, from, to) || x.AdditionalSchedules.Any(s => InRange(s.Date, s.EndDate, from, to))).OrderBy(x => x.Date).ToList();
            if (request.Query["editing"] != "true") return Results.Ok(items);
            var visible = await MilestoneWriteProtocol.Visible(db, me);
            return Results.Ok(new { items, editing = MilestoneWriteProtocol.Editing(me, visible) });
        });
        app.MapGet("/api/milestones/{id:long}/history", async (long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var milestone = await db.Milestones.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id) ?? throw new ApiError(404, "주요 일정을 찾을 수 없습니다.");
            await access.RequireProject(me, milestone.ProjectId);
            return Results.Ok(await db.MilestoneRevisions.AsNoTracking().Where(x => x.MilestoneId == id).OrderByDescending(x => x.Id).Take(100).ToListAsync());
        });
        app.MapPost("/api/milestones", async (HttpRequest request, MilestoneInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); MilestoneWriteProtocol.RequireActor(request, me); await access.RequireProject(me, input.ProjectId);
            if (TaskWriteProtocol.Requested(request) && input.Version != 0) throw new ApiError(409, "신규 주요 일정의 작성 기준을 확인해 주세요.");
            await using var transaction = await db.Database.BeginTransactionAsync();
            var previousStateToken = MilestoneWriteProtocol.RequireState(request, me, null, await MilestoneWriteProtocol.Visible(db, me));
            await ValidateMilestone(input, db);
            var now = DateTime.UtcNow;
            var m = new Milestone { Type = input.Type ?? "general", Title = input.Title.Trim(), Description = Access.Text(input.Description, 10000), DeadlineMemo = Access.Text(input.DeadlineMemo, 200), Date = Deadline(input.Date, input.EndDate), AdditionalSchedules = Deadlines(input.AdditionalSchedules), ProjectId = input.ProjectId, CreatedBy = me.Id, UpdatedBy = me.Id, CreatedAt = now, UpdatedAt = now };
            db.Milestones.Add(m); access.Log(me, null, "주요 일정 등록", input); MilestoneWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            RecordRevision(m, me, "create", null, db); await db.SaveChangesAsync();
            var result = await MilestoneWriteProtocol.Saved(request, db, me, m, "create", previousStateToken); await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<MilestoneWriteProtocol>();
        app.MapPut("/api/milestones/{id:long}", async (HttpRequest request, long id, MilestoneInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); MilestoneWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var m = await db.Milestones.FindAsync(id) ?? throw new ApiError(404, "공통 마감을 찾을 수 없습니다.");
            await access.RequireProject(me, m.ProjectId); Access.Version(m.Version, input.Version);
            var previousStateToken = MilestoneWriteProtocol.RequireState(request, me, m, await MilestoneWriteProtocol.Visible(db, me));
            await access.RequireProject(me, input.ProjectId); await ValidateMilestone(input, db, m.ProjectId);
            var before = AuditSnapshot(m);
            m.Title = input.Title.Trim(); m.Date = Deadline(input.Date, input.EndDate); m.EndDate = null; m.ProjectId = input.ProjectId; m.Version++;
            if (input.AdditionalSchedules is not null) m.AdditionalSchedules = Deadlines(input.AdditionalSchedules);
            if (input.Type is not null) m.Type = input.Type;
            if (input.Description is not null) m.Description = Access.Text(input.Description, 10000);
            if (input.DeadlineMemo is not null) m.DeadlineMemo = Access.Text(input.DeadlineMemo, 200);
            m.UpdatedBy = me.Id; m.UpdatedAt = DateTime.UtcNow;
            RecordRevision(m, me, "update", before, db); access.Log(me, null, "주요 일정 수정", input); MilestoneWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await MilestoneWriteProtocol.Saved(request, db, me, m, "update", previousStateToken); await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<MilestoneWriteProtocol>();
        app.MapDelete("/api/milestones/{id:long}", async (HttpRequest request, long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); MilestoneWriteProtocol.RequireActor(request, me); await access.RequireManager(me);
            var version = int.TryParse(request.Query["version"], out var queryVersion) ? queryVersion :
                TaskWriteProtocol.Requested(request) ? (await request.ReadFromJsonAsync<VersionInput>())?.Version ?? 0 : 0;
            await using var transaction = await db.Database.BeginTransactionAsync();
            var m = await db.Milestones.FindAsync(id) ?? throw new ApiError(404, "공통 마감을 찾을 수 없습니다.");
            await access.RequireProject(me, m.ProjectId); Access.Version(m.Version, version);
            var previousStateToken = MilestoneWriteProtocol.RequireState(request, me, m, await MilestoneWriteProtocol.Visible(db, me));
            var snapshot = new Milestone { Id = m.Id, Type = m.Type, Title = m.Title, Description = m.Description, DeadlineMemo = m.DeadlineMemo, Date = m.Date, EndDate = m.EndDate, AdditionalSchedules = m.AdditionalSchedules, ProjectId = m.ProjectId, Version = m.Version, CreatedBy = m.CreatedBy, UpdatedBy = m.UpdatedBy, CreatedAt = m.CreatedAt, UpdatedAt = m.UpdatedAt };
            RecordRevision(m, me, "delete", AuditSnapshot(m), db); db.Milestones.Remove(m); access.Log(me, null, "주요 일정 삭제", m); MilestoneWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await MilestoneWriteProtocol.Deleted(request, db, me, snapshot, previousStateToken); await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<MilestoneWriteProtocol>();
    }
    private static async Task ValidateMilestone(MilestoneInput input, ScheduleDb db, long? existingProjectId = null)
    {
        if (input.Type is not (null or "general" or "review" or "update" or "prototype")) throw new ApiError(400, "주요 일정 타입을 확인해 주세요.");
        if (input.EndDate is not null && input.EndDate < input.Date) throw new ApiError(400, "주요 일정 종료일은 시작일 이후여야 합니다.");
        if (input.AdditionalSchedules?.Count > 20) throw new ApiError(400, "추가 일정은 20개까지 등록할 수 있습니다.");
        if (input.AdditionalSchedules?.Any(x => x.Type is not ("general" or "review" or "update" or "prototype") || x.Date == default || x.EndDate is not null && x.EndDate < x.Date || (x.Memo?.Length ?? 0) > 200) == true)
            throw new ApiError(400, "추가 일정의 타입·마감일·메모를 확인해 주세요.");
        Access.Text(input.Title, 200, true);
        Access.Text(input.Description, 10000);
        Access.Text(input.DeadlineMemo, 200);
        if (input.ProjectId.HasValue && !await db.Projects.AnyAsync(x => x.Id == input.ProjectId && (!x.Archived || x.Id == existingProjectId))) throw new ApiError(400, "프로젝트를 확인해 주세요.");
    }
    private static DateOnly Deadline(DateOnly date, DateOnly? endDate) => endDate ?? date;
    private static List<MilestoneSchedule> Deadlines(List<MilestoneSchedule>? schedules) =>
        (schedules ?? []).Select(item => item with { Date = Deadline(item.Date, item.EndDate), EndDate = null, Memo = Access.Text(item.Memo, 200) }).ToList();
    private static bool InRange(DateOnly start, DateOnly? end, DateOnly from, DateOnly to) => Deadline(start, end) >= from && Deadline(start, end) <= to;
    private static readonly JsonSerializerOptions AuditJson = new(JsonSerializerDefaults.Web);
    private static object AuditSnapshot(Milestone milestone) => new { milestone.Type, milestone.Title, milestone.Description, milestone.DeadlineMemo, milestone.Date, milestone.EndDate, milestone.AdditionalSchedules, milestone.ProjectId };
    private static void RecordRevision(Milestone milestone, Employee actor, string action, object? before, ScheduleDb db) => db.MilestoneRevisions.Add(new()
    {
        MilestoneId = milestone.Id,
        ActorId = actor.Id,
        Action = action,
        BeforeSnapshot = before is null ? "" : JsonSerializer.Serialize(before, AuditJson),
        AfterSnapshot = action == "delete" ? "" : JsonSerializer.Serialize(AuditSnapshot(milestone), AuditJson)
    });
}
