using CompanyPortal.Services;
using CompanyPortal.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CompanyPortal.Pages.Auth;

public class LaunchModel(CurrentUserService currentUser, SsoTokenService sso) : PageModel
{
    public string CallbackUrl { get; private set; } = "";
    public string Token { get; private set; } = "";
    public string SystemName { get; private set; } = "";

    public async Task<IActionResult> OnGetAsync(string system, string? returnUrl = null)
    {
        Response.Headers.CacheControl = "no-store";
        var user = await currentUser.GetRequiredAsync();
        try
        {
            var launch = sso.Create(user, system, returnUrl);
            CallbackUrl = launch.CallbackUrl;
            Token = launch.Token;
            SystemName = CompanySystemCatalog.Find(system)?.Name ?? system;
            return Page();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, ex.Message);
        }
    }
}
