using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public class EmployeesModel(AppDbContext db, IConfiguration configuration) : PageModel
{
    public List<Employee> Employees { get; private set; } = [];
    public string PortalUsersUrl { get; private set; } = "#";

    public async Task OnGetAsync()
    {
        Employees = await db.Employees
            .AsNoTracking()
            .Where(x => !x.IsSharedAccount && !x.IsCompanyMaster)
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.Name)
            .ThenBy(x => x.Email)
            .ToListAsync();

        var portalBaseUrl = (configuration["CompanyPortal:BaseUrl"] ?? "").Trim().TrimEnd('/');
        if (Uri.TryCreate(portalBaseUrl, UriKind.Absolute, out _))
            PortalUsersUrl = portalBaseUrl + "/Admin/Users";
    }

    public static string RoleLabel(EmployeeRole role) => role switch
    {
        EmployeeRole.Master => "회사 관리자/마스터",
        EmployeeRole.Admin => "이전 관리자 역할",
        _ => "직원"
    };
}
