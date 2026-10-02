using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class FeedbackRoutes
{
    static readonly HashSet<string> Types = ["bug", "improvement", "question", "other"];
    static readonly HashSet<string> Priorities = ["low", "normal", "high", "urgent"];
    static readonly HashSet<string> Statuses = ["new", "review", "progress", "resolved", "rejected"];
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapFeedback(this WebApplication app)
    {
        app.MapGet("/api/feedback", async (string? status, string? type, long? projectId, string? priority, long? assigneeId, string? q, int? skip, int? take, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var query = Visible(db, me).AsNoTracking();
            if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
            if (!string.IsNullOrWhiteSpace(type)) query = query.Where(x => x.Type == type);
            if (!string.IsNullOrWhiteSpace(priority)) query = query.Where(x => x.Priority == priority);
            if (projectId.HasValue) query = query.Where(x => x.ProjectId == projectId);
            if (assigneeId.HasValue) query = query.Where(x => x.AssigneeId == assigneeId);
            if (!string.IsNullOrWhiteSpace(q)) { var text = q.Trim(); query = query.Where(x => x.Title.Contains(text) || x.Body.Contains(text)); }
            var total = await query.CountAsync(); var offset = Math.Max(0, skip ?? 0); var size = Math.Clamp(take ?? 50, 1, 100);
            var items = await query.OrderByDescending(x => x.UpdatedAt).ThenByDescending(x => x.Id).Skip(offset).Take(size).ToListAsync();
            var ids = items.Select(x => x.Id).ToArray();
            var commentCounts = await db.FeedbackComments.Where(x => ids.Contains(x.FeedbackId) && !x.Deleted).GroupBy(x => x.FeedbackId).Select(x => new { feedbackId = x.Key, count = x.Count() }).ToListAsync();
            var attachmentCounts = await db.Attachments.Where(x => x.FeedbackId.HasValue && ids.Contains(x.FeedbackId.Value)).GroupBy(x => x.FeedbackId!.Value).Select(x => new { feedbackId = x.Key, count = x.Count() }).ToListAsync();
            return Results.Ok(new { items, total, skip = offset, take = size, commentCounts, attachmentCounts, canHandle = await IsHandler(db, me) });
        });
        app.MapGet("/api/feedback/badge", async (ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); if (!await IsHandler(db, me)) return Results.Ok(new { count = 0 });
            return Results.Ok(new { count = await Visible(db, me).CountAsync(x => x.Status == "new") });
        });
        app.MapGet("/api/feedback/{id:long}", async (long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var item = await Find(db, me, id); var canHandle = await CanHandle(db, me, item);
            var comments = await db.FeedbackComments.AsNoTracking().Where(x => x.FeedbackId == id).OrderBy(x => x.CreatedAt).ToListAsync();
            var attachments = await db.Attachments.AsNoTracking().Where(x => x.FeedbackId == id).OrderBy(x => x.CreatedAt).ToListAsync();
            var history = await db.FeedbackRevisions.AsNoTracking().Where(x => x.FeedbackId == id).OrderByDescending(x => x.Id).ToListAsync();
            var linkedTask = item.LinkedTaskId.HasValue ? await db.Tasks.AsNoTracking().Where(x => x.Id == item.LinkedTaskId).Select(x => new { x.Id, x.Title, x.Status, x.AssigneeId, x.StartDate, x.EndDate, x.Archived }).SingleOrDefaultAsync() : null;
            var handlerIds = await HandlerIds(db, item.ProjectId, me.IsAdmin);
            return Results.Ok(new { item, comments, attachments, history, linkedTask, canEdit = me.IsAdmin || item.ReporterId == me.Id, canHandle, handlerIds });
        });
        app.MapPost("/api/feedback", async (FeedbackInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); ValidateInput(input); var project = await db.Projects.FindAsync(input.ProjectId) ?? throw new ApiError(404, "프로젝트를 찾을 수 없습니다.");
            if (project.Archived) throw new ApiError(409, "보관된 프로젝트에는 제보할 수 없습니다.");
            if (project.IsPrivate && !me.IsAdmin) throw new ApiError(403, "비공개 프로젝트는 관리자만 제보할 수 있습니다.");
            if (!me.IsAdmin && !await db.Memberships.AnyAsync(x => x.EmployeeId == me.Id && x.ProjectId == project.Id)) throw new ApiError(403, "참여 중인 프로젝트에만 제보할 수 있습니다.");
            var item = new FeedbackItem { ProjectId = project.Id, ReporterId = me.Id, Type = input.Type, Priority = input.Priority, Title = Access.Text(input.Title, 200, true), Body = Access.Text(input.Body, 10000) };
            await using var tx = await db.Database.BeginTransactionAsync(); db.FeedbackItems.Add(item); await db.SaveChangesAsync();
            await Attach(db, me, item, null, input.AttachmentIds); Revision(db, me, item, "제보 등록", null); await db.SaveChangesAsync(); await tx.CommitAsync();
            return FeedbackWriteProtocol.Saved(me, "create", new { item }, "제보를 등록했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPut("/api/feedback/{id:long}", async (long id, FeedbackInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); ValidateInput(input); var item = await Find(db, me, id);
            if (item.ReporterId != me.Id && !me.IsAdmin) throw new ApiError(403, "작성자만 제보 원문을 수정할 수 있습니다.");
            if (input.ProjectId != item.ProjectId) throw new ApiError(409, "등록한 프로젝트는 변경할 수 없습니다."); Access.Version(item.Version, input.Version);
            var before = Snapshot(item); item.Type = input.Type; item.Priority = input.Priority; item.Title = Access.Text(input.Title, 200, true); item.Body = Access.Text(input.Body, 10000); item.Version++; item.UpdatedAt = DateTime.UtcNow;
            await using var tx = await db.Database.BeginTransactionAsync(); await Attach(db, me, item, null, input.AttachmentIds); Revision(db, me, item, "제보 수정", before); await db.SaveChangesAsync(); await tx.CommitAsync();
            return FeedbackWriteProtocol.Saved(me, "update", new { item }, "제보 내용을 수정했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPost("/api/feedback/{id:long}/assignment", async (long id, FeedbackAssignmentInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var item = await Find(db, me, id); if (!await CanHandle(db, me, item)) throw new ApiError(403, "제보 처리 권한이 없습니다."); Access.Version(item.Version, input.Version);
            if (input.AssigneeId.HasValue && !(await HandlerIds(db, item.ProjectId, me.IsAdmin)).Contains(input.AssigneeId.Value)) throw new ApiError(400, "제보를 처리할 수 있는 직원을 선택해 주세요.");
            var before = Snapshot(item); item.AssigneeId = input.AssigneeId; if (item.Status == "new" && input.AssigneeId.HasValue) item.Status = "review"; item.Version++; item.UpdatedAt = DateTime.UtcNow;
            Revision(db, me, item, input.AssigneeId.HasValue ? "담당자 지정" : "담당자 해제", before); await Notify(db, me, item, null, $"{me.Name}님이 제보 담당자를 변경했습니다: {item.Title}", [item.ReporterId, ..(item.AssigneeId.HasValue ? [item.AssigneeId.Value] : Array.Empty<long>())]); await db.SaveChangesAsync();
            return FeedbackWriteProtocol.Saved(me, "assignment", new { item }, input.AssigneeId.HasValue ? "담당자를 지정했습니다." : "담당자를 해제했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPost("/api/feedback/{id:long}/status", async (long id, FeedbackStatusInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var item = await Find(db, me, id); if (!await CanHandle(db, me, item)) throw new ApiError(403, "제보 처리 권한이 없습니다."); Access.Version(item.Version, input.Version);
            if (!Statuses.Contains(input.Status)) throw new ApiError(400, "제보 상태를 확인해 주세요.");
            if (input.Status is "review" or "progress" && !item.AssigneeId.HasValue) throw new ApiError(400, "담당자를 먼저 지정해 주세요.");
            var resolution = Access.Text(input.Resolution, 2000); if (input.Status == "rejected" && resolution.Length == 0) throw new ApiError(400, "반려 사유를 입력해 주세요.");
            var before = Snapshot(item); item.Status = input.Status; item.Resolution = input.Status is "resolved" or "rejected" ? resolution : ""; item.Version++; item.UpdatedAt = DateTime.UtcNow;
            Revision(db, me, item, "상태 변경", before); await Notify(db, me, item, null, $"제보 상태가 변경되었습니다: {item.Title}", [item.ReporterId, ..(item.AssigneeId.HasValue ? [item.AssigneeId.Value] : Array.Empty<long>())]); await db.SaveChangesAsync();
            return FeedbackWriteProtocol.Saved(me, "status", new { item }, "제보 상태를 변경했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPost("/api/feedback/{id:long}/task", async (long id, FeedbackTaskInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var item = await Find(db, me, id); if (!await CanHandle(db, me, item)) throw new ApiError(403, "제보 처리 권한이 없습니다."); Access.Version(item.Version, input.Version);
            if (item.LinkedTaskId.HasValue) throw new ApiError(409, "이미 일정 업무가 연결되어 있습니다."); if (!(await HandlerIds(db, item.ProjectId, me.IsAdmin)).Contains(input.AssigneeId)) throw new ApiError(400, "처리 가능한 담당자를 선택해 주세요."); Access.Dates(input.StartDate, input.EndDate);
            var task = new WorkItem { ProjectId = item.ProjectId, AssigneeId = input.AssigneeId, CreatedBy = me.Id, Title = Access.Text(input.Title, 200, true), Body = Access.Text(input.Body, 10000), StartDate = input.StartDate, EndDate = input.EndDate, Status = "planned" };
            await using var tx = await db.Database.BeginTransactionAsync(); var before = Snapshot(item); db.Tasks.Add(task); await db.SaveChangesAsync(); item.LinkedTaskId = task.Id; item.AssigneeId = input.AssigneeId; item.Status = "progress"; item.Version++; item.UpdatedAt = DateTime.UtcNow; Revision(db, me, item, "일정 업무 연결", before); access.Log(me, task.Id, "제보에서 업무 등록", new { feedbackId = item.Id }); await Notify(db, me, item, null, $"제보가 일정 업무로 등록되었습니다: {item.Title}", [item.ReporterId]); await db.SaveChangesAsync(); await tx.CommitAsync();
            return FeedbackWriteProtocol.Saved(me, "task", new { item, task }, "일정 업무를 만들고 제보에 연결했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPost("/api/feedback/{id:long}/comments", async (long id, FeedbackCommentInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var item = await Find(db, me, id); var body = Access.Text(input.Body, 10000); if (body.Length == 0 && (input.AttachmentIds?.Length ?? 0) == 0) throw new ApiError(400, "댓글 또는 이미지를 입력해 주세요.");
            FeedbackComment? parent = null; if (input.ParentId.HasValue) parent = await db.FeedbackComments.SingleOrDefaultAsync(x => x.Id == input.ParentId && x.FeedbackId == id && x.ParentId == null) ?? throw new ApiError(400, "답글 대상을 확인해 주세요.");
            await using var tx = await db.Database.BeginTransactionAsync(); var comment = new FeedbackComment { FeedbackId = id, AuthorId = me.Id, ParentId = input.ParentId, Body = body }; db.FeedbackComments.Add(comment); await db.SaveChangesAsync(); await Attach(db, me, item, comment.Id, input.AttachmentIds);
            var recipients = Access.Mentions(body).Append(item.ReporterId).ToList(); if (item.AssigneeId.HasValue) recipients.Add(item.AssigneeId.Value); if (parent is not null) recipients.Add(parent.AuthorId); await Notify(db, me, item, comment.Id, $"{me.Name}님이 제보에 댓글을 남겼습니다: {item.Title}", recipients); Revision(db, me, item, parent is null ? "댓글 등록" : "답글 등록", null); await db.SaveChangesAsync(); await tx.CommitAsync();
            return FeedbackWriteProtocol.Saved(me, "comment-create", new { comment }, "댓글을 등록했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapPut("/api/feedback-comments/{id:long}", async (long id, FeedbackCommentInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var comment = await db.FeedbackComments.FindAsync(id) ?? throw new ApiError(404, "댓글을 찾을 수 없습니다."); var item = await Find(db, me, comment.FeedbackId); if (comment.AuthorId != me.Id || comment.Deleted) throw new ApiError(403, "작성한 댓글만 수정할 수 있습니다."); Access.Version(comment.Version, input.Version);
            var body = Access.Text(input.Body, 10000); if (body.Length == 0 && (input.AttachmentIds?.Length ?? 0) == 0) throw new ApiError(400, "댓글 또는 이미지를 입력해 주세요."); var mentions = Access.Mentions(body).Except(Access.Mentions(comment.Body)).ToArray(); var before = JsonSerializer.Serialize(comment, Json); comment.Body = body; comment.Version++; comment.EditedAt = DateTime.UtcNow; await Attach(db, me, item, comment.Id, input.AttachmentIds); Revision(db, me, item, "댓글 수정", before, JsonSerializer.Serialize(comment, Json)); await Notify(db, me, item, comment.Id, $"{me.Name}님이 제보 댓글에서 회원님을 멘션했습니다: {item.Title}", mentions); await db.SaveChangesAsync();
            return FeedbackWriteProtocol.Saved(me, "comment-update", new { comment }, "댓글을 수정했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
        app.MapDelete("/api/feedback-comments/{id:long}", async (long id, int version, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var comment = await db.FeedbackComments.FindAsync(id) ?? throw new ApiError(404, "댓글을 찾을 수 없습니다."); var item = await Find(db, me, comment.FeedbackId); if (comment.AuthorId != me.Id && !me.IsAdmin) throw new ApiError(403, "댓글 삭제 권한이 없습니다."); Access.Version(comment.Version, version); comment.Body = ""; comment.Deleted = true; comment.Version++; comment.EditedAt = DateTime.UtcNow;
            var before = JsonSerializer.Serialize(comment, Json); foreach (var image in await db.Attachments.Where(x => x.FeedbackCommentId == id).ToListAsync()) { image.FeedbackId = null; image.FeedbackCommentId = null; image.CreatedAt = DateTime.UtcNow; } Revision(db, me, item, "댓글 삭제", before, JsonSerializer.Serialize(comment, Json)); await db.SaveChangesAsync();
            return FeedbackWriteProtocol.Saved(me, "comment-delete", new { comment }, "댓글을 삭제했습니다.");
        }).AddEndpointFilter<FeedbackWriteProtocol>();
    }

    public static IQueryable<FeedbackItem> Visible(ScheduleDb db, Employee me)
    {
        if (me.IsAdmin) return db.FeedbackItems;
        var memberships = db.Memberships.Where(m => m.EmployeeId == me.Id).Select(m => m.ProjectId);
        var handler = me.DepartmentId.HasValue && db.Departments.Any(d => d.Id == me.DepartmentId && !d.Archived && d.HandlesScheduleFeedback);
        return db.FeedbackItems.Where(f => db.Projects.Any(p => p.Id == f.ProjectId && !p.IsPrivate) && (handler || memberships.Contains(f.ProjectId)));
    }
    public static async Task<FeedbackItem> Find(ScheduleDb db, Employee me, long id) => await Visible(db, me).SingleOrDefaultAsync(x => x.Id == id) ?? throw new ApiError(404, "제보를 찾을 수 없습니다.");
    static async Task<bool> IsHandler(ScheduleDb db, Employee me) => me.IsAdmin || me.DepartmentId.HasValue && await db.Departments.AnyAsync(d => d.Id == me.DepartmentId && !d.Archived && d.HandlesScheduleFeedback);
    static async Task<bool> CanHandle(ScheduleDb db, Employee me, FeedbackItem item) => me.IsAdmin || await IsHandler(db, me) && !await db.Projects.AnyAsync(p => p.Id == item.ProjectId && p.IsPrivate);
    static async Task<long[]> HandlerIds(ScheduleDb db, long projectId, bool includeAllForAdmin)
    {
        var project = await db.Projects.FindAsync(projectId) ?? throw new ApiError(404, "프로젝트를 찾을 수 없습니다.");
        var query = db.Employees.Where(e => e.Active && e.Access && !e.Shared && e.Role != "master");
        if (!includeAllForAdmin || !project.IsPrivate) query = query.Where(e => e.DepartmentId.HasValue && db.Departments.Any(d => d.Id == e.DepartmentId && !d.Archived && d.HandlesScheduleFeedback));
        return await query.Select(e => e.Id).ToArrayAsync();
    }
    static void ValidateInput(FeedbackInput input)
    {
        if (!Types.Contains(input.Type)) throw new ApiError(400, "제보 종류를 확인해 주세요.");
        if (!Priorities.Contains(input.Priority)) throw new ApiError(400, "우선순위를 확인해 주세요.");
    }
    static string Snapshot(FeedbackItem item) => JsonSerializer.Serialize(item, Json);
    static void Revision(ScheduleDb db, Employee actor, FeedbackItem item, string action, string? before, string? after = null) => db.FeedbackRevisions.Add(new() { FeedbackId = item.Id, ActorId = actor.Id, Action = action, BeforeSnapshot = before ?? "", AfterSnapshot = after ?? Snapshot(item) });
    static async Task Attach(ScheduleDb db, Employee me, FeedbackItem item, long? commentId, string[]? supplied)
    {
        var ids = (supplied ?? []).Distinct().ToArray(); if (ids.Length > 10) throw new ApiError(400, "이미지는 최대 10개까지 첨부할 수 있습니다.");
        var chosen = await db.Attachments.Where(x => ids.Contains(x.Id)).ToListAsync();
        if (chosen.Count != ids.Length || chosen.Any(x => x.FeedbackId is null ? x.TaskId is not null || x.OwnerId != me.Id || x.CreatedAt < DateTime.UtcNow.AddHours(-24) : x.FeedbackId != item.Id || x.FeedbackCommentId != commentId)) throw new ApiError(400, "유효하지 않은 이미지 첨부입니다.");
        var old = await db.Attachments.Where(x => x.FeedbackId == item.Id && x.FeedbackCommentId == commentId).ToListAsync();
        foreach (var image in old.Where(x => !ids.Contains(x.Id))) { image.FeedbackId = null; image.FeedbackCommentId = null; image.CreatedAt = DateTime.UtcNow; }
        foreach (var image in chosen) { image.FeedbackId = item.Id; image.FeedbackCommentId = commentId; }
    }
    static async Task Notify(ScheduleDb db, Employee actor, FeedbackItem item, long? commentId, string message, IEnumerable<long> recipients)
    {
        var ids = recipients.Where(x => x != actor.Id).Distinct().ToArray(); var active = await db.Employees.Where(x => ids.Contains(x.Id) && x.Active && x.Access && !x.Shared).Select(x => x.Id).ToListAsync();
        foreach (var id in active) db.Notices.Add(new() { RecipientId = id, TaskId = -item.Id, CommentId = commentId.HasValue ? -commentId.Value : null, Message = message });
    }
}
