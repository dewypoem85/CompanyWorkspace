using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Opt-in milestone write envelope. The ordinary JSON endpoints remain compatible
// with older clients, while the workspace client binds writes to an actor and row.
public sealed class MilestoneWriteProtocol : IEndpointFilter
{
    public const string StateHeader = "X-Workspace-Milestone-State";
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string StateToken(Employee me, Milestone? target, IEnumerable<Milestone> milestones)
    {
        var rows = milestones.Where(x => target is null || x.Id == target.Id).OrderBy(x => x.Id)
            .Select(x => new { x.Id, x.Type, x.Title, x.Description, x.DeadlineMemo, x.Date, x.EndDate, x.AdditionalSchedulesJson, x.ProjectId, x.Version, x.CreatedBy, x.UpdatedBy, x.CreatedAt, x.UpdatedAt }).ToArray();
        var snapshot = new { actor = new { me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId }, rows };
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot, Json)));
    }

    public static object Editing(Employee me, IEnumerable<Milestone> visible)
    {
        var rows = visible.OrderBy(x => x.Id).ToArray();
        return new { actorId = me.Id.ToString(CultureInfo.InvariantCulture), createStateToken = StateToken(me, null, rows),
            milestones = rows.Select(x => new { id = x.Id, stateToken = StateToken(me, x, rows) }).ToArray() };
    }

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (TaskWriteProtocol.Requested(request) && request.Headers[TaskWriteProtocol.ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static string? RequireState(HttpRequest request, Employee me, Milestone? target, IEnumerable<Milestone> visible)
    {
        if (!TaskWriteProtocol.Requested(request)) return null;
        var token = StateToken(me, target, visible);
        if (request.Headers[StateHeader].ToString() != token)
            throw new ApiError(409, "주요 일정 또는 계정 권한이 변경됐습니다. 최신 내용을 다시 확인해 주세요.");
        return token;
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    public static async Task<IResult> Saved(HttpRequest request, ScheduleDb db, Employee me, Milestone milestone,
        string operation, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.Ok(milestone);
        var saved = await db.Milestones.AsNoTracking().SingleAsync(x => x.Id == milestone.Id);
        var rows = await Visible(db, me);
        var data = new { operation, actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, saved, rows), milestone = saved, deleted = false };
        return Envelope(200, "saved", "주요 일정을 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<IResult> Deleted(HttpRequest request, ScheduleDb db, Employee me, Milestone snapshot,
        string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.NoContent();
        var rows = await Visible(db, me);
        var data = new { operation = "delete", actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, null, rows), milestone = snapshot, deleted = true };
        return Envelope(200, "saved", "주요 일정을 삭제했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<List<Milestone>> Visible(ScheduleDb db, Employee me)
    {
        var projectIds = await db.Projects.Where(x => me.IsAdmin || !x.IsPrivate).Select(x => x.Id).ToArrayAsync();
        return await db.Milestones.AsNoTracking().Where(x => x.ProjectId == null || projectIds.Contains(x.ProjectId.Value)).OrderBy(x => x.Id).ToListAsync();
    }

    private static IResult Envelope(int status, string outcome, string message, object? data = null) =>
        Results.Json(new { protocol = "workspace-form-v1", outcome, message, data }, Json, contentType: TaskWriteProtocol.MediaType, statusCode: status);

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
                    return Envelope(409, "conflict", "다른 사람이 주요 일정을 수정했습니다. 최신 내용을 확인해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<MilestoneWriteProtocol>>()
                .LogError(exception, "Milestone write result could not be confirmed");
            return Envelope(500, "unknown", "저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 주요 일정 목록을 확인해 주세요.");
        }
    }
}
