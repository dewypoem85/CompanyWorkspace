using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
namespace LeaveManager.Pages.Account;
public class LogoutModel(IConfiguration configuration) : PageModel
{
    public async Task<IActionResult> OnGet()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var portalBaseUrl = (configuration["CompanyPortal:BaseUrl"] ?? "").Trim().TrimEnd('/');
        return Uri.TryCreate(portalBaseUrl, UriKind.Absolute, out _)
            ? Redirect(portalBaseUrl + "/")
            : RedirectToPage("/Index");
    }
}
