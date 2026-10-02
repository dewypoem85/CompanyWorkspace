using CompanyPortal.Models;
using Microsoft.AspNetCore.Routing;

namespace CompanyPortal.Services;

public static class PushApi
{
    public static void MapPushDevices(this RouteGroupBuilder group)
    {
        group.MapGet("/push/devices", async (HttpContext context, CurrentUserService current, PushDeviceService devices) =>
        {
            if (context.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var user = await current.GetRequiredAsync();
            if (!ExpectedMatches(context, user.Id)) return Conflict();
            return Results.Ok(await devices.ListAsync(user.Id, context.RequestAborted));
        });
        group.MapPost("/push/devices", async (HttpContext context, PushDeviceRegistration input, CurrentUserService current, PushDeviceService devices) =>
        {
            var user = await current.GetRequiredAsync();
            var sessionId = context.User.FindFirst(WorkspaceApi.SessionClaim)?.Value;
            if (string.IsNullOrWhiteSpace(sessionId)) return Results.Unauthorized();
            try { return Results.Ok(await devices.RegisterAsync(user, sessionId, input, context.RequestAborted)); }
            catch (PushInputException exception) { return Results.UnprocessableEntity(new { error = exception.Message }); }
            catch (PushConflictException exception) { return Results.Conflict(new { error = exception.Message }); }
            catch (HttpRequestException) { return Results.Json(new { error = "알림 서비스 연결을 확인한 뒤 다시 시도해 주세요." }, statusCode: 503); }
        });
        group.MapPatch("/push/devices/{installationId}", async (string installationId, HttpContext context, PushDevicePreferences input, CurrentUserService current, PushDeviceService devices) =>
        {
            var user = await current.GetRequiredAsync();
            try { return Results.Ok(await devices.UpdateAsync(user, installationId, input, context.RequestAborted)); }
            catch (PushInputException exception) { return Results.UnprocessableEntity(new { error = exception.Message }); }
            catch (PushConflictException exception) { return Results.Conflict(new { error = exception.Message }); }
            catch (KeyNotFoundException) { return Results.NotFound(new { error = "등록된 앱 기기를 찾을 수 없습니다." }); }
            catch (HttpRequestException) { return Results.Json(new { error = "알림 서비스 연결을 확인한 뒤 다시 시도해 주세요." }, statusCode: 503); }
        });
        group.MapDelete("/push/devices/{installationId}", async (string installationId, HttpContext context, CurrentUserService current, PushDeviceService devices) =>
        {
            var user = await current.GetRequiredAsync();
            var expected = context.Request.Query["expectedUserId"];
            if (expected.Count != 1) return Conflict();
            try { await devices.DisableAsync(user, installationId, expected[0]!, context.RequestAborted); return Results.NoContent(); }
            catch (PushConflictException exception) { return Results.Conflict(new { error = exception.Message }); }
            catch (KeyNotFoundException) { return Results.NotFound(new { error = "등록된 앱 기기를 찾을 수 없습니다." }); }
        });
    }

    private static bool ExpectedMatches(HttpContext context, long userId)
    {
        var expected = context.Request.Query["expectedUserId"];
        return expected.Count == 1 && expected[0] == userId.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }
    private static IResult Conflict() => Results.Conflict(new { error = "푸시 알림을 설정하는 계정이 변경되었습니다." });
}
