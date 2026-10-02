using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Opt-in envelope for the common form transport. Existing JSON/204 callers keep
// their response shape, while the workspace client binds every mutation to the
// current employee and the exact row or ordered-list baseline it observed.
public sealed class PersonalTodoWriteProtocol : IEndpointFilter
{
    public const string StateHeader = "X-Workspace-Todo-State";
    private static readonly TimeSpan ArchiveAfter = TimeSpan.FromDays(3);
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string StateToken(Employee me, PersonalTodo? target, IEnumerable<PersonalTodo> todos)
    {
        var rows = todos.Where(x => target is null || x.Id == target.Id).OrderBy(x => x.Id).Select(x => new
        {
            x.Id, x.OwnerId, x.Title, x.SortOrder, x.Version,
            createdAt = x.CreatedAt.Ticks, updatedAt = x.UpdatedAt.Ticks,
            completedAt = x.CompletedAt?.Ticks
        }).ToArray();
        var snapshot = new
        {
            actor = new { me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId },
            rows
        };
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot, Json)));
    }

    public static object Editing(Employee me, PersonalTodo? target, IEnumerable<PersonalTodo> todos) => new
    {
        actorId = me.Id.ToString(CultureInfo.InvariantCulture),
        stateToken = StateToken(me, target, todos),
        todos = target is null ? todos.OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToArray() : [target]
    };

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (TaskWriteProtocol.Requested(request) && request.Headers[TaskWriteProtocol.ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static string? RequireState(HttpRequest request, Employee me, PersonalTodo? target, IEnumerable<PersonalTodo> todos)
    {
        if (!TaskWriteProtocol.Requested(request)) return null;
        var token = StateToken(me, target, todos);
        if (request.Headers[StateHeader].ToString() != token)
            throw new ApiError(409, "TODO 또는 계정 권한이 변경됐습니다. 최신 목록을 다시 확인해 주세요.");
        return token;
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    public static async Task<IResult> Saved(HttpRequest request, ScheduleDb db, Employee me, PersonalTodo todo,
        string operation, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.Ok(todo);
        var saved = await db.PersonalTodos.AsNoTracking().SingleAsync(x => x.Id == todo.Id);
        var data = new
        {
            operation, actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, saved, [saved]), todo = saved,
            todos = (PersonalTodo[]?)null, deleted = false
        };
        return Envelope(200, "saved", "TODO를 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<IResult> Ordered(HttpRequest request, ScheduleDb db, Employee me, bool archived,
        string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.NoContent();
        var rows = await Rows(db, me.Id, archived);
        var data = new
        {
            operation = "order", actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, null, rows), todo = (PersonalTodo?)null,
            todos = rows, deleted = false
        };
        return Envelope(200, "saved", "TODO 순서를 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<IResult> Deleted(HttpRequest request, ScheduleDb db, Employee me, PersonalTodo snapshot,
        bool archived, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.NoContent();
        var rows = await Rows(db, me.Id, archived);
        var data = new
        {
            operation = "delete", actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, null, rows), todo = snapshot,
            todos = rows, deleted = true
        };
        return Envelope(200, "saved", "TODO를 삭제했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static Task<List<PersonalTodo>> Rows(ScheduleDb db, long ownerId, bool archived)
    {
        var cutoff = DateTime.UtcNow - ArchiveAfter;
        var query = db.PersonalTodos.AsNoTracking().Where(x => x.OwnerId == ownerId);
        query = archived
            ? query.Where(x => x.CompletedAt != null && x.CompletedAt <= cutoff)
            : query.Where(x => x.CompletedAt == null || x.CompletedAt > cutoff);
        return query.OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToListAsync();
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
                    return Envelope(409, "conflict", "다른 요청이 TODO를 변경했습니다. 최신 목록을 확인해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<PersonalTodoWriteProtocol>>()
                .LogError(exception, "Personal TODO write result could not be confirmed");
            return Envelope(500, "unknown", "저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 TODO 목록을 확인해 주세요.");
        }
    }
}
