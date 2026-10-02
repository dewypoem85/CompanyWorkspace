using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Opt-in release write envelope. Legacy callers keep bare ReleaseRecord responses.
public sealed class ReleaseWriteProtocol : IEndpointFilter
{
    public const string StateHeader = "X-Workspace-Release-State";
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string StateToken(Employee me, ReleaseRecord? target, IEnumerable<ReleaseRecord> releases)
    {
        var rows = releases.Where(x => target is null || x.Id == target.Id).OrderBy(x => x.Id).Select(x => new
        {
            x.Id, x.ProjectId, x.BaseVersion, x.Minor, x.ReleasedOn, x.ReleasedOnUnknown, x.Notes, x.Status,
            x.Issue, x.RollbackTargetId, x.ResolvedInId, x.CreatedBy, x.SourceReference, x.Version, x.UpdatedAt
        }).ToArray();
        var snapshot = new { actor = new { me.Id, me.Role, me.Active, me.Shared, me.Access, me.IsAdmin, me.DepartmentId }, rows };
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot, Json)));
    }

    public static object Editing(Employee me, ReleaseRecord? target, IEnumerable<ReleaseRecord> releases) => new
    {
        actorId = me.Id.ToString(CultureInfo.InvariantCulture), stateToken = StateToken(me, target, releases), record = target
    };

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (TaskWriteProtocol.Requested(request) && request.Headers[TaskWriteProtocol.ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static string? RequireState(HttpRequest request, Employee me, ReleaseRecord? target, IEnumerable<ReleaseRecord> releases)
    {
        if (!TaskWriteProtocol.Requested(request)) return null;
        var token = StateToken(me, target, releases);
        if (request.Headers[StateHeader].ToString() != token)
            throw new ApiError(409, "업데이트 버전 또는 계정 권한이 변경됐습니다. 최신 내용을 다시 확인해 주세요.");
        return token;
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    public static async Task<IResult> Saved(HttpRequest request, ScheduleDb db, Employee me, ReleaseRecord record,
        string operation, string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.Ok(record);
        var saved = await db.Releases.AsNoTracking().SingleAsync(x => x.Id == record.Id);
        var rows = await ProjectRows(db, saved.ProjectId);
        var data = new { operation, actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, saved, rows), release = saved, deleted = false };
        return Envelope(200, "saved", "업데이트 버전을 저장했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static async Task<IResult> Deleted(HttpRequest request, ScheduleDb db, Employee me, ReleaseRecord record,
        string? previousStateToken)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.NoContent();
        var rows = await ProjectRows(db, record.ProjectId);
        var data = new { operation = "delete", actorId = me.Id.ToString(CultureInfo.InvariantCulture), previousStateToken,
            stateToken = StateToken(me, null, rows), release = record, deleted = true };
        return Envelope(200, "saved", "업데이트 버전을 삭제했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    public static Task<List<ReleaseRecord>> ProjectRows(ScheduleDb db, long projectId) => db.Releases.AsNoTracking()
        .Where(x => x.ProjectId == projectId).OrderBy(x => x.Id).ToListAsync();

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
                    return Envelope(409, "conflict", "다른 사람이 업데이트 버전을 수정했습니다. 최신 내용을 비교해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<ReleaseWriteProtocol>>()
                .LogError(exception, "Release write result could not be confirmed");
            return Envelope(500, "unknown", "저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 업데이트 버전 목록을 확인해 주세요.");
        }
    }
}
