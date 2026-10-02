using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Account;

public class LoginModel(IConfiguration configuration) : PageModel
{
    public IActionResult OnGet(string? returnUrl = null)
        => StartLogin(returnUrl);

    public IActionResult OnPost(string? returnUrl = null)
        => StartLogin(returnUrl);

    private IActionResult StartLogin(string? returnUrl)
    {
        var safeReturnUrl = !string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl)
            ? returnUrl
            : "/Leave/Index";

        var portalBaseUrl = (configuration["CompanyPortal:BaseUrl"] ?? "").Trim().TrimEnd('/');
        if (!Uri.TryCreate(portalBaseUrl, UriKind.Absolute, out var portalUri)
            || (portalUri.Scheme != Uri.UriSchemeHttps && portalUri.Host is not "localhost" and not "127.0.0.1"))
            return StatusCode(StatusCodes.Status503ServiceUnavailable, "CompanyPortal:BaseUrl 설정이 올바르지 않습니다.");

        return Redirect($"{portalBaseUrl}/Auth/leave?returnUrl={Uri.EscapeDataString(safeReturnUrl)}");
    }
}
