using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages;

public class IndexModel : PageModel
{
    public IActionResult OnGet()
    {
        // The protected page establishes the local session through Portal SSO when needed.
        // A separate anonymous landing page cannot determine the Portal login state.
        Response.Headers.CacheControl = "no-store";
        return RedirectToPage("/Leave/Index");
    }
}
