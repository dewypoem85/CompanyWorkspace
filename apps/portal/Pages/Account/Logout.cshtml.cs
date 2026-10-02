using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CompanyPortal.Pages.Account;

public class LogoutModel(CompanyPortal.Data.AppDbContext db) : PageModel
{
    public async Task<IActionResult> OnPostAsync()
    {
        var sid = User.FindFirst(CompanyPortal.Services.WorkspaceApi.SessionClaim)?.Value ?? "";
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceSessions SET Revoked=1 WHERE Id={sid}");
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToPage("/Index");
    }
}
