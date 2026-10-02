using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Master;

public class EmployeesModel(AppDbContext db, IConfiguration configuration) : PageModel
{
    public List<Employee> Employees { get; private set; } = [];
    public string PortalUsersUrl { get; private set; } = "#";

    public async Task OnGetAsync()
    {
        Employees = await db.Employees
            .Where(x => !x.IsSharedAccount && !x.IsCompanyMaster)
            .OrderByDescending(x => x.Role)
            .ThenBy(x => x.Name)
            .ToListAsync();
        var portal = (configuration["CompanyPortal:BaseUrl"] ?? "").Trim().TrimEnd('/');
        if (Uri.TryCreate(portal, UriKind.Absolute, out _))
            PortalUsersUrl = portal + "/Admin/Users";
    }
}
