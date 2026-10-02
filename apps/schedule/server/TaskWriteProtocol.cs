using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Opt-in adapter for the common form envelope. Business validation and authorization
// remain in TaskRoutes/Access; old JSON clients keep their existing response shape.
public sealed class TaskWriteProtocol : IEndpointFilter
{
    public const string MediaType = "application/vnd.company.workspace-form+json";
    public const string ActorHeader = "X-Workspace-Actor";
    public const string StateHeader = "X-Workspace-State";
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static bool Requested(HttpRequest request) => request.GetTypedHeaders().Accept?
        .Any(x => string.Equals(x.MediaType.Value, MediaType, StringComparison.OrdinalIgnoreCase) && (x.Quality ?? 1) > 0) == true;

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (Requested(request) && request.Headers[ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static string StateToken(WorkItem task, IEnumerable<Attachment> attachments)
    {
        // Ticks are independent of SQLite's DateTime.Kind round trip. Attachment
        // membership/metadata is part of the baseline, but comments are not task edits.
        var snapshot = new { task.Id, task.Title, task.Body, task.AssigneeId, task.CreatedBy,
            task.ProjectId, task.GoalId, task.StartDate, task.EndDate,
            task.Status, task.Archived, task.Version, createdAt = task.CreatedAt.Ticks, updatedAt = task.UpdatedAt.Ticks,
            attachments = attachments.Where(x => x.TaskId == task.Id && x.CommentId == null)
                .OrderBy(x => x.Id, StringComparer.Ordinal).Select(x => new { x.Id, x.OwnerId, x.TaskId,
                    x.CommentId, x.Name, x.ContentType, x.Size, createdAt = x.CreatedAt.Ticks }) };
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot, Json)));
    }

    public static async Task<string?> RequireState(HttpRequest request, ScheduleDb db, WorkItem task)
    {
        if (!Requested(request)) return null;
        var attachments = await BodyAttachments(db, task.Id);
        var token = StateToken(task, attachments);
        if (request.Headers[StateHeader].ToString() != token)
            throw new ApiError(409, "업무 또는 첨부가 변경됐습니다. 최신 내용을 비교해 주세요.");
        return token;
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    // Capture the exact saved rows inside the transaction; execute this result only
    // after CommitAsync succeeds. A later reader must not silently replace this ACK.
    public static async Task<IResult> Saved(HttpRequest request, ScheduleDb db, Employee me,
        WorkItem task, string operation, string? previousStateToken)
    {
        if (!Requested(request)) return Results.Ok(task);
        var savedTask = await db.Tasks.AsNoTracking().SingleAsync(x => x.Id == task.Id);
        var attachments = await BodyAttachments(db, task.Id);
        var data = new { operation, actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(savedTask, attachments), task = savedTask, attachments,
            navigateTo = $"/tasks/{task.Id.ToString(CultureInfo.InvariantCulture)}" };
        return Envelope(200, "saved", "업무를 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    private static Task<List<Attachment>> BodyAttachments(ScheduleDb db, long id) => db.Attachments.AsNoTracking()
        .Where(x => x.TaskId == id && x.CommentId == null).OrderBy(x => x.Id).ToListAsync();

    private static IResult Envelope(int status, string outcome, string message, object? data = null) =>
        Results.Json(new { protocol = "workspace-form-v1", outcome, message, data }, Json,
            contentType: MediaType, statusCode: status);

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (!Requested(context.HttpContext.Request)) return await next(context);
        try { return await next(context); }
        catch (Exception exception)
        {
            // Only rejection before the first write is safe to classify as correctable.
            // Even a transaction/ACK failure is not a client-side rollback guarantee.
            if (!context.HttpContext.Items.ContainsKey(WriteBoundary))
            {
                if (exception is ApiError error)
                    return Envelope(error.Status == 400 ? 422 : error.Status,
                        error.Status switch { 400 => "invalid", 409 => "conflict", 401 or 403 => "denied", _ => "unknown" }, error.Message);
                if (exception is DbUpdateConcurrencyException)
                    return Envelope(409, "conflict", "다른 사람이 수정했습니다. 최신 내용을 비교해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<TaskWriteProtocol>>()
                .LogError(exception, "Task write result could not be confirmed");
            return Envelope(500, "unknown", "저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 업무 내역을 확인해 주세요.");
        }
    }
}
