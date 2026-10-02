using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Leave;

public class CalendarModel : PageModel
{
    public IActionResult OnGet(int? year, int? month)
        => RedirectToPage("/Leave/Index", new { Year = year, Month = month });
}
