using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace LeaveManager.Services;

public class CurrentEmployeeService(AppDbContext db, IHttpContextAccessor accessor)
{
    public async Task<Employee> GetRequiredAsync()
    {
        var idText = accessor.HttpContext?.User.FindFirstValue("EmployeeId");
        if (!long.TryParse(idText, out var id)) throw new UnauthorizedAccessException();
        return await db.Employees.SingleAsync(x => x.Id == id && x.IsActive);
    }
}
