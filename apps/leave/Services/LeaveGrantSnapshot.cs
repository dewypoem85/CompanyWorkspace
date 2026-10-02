using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

// Read-time fingerprints, not authorization, atomic concurrency tokens or idempotency keys.
public static class LeaveGrantSnapshot
{
    public static string Hash(object value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value))));
    public static string Employee(Employee employee) => Hash(new {
        employee.Id, employee.CompanyUserId, employee.Name, employee.Email, employee.HireDate, employee.BirthDate,
        employee.IsActive, employee.IsSharedAccount, employee.IsCompanyMaster, employee.IsPrivate
    });
    public static async Task<string> ComputeAsync(AppDbContext db, LeaveGrant grant)
    {
        var allocations = await db.LeaveAllocations.AsNoTracking().Where(x => x.LeaveGrantId == grant.Id)
            .OrderBy(x => x.Id).Select(x => new { x.Id, x.LeaveRequestId, x.Days, x.LeaveRequest.Status }).ToListAsync();
        var settlements = await db.LeaveSettlements.AsNoTracking().Where(x => x.SourceGrantId == grant.Id)
            .OrderBy(x => x.Id).Select(x => new { x.Id, x.Type, x.Days, x.CreatedGrantId, x.AdvanceLeaveRequestId }).ToListAsync();
        return Hash(new { grant.Id, grant.EmployeeId, grant.GrantType, grant.BenefitYear, grant.GrantedDate, grant.ExpiresDate, grant.GrantedDays,
            grant.SourceGrantId, grant.Note, grant.IsImported, createdTicks = grant.CreatedAtUtc.Ticks, allocations, settlements });
    }
}
