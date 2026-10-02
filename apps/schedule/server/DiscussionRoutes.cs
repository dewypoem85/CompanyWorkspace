using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class DiscussionRoutes
{
    public static void MapDiscussion(this WebApplication app)
    {
        app.MapPost("/api/tasks/{id:long}/comments", async (HttpRequest request, long id, CommentInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            CommentWriteProtocol.RequireActor(request, me);
            if (TaskWriteProtocol.Requested(request) && input.Version != 0) throw new ApiError(409, "신규 댓글의 작성 기준을 확인해 주세요.");
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = await TaskRoutes.Find(db, id, me);
            if (task.Archived) throw new ApiError(409, "보관된 업무는 읽기 전용입니다.");
            var body = Access.Text(input.Body, 10000);
            if (body.Length == 0 && (input.AttachmentIds?.Length ?? 0) == 0) throw new ApiError(400, "댓글 또는 이미지를 입력해 주세요.");
            Comment? parent = null;
            if (input.ParentId.HasValue)
            {
                parent = await db.Comments.SingleOrDefaultAsync(x => x.Id == input.ParentId && x.TaskId == id && x.ParentId == null) ?? throw new ApiError(400, "답글 대상이 올바르지 않습니다.");
            }
            var previousStateToken = await CommentWriteProtocol.RequireState(request, db, task, parent);
            var comment = new Comment { TaskId = id, AuthorId = me.Id, ParentId = input.ParentId, Body = body };
            db.Comments.Add(comment); CommentWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            await access.Attach(me, task, comment.Id, input.AttachmentIds);
            var recipients = Access.Mentions(body).Append(task.AssigneeId).ToList();
            if (parent is not null) recipients.Add(parent.AuthorId);
            await access.Notify(me, task, comment.Id, $"{me.Name}님이 댓글을 남겼습니다: {task.Title}", recipients);
            access.Log(me, id, "댓글 등록", new { comment.Id });
            await db.SaveChangesAsync();
            var result = await CommentWriteProtocol.Saved(request, db, me, task, comment, parent is null ? "create" : "reply", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<CommentWriteProtocol>();
        app.MapPut("/api/comments/{id:long}", async (HttpRequest request, long id, CommentInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            CommentWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var comment = await db.Comments.FindAsync(id) ?? throw new ApiError(404, "댓글을 찾을 수 없습니다.");
            var task = await TaskRoutes.Find(db, comment.TaskId, me);
            if (task.Archived || comment.Deleted) throw new ApiError(409, "수정할 수 없는 댓글입니다.");
            if (comment.AuthorId != me.Id) throw new ApiError(403, "작성자만 댓글을 수정할 수 있습니다.");
            Access.Version(comment.Version, input.Version);
            var body = Access.Text(input.Body, 10000);
            if (body.Length == 0 && (input.AttachmentIds?.Length ?? 0) == 0) throw new ApiError(400, "댓글 또는 이미지를 입력해 주세요.");
            var previousStateToken = await CommentWriteProtocol.RequireState(request, db, task, comment);
            var mentions = Access.Mentions(body).Except(Access.Mentions(comment.Body)).ToArray();
            access.Log(me, task.Id, "댓글 수정", new { comment.Id, version = comment.Version + 1 });
            comment.Body = body; comment.Version++; comment.EditedAt = DateTime.UtcNow;
            await access.Attach(me, task, comment.Id, input.AttachmentIds);
            await access.Notify(me, task, comment.Id, $"{me.Name}님이 댓글에서 회원님을 멘션했습니다: {task.Title}", mentions);
            CommentWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await CommentWriteProtocol.Saved(request, db, me, task, comment, "update", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<CommentWriteProtocol>();
        app.MapDelete("/api/comments/{id:long}", async (HttpRequest request, long id, int version, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); CommentWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var comment = await db.Comments.FindAsync(id) ?? throw new ApiError(404, "댓글을 찾을 수 없습니다.");
            var task = await TaskRoutes.Find(db, comment.TaskId, me);
            if (task.Archived || comment.Deleted) throw new ApiError(409, "삭제할 수 없는 댓글입니다.");
            if (comment.AuthorId != me.Id && !me.IsAdmin) throw new ApiError(403, "댓글 삭제 권한이 없습니다.");
            var previousStateToken = await CommentWriteProtocol.RequireState(request, db, task, comment);
            Access.Version(comment.Version, version);
            access.Log(me, task.Id, "댓글 삭제", new { comment.Id });
            comment.Body = ""; comment.Deleted = true; comment.Version++; comment.EditedAt = DateTime.UtcNow;
            var images = await db.Attachments.Where(x => x.CommentId == id).ToListAsync();
            foreach (var a in images) { a.TaskId = null; a.CommentId = null; a.CreatedAt = DateTime.UtcNow; }
            CommentWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await CommentWriteProtocol.Deleted(request, db, me, task, comment, previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<CommentWriteProtocol>();
        app.MapGet("/api/notifications", async (long? before, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var visibleIds = access.VisibleTasks(me).Select(t => t.Id); var visibleFeedback = FeedbackRoutes.Visible(db, me).Select(t => -t.Id);
            var q = db.Notices.AsNoTracking().Where(x => x.RecipientId == me.Id && (visibleIds.Contains(x.TaskId) || visibleFeedback.Contains(x.TaskId)));
            var unread = await q.CountAsync(x => !x.IsRead);
            if (before.HasValue) q = q.Where(x => x.Id < before.Value);
            return Results.Ok(new { unread, items = await q.OrderByDescending(x => x.Id).Take(50).ToListAsync() });
        });
        app.MapPost("/api/notifications/{id:long}/read", async (long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await db.Notices.Where(x => x.Id == id && x.RecipientId == me.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsRead, true)); return Results.NoContent();
        });
        app.MapPost("/api/notifications/read-all", async (ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await db.Notices.Where(x => x.RecipientId == me.Id && !x.IsRead).ExecuteUpdateAsync(s => s.SetProperty(x => x.IsRead, true)); return Results.NoContent();
        });
    }
}
