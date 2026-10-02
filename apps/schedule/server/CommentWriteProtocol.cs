using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Opt-in comment write envelope. Legacy JSON callers retain the original Comment
// response while checked clients bind the actor and the exact task/comment baseline.
public sealed class CommentWriteProtocol : IEndpointFilter
{
    public const string TargetStateHeader = "X-Workspace-Target-State";
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string StateToken(WorkItem task, Comment? target, IEnumerable<Attachment> attachments,
        IEnumerable<Comment>? comments = null)
    {
        var commentRows = (comments ?? []).Where(x => target is null || x.Id == target.Id || x.ParentId == target.Id)
            .OrderBy(x => x.Id).Select(x => new { x.Id, x.TaskId, x.AuthorId, x.ParentId, x.Body, x.Deleted,
                x.Version, createdAt = x.CreatedAt.Ticks, editedAt = x.EditedAt?.Ticks }).ToArray();
        var commentIds = commentRows.Select(x => x.Id).ToHashSet();
        var snapshot = new
        {
            task = new { task.Id, task.Title, task.AssigneeId, task.ProjectId, task.Archived, task.Version,
                updatedAt = task.UpdatedAt.Ticks },
            target = target is null ? null : new { target.Id, target.TaskId, target.AuthorId, target.ParentId,
                target.Body, target.Deleted, target.Version, createdAt = target.CreatedAt.Ticks,
                editedAt = target.EditedAt?.Ticks },
            comments = commentRows,
            attachments = attachments.Where(x => x.TaskId == task.Id && x.CommentId.HasValue && commentIds.Contains(x.CommentId.Value))
                .OrderBy(x => x.Id, StringComparer.Ordinal).Select(x => new { x.Id, x.OwnerId, x.TaskId,
                    x.CommentId, x.Name, x.ContentType, x.Size, createdAt = x.CreatedAt.Ticks }).ToArray()
        };
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot, Json)));
    }

    public static object Editing(Employee me, WorkItem task, IEnumerable<Comment> comments, IEnumerable<Attachment> attachments)
    {
        var rows = comments.OrderBy(x => x.Id).Select(comment => new
        {
            id = comment.Id,
            stateToken = StateToken(task, comment, attachments, comments)
        }).ToArray();
        return new { actorId = me.Id.ToString(CultureInfo.InvariantCulture),
            createStateToken = StateToken(task, null, attachments, comments), comments = rows };
    }

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (TaskWriteProtocol.Requested(request) && request.Headers[TaskWriteProtocol.ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static async Task<string?> RequireState(HttpRequest request, ScheduleDb db, WorkItem task, Comment? target)
    {
        if (!TaskWriteProtocol.Requested(request)) return null;
        var comments = await db.Comments.AsNoTracking().Where(x => x.TaskId == task.Id).OrderBy(x => x.Id).ToListAsync();
        var attachments = await db.Attachments.AsNoTracking().Where(x => x.TaskId == task.Id && x.CommentId != null)
            .OrderBy(x => x.Id).ToListAsync();
        var token = StateToken(task, target, attachments, comments);
        if (request.Headers[TargetStateHeader].ToString() != token)
            throw new ApiError(409, "업무·댓글 또는 첨부가 변경됐습니다. 최신 내용을 비교해 주세요.");
        return token;
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    public static async Task<IResult> Saved(HttpRequest request, ScheduleDb db, Employee me, WorkItem task,
        Comment comment, string operation, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.Ok(comment);
        var saved = await db.Comments.AsNoTracking().SingleAsync(x => x.Id == comment.Id);
        var comments = await db.Comments.AsNoTracking().Where(x => x.TaskId == task.Id).OrderBy(x => x.Id).ToListAsync();
        var allAttachments = await db.Attachments.AsNoTracking().Where(x => x.TaskId == task.Id && x.CommentId != null)
            .OrderBy(x => x.Id).ToListAsync();
        var attachments = allAttachments.Where(x => x.CommentId == comment.Id).ToArray();
        var data = new { operation, actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(task, saved, allAttachments, comments), comment = saved, attachments };
        return Envelope(200, "saved", "댓글을 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<IResult> Deleted(HttpRequest request, ScheduleDb db, Employee me, WorkItem task,
        Comment comment, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.NoContent();
        var saved = await db.Comments.AsNoTracking().SingleAsync(x => x.Id == comment.Id);
        var comments = await db.Comments.AsNoTracking().Where(x => x.TaskId == task.Id).OrderBy(x => x.Id).ToListAsync();
        var allAttachments = await db.Attachments.AsNoTracking().Where(x => x.TaskId == task.Id && x.CommentId != null)
            .OrderBy(x => x.Id).ToListAsync();
        var data = new { operation = "delete-comment", actorId = me.Id.ToString(CultureInfo.InvariantCulture),
            previousStateToken, stateToken = StateToken(task, saved, allAttachments, comments),
            comment = saved, attachments = Array.Empty<Attachment>() };
        return Envelope(200, "saved", "댓글을 삭제했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    private static IResult Envelope(int status, string outcome, string message, object? data = null) =>
        Results.Json(new { protocol = "workspace-form-v1", outcome, message, data }, Json,
            contentType: TaskWriteProtocol.MediaType, statusCode: status);

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (!TaskWriteProtocol.Requested(context.HttpContext.Request)) return await next(context);
        try { return await next(context); }
        catch (Exception exception)
        {
            if (!context.HttpContext.Items.ContainsKey(WriteBoundary))
            {
                if (exception is ApiError error)
                    return Envelope(error.Status == 400 ? 422 : error.Status,
                        error.Status switch { 400 => "invalid", 409 => "conflict", 401 or 403 => "denied", _ => "unknown" }, error.Message);
                if (exception is DbUpdateConcurrencyException)
                    return Envelope(409, "conflict", "다른 사람이 댓글을 수정했습니다. 최신 내용을 비교해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<CommentWriteProtocol>>()
                .LogError(exception, "Comment write result could not be confirmed");
            return Envelope(500, "unknown", "댓글 저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 댓글 내역을 확인해 주세요.");
        }
    }
}
