using LeaveManager.Data;
using LeaveManager.Services;
using LeaveManager.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public class UsageModel(AppDbContext db, LeaveUsageReportService usage) : PageModel
{
    [BindProperty(SupportsGet = true)] public long? EmployeeId { get; set; }
    public List<Employee> Employees { get; set; } = [];
    public LeaveUsageReport? Report { get; set; }
    public List<LeaveUsageReport> Reports { get; set; } = [];
    public bool ShowAll { get; set; }
    public DateOnly Today { get; set; } = AppTime.Today;

    public async Task OnGet()
    {
        Employees = await db.Employees
            .Where(x => !x.IsSharedAccount && !x.IsCompanyMaster)
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.Name)
            .ToListAsync();

        if (EmployeeId == 0)
        {
            ShowAll = true;
            foreach (var employee in Employees)
            {
                Reports.Add(await usage.BuildAsync(employee.Id, Today));
            }
            return;
        }

        var selectedId = EmployeeId ?? Employees.FirstOrDefault()?.Id;
        if (selectedId.HasValue && Employees.Any(x => x.Id == selectedId.Value))
        {
            EmployeeId = selectedId.Value;
            Report = await usage.BuildAsync(selectedId.Value, Today);
        }
    }

    public string FormatDays(decimal days) => days % 1 == 0 ? ((int)days).ToString() : days.ToString("0.0");
    public decimal CurrentUsed(LeaveUsageReport report) => report.Rows.FirstOrDefault(x => x.IsCurrent)?.UsedDays ?? 0m;
    public decimal CurrentPending(LeaveUsageReport report) => report.Rows.FirstOrDefault(x => x.IsCurrent)?.PendingDays ?? 0m;
    public decimal CurrentGranted(LeaveUsageReport report) => report.CurrentBalance.Granted;
    public decimal CurrentAvailable(LeaveUsageReport report) => report.CurrentBalance.Available;
    public string CurrentYearLabel(LeaveUsageReport report) => report.Rows.FirstOrDefault(x => x.IsCurrent)?.Label ?? "-";
    public string RoleName(EmployeeRole role) => role switch { EmployeeRole.Master => "마스터", EmployeeRole.Admin => "관리자", _ => "직원" };
}
