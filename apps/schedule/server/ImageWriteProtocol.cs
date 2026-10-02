using System.Globalization;
using System.Text.Json;

namespace Schedule;

// Opt-in envelope for temporary image writes. Legacy multipart clients keep the
// Attachment response; business validation and file ownership remain in ImageRoutes.
public sealed class ImageWriteProtocol : IEndpointFilter
{
    private static readonly object WriteBoundary = new();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void RequireActor(HttpRequest request, Employee me)
    {
        if (TaskWriteProtocol.Requested(request) && request.Headers[TaskWriteProtocol.ActorHeader].ToString() != me.Id.ToString(CultureInfo.InvariantCulture))
            throw new ApiError(409, "이미지를 선택한 계정과 현재 계정이 다릅니다. 새 화면에서 확인해 주세요.");
    }

    public static void StartingWrite(HttpRequest request) => request.HttpContext.Items[WriteBoundary] = true;

    public static IResult Saved(HttpRequest request, Employee me, Attachment attachment, string sha256)
    {
        if (!TaskWriteProtocol.Requested(request)) return Results.Ok(attachment);
        var data = new { operation = "upload", actorId = me.Id.ToString(CultureInfo.InvariantCulture), sha256, attachment };
        return Envelope(200, "saved", "이미지를 업로드했습니다.", JsonSerializer.SerializeToElement(data, Json));
    }

    private static IResult Envelope(int status, string outcome, string message, object? data = null) =>
        Results.Json(new { protocol = "workspace-form-v1", outcome, message, data }, Json,
            contentType: TaskWriteProtocol.MediaType, statusCode: status);

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var request = context.HttpContext.Request;
        if (!TaskWriteProtocol.Requested(request)) return await next(context);
        try { return await next(context); }
        catch (Exception exception)
        {
            if (!context.HttpContext.Items.ContainsKey(WriteBoundary) && exception is ApiError error)
                return Envelope(error.Status == 400 || error.Status == 413 || error.Status == 429 ? 422 : error.Status,
                    error.Status switch { 400 or 413 or 429 => "invalid", 409 => "conflict", 401 or 403 => "denied", _ => "unknown" }, error.Message);
            context.HttpContext.RequestServices.GetRequiredService<ILogger<ImageWriteProtocol>>()
                .LogError(exception, "Image upload result could not be confirmed");
            return Envelope(500, "unknown", "업로드 결과를 확인할 수 없습니다. 같은 파일을 다시 보내지 말고 새 화면에서 첨부 목록을 확인해 주세요.");
        }
    }
}
