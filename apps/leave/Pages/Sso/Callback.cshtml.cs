using System.Security.Claims;
using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Sso;

[IgnoreAntiforgeryToken(Order = 1001)]
[RequestSizeLimit(64 * 1024)]
public class CallbackModel(
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
            portalUser = sso.VerifyAndConsume(token ?? "");
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

        CompanyEmployeeProjectionResult projectionResult;
        try
        {
            projectionResult = await projection.ApplyAsync(portalUser, HttpContext.RequestAborted);
        }
        catch (CompanyEmployeeConflictException ex)
        {
            return new ContentResult
            {
                StatusCode = StatusCodes.Status409Conflict,
                ContentType = "text/plain; charset=utf-8",
                Content = ex.Message + " 회사 포털 관리자에게 문의하세요."
            };
        }

        var employee = projectionResult.Employee;
        if (employee is null || !employee.IsActive)
        {
            return new ContentResult
            {
                StatusCode = StatusCodes.Status401Unauthorized,
                ContentType = "text/plain; charset=utf-8",
                Content = "연차관리 접근 권한이 없습니다."
            };
        }

        await LeaveAccrualWorker.EnsureGrantsAsync(db, employee, AppTime.Today, HttpContext.RequestAborted);

        var claims = new List<Claim>
        {
            new("EmployeeId", employee.Id.ToString()),
            new(ClaimTypes.Name, employee.Name),
            new(ClaimTypes.Email, employee.Email),
            new("CompanyUserId", portalUser.CompanyUserId.ToString()),
            new("CompanySessionId", portalUser.SessionId ?? ""),
            new("CompanyRole", portalUser.CompanyRole)
        };
        if (employee.Role is EmployeeRole.Admin or EmployeeRole.Master)
            claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        if (employee.Role == EmployeeRole.Master)
            claims.Add(new Claim(ClaimTypes.Role, "Master"));

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                AllowRefresh = true
            });

        var returnUrl = !string.IsNullOrWhiteSpace(portalUser.ReturnUrl) && Url.IsLocalUrl(portalUser.ReturnUrl)
            ? portalUser.ReturnUrl
            : "/Leave/Index";
        return LocalRedirect(returnUrl);
    }
}
