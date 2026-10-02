using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Leave;

public class UsageModel(CurrentEmployeeService current, LeaveUsageReportService usage) : PageModel
{
    public LeaveUsageReport Report { get; set; } = null!;
    public DateOnly Today { get; set; } = AppTime.Today;

    public async Task OnGet()
    {
        var employee = await current.GetRequiredAsync();
        Report = await usage.BuildAsync(employee.Id, Today);
    }

    public string FormatDays(decimal days) => days % 1 == 0 ? ((int)days).ToString() : days.ToString("0.0");
}
