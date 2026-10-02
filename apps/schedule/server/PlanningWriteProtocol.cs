using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

// Shared form-envelope adapter for goals, task schedule items and shared task TODOs.
// Row versions remain the domain concurrency boundary; the common transport owns
// request observation and never retries an uncertain write.
public sealed class PlanningWriteProtocol : IEndpointFilter
{
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;
    public static IResult Saved(string operation, object value) => Envelope(200, "saved", "변경사항을 저장했습니다.", new { operation, value });
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
                    return Envelope(409, "conflict", "다른 사람이 먼저 수정했습니다. 최신 내용을 다시 확인해 주세요.");
            }
            context.HttpContext.RequestServices.GetRequiredService<ILogger<PlanningWriteProtocol>>()
                .LogError(exception, "Work planning write result could not be confirmed");
            return Envelope(500, "unknown", "저장 결과를 확인할 수 없습니다. 다시 저장하지 말고 업무 상세를 확인해 주세요.");
        }
    }
}
