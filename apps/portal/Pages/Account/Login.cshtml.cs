using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CompanyPortal.Pages.Account;

public class LoginModel : PageModel
{
    public IActionResult OnGet(string? returnUrl = null)
    {
        if (User.Identity?.IsAuthenticated == true)
            return LocalRedirect(IsSafeReturnUrl(returnUrl) ? returnUrl! : "/");

        var redirectUri = IsSafeReturnUrl(returnUrl) ? returnUrl! : "/";
        return Challenge(new AuthenticationProperties
        {
            RedirectUri = redirectUri,
            IsPersistent = false,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
        }, GoogleDefaults.AuthenticationScheme);
    }

    private static bool IsSafeReturnUrl(string? value)
        => !string.IsNullOrWhiteSpace(value)
           && value.StartsWith('/')
           && !value.StartsWith("//")
           && value.Length <= 2048;
}
