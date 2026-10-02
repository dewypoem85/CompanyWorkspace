using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Leave;

public class ApplyModel : PageModel
{
    public IActionResult OnGet() => RedirectToPage("Index");
}
