using System.Text.Json;
using System.Globalization;

namespace Schedule;

public sealed class FeedbackWriteProtocol : IEndpointFilter
{
    public const string MediaType = "application/vnd.company.workspace-form+json";
    public const string ActorHeader = "X-Workspace-Actor";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static IResult Saved(Employee actor, string operation, object result, string message) => Results.Json(new { protocol = "workspace-form-v1", outcome = "saved", message, data = new { operation, actorId = actor.Id.ToString(CultureInfo.InvariantCulture), result } }, Json, contentType: MediaType);
    private static IResult Failure(int status, string outcome, string message) => Results.Json(new { protocol = "workspace-form-v1", outcome, message }, Json, contentType: MediaType, statusCode: status);
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        try
        {
            var me = await context.HttpContext.RequestServices.GetRequiredService<Access>().Me();
            if (context.HttpContext.Request.Headers[ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
                throw new ApiError(409, "작성 중인 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
            return await next(context);
        }
        catch (ApiError error)
        {
            var status = error.Status is 400 or 413 or 429 ? 422 : error.Status;
            var outcome = status == 422 ? "invalid" : status == 409 ? "conflict" : status is 401 or 403 ? "denied" : "unknown";
            return Failure(status, outcome, error.Message);
        }
    }
}
