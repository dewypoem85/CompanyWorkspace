using LeaveManager.Data;
using LeaveManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Sso;

[AllowAnonymous]
[IgnoreAntiforgeryToken(Order = 1001)]
[RequestSizeLimit(64 * 1024)]
public class ProvisionModel(
    AppDbContext db,
    CompanySsoService sso,
    CompanyEmployeeProjectionService projection) : PageModel
{
    public async Task<IActionResult> OnPostAsync()
    {
        Response.Headers.CacheControl = "no-store";
        if (Request.ContentLength is > 64 * 1024)
            return new StatusCodeResult(StatusCodes.Status413PayloadTooLarge);
        if (!Request.HasFormContentType)
            return new StatusCodeResult(StatusCodes.Status400BadRequest);

        var token = (await Request.ReadFormAsync(HttpContext.RequestAborted))["token"].ToString();
        CompanySsoUser portalUser;
        try
        {
            portalUser = sso.VerifyProvisionAndConsume(token ?? "");
        }
        catch (UnauthorizedAccessException ex)
        {
            return new ContentResult
            {
                StatusCode = StatusCodes.Status401Unauthorized,
                ContentType = "text/plain; charset=utf-8",
                Content = ex.Message
            };
        }
        catch (InvalidOperationException ex)
        {
            return new ContentResult
            {
                StatusCode = StatusCodes.Status503ServiceUnavailable,
                ContentType = "text/plain; charset=utf-8",
                Content = ex.Message
            };
        }

        CompanyEmployeeProjectionResult result;
        try
        {
            result = await projection.ApplyAsync(portalUser, HttpContext.RequestAborted);
        }
        catch (CompanyEmployeeConflictException ex)
        {
            return new ContentResult
            {
                StatusCode = StatusCodes.Status409Conflict,
                ContentType = "text/plain; charset=utf-8",
                Content = ex.Message
            };
        }

        if (result.Employee?.IsActive == true)
            await LeaveAccrualWorker.EnsureGrantsAsync(db, result.Employee, AppTime.Today, HttpContext.RequestAborted);

        return new StatusCodeResult(StatusCodes.Status204NoContent);
    }
}
