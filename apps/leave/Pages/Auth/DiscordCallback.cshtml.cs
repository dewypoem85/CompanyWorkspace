using LeaveManager.Data;
using LeaveManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Auth;

[Authorize(Policy = "EmployeeOnly")]
public class DiscordCallbackModel(
    CurrentEmployeeService current,
    DiscordDirectMessageService discordDm,
    AppDbContext db,
    IWebHostEnvironment environment,
    ILogger<DiscordCallbackModel> logger) : PageModel
{
    public async Task<IActionResult> OnGet(string? code, string? state, string? error, string? error_description)
    {
        if (!string.IsNullOrWhiteSpace(error))
        {
            logger.LogInformation("Discord OAuth 연동 취소 또는 실패: {Error} {Description}", error, error_description);
            TempData["ErrorMessage"] = "Discord 연동이 취소되었거나 실패했습니다. 다시 시도하세요.";
            return RedirectToPage("/Settings/Discord");
        }

        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
        {
            TempData["ErrorMessage"] = "Discord 연동 응답이 올바르지 않습니다.";
            return RedirectToPage("/Settings/Discord");
        }

        const string stateCookieName = "LeaveManager.DiscordOAuthState";
        var expectedState = Request.Cookies[stateCookieName];
        Response.Cookies.Delete(stateCookieName, new CookieOptions
        {
            Secure = !environment.IsDevelopment(),
            Path = "/"
        });
        if (string.IsNullOrWhiteSpace(expectedState) || !string.Equals(expectedState, state, StringComparison.Ordinal))
        {
            TempData["ErrorMessage"] = "Discord 연동 상태값이 일치하지 않습니다. 다시 시도하세요.";
            return RedirectToPage("/Settings/Discord");
        }

        try
        {
            var user = await discordDm.ExchangeCodeForUserAsync(code);
            var employee = await current.GetRequiredAsync();
            employee.DiscordUserId = user.Id;
            employee.DiscordUsername = user.DisplayName;
            employee.DiscordLinkedAtUtc = AppTime.UtcNow;
            if (string.IsNullOrWhiteSpace(employee.DiscordDmNotificationTypes))
            {
                employee.DiscordDmNotificationTypes = DiscordDmNotificationCatalog.NormalizeSelected(
                    DiscordDmNotificationCatalog.GetAllowed(employee.Role).Select(x => x.Type),
                    employee.Role);
            }
            await db.SaveChangesAsync();

            TempData["StatusMessage"] = $"Discord 계정 {user.DisplayName} 연동이 완료되었습니다. 받을 알림 항목을 확인하고 저장하세요.";
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Discord OAuth 계정 연동 실패");
            TempData["ErrorMessage"] = "Discord 계정 연동에 실패했습니다. 잠시 후 다시 시도하세요.";
        }

        return RedirectToPage("/Settings/Discord");
    }
}
