using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Workspace;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public sealed class LeaveNavigationBadges(AppDbContext db) : IWorkspaceNavigationBadges
{
    public async Task<Dictionary<string, int>> GetAsync(HttpContext context, IReadOnlyCollection<string> allowedPages)
    {
        if (!allowedPages.Contains("leave.approvals")) return [];
        var count = await db.LeaveRequests.CountAsync(x => !x.Employee.IsCompanyMaster &&
            (x.Status == LeaveRequestStatus.Pending || x.Status == LeaveRequestStatus.CancelRequested), context.RequestAborted);
        return new() { ["leave.approvals"] = count };
    }
}
