using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LeaveManager.Models;

namespace LeaveManager.Services;

// Read-time baseline, not an atomic concurrency token or authorization credential.
public static class LeaveRequestSnapshot
{
    public static string Compute(LeaveRequest request) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
        request.Id, request.EmployeeId, request.Status, request.RequestedAtUtc, request.DecidedAtUtc, request.DecidedByEmployeeId,
        request.CancelRequestedAtUtc, request.CancelDecidedAtUtc, request.CancelDecidedByEmployeeId,
        request.Reason, request.WorkPlan, request.CalculatedDays, request.IsAdvance, request.AdvanceDays, request.AdvanceRepaymentDays,
        request.MonthlyAdvanceDays, request.AnnualAdvanceDays, request.MonthlyAdvanceRepaymentDays, request.AnnualAdvanceRepaymentDays,
        request.BirthdayBenefitDate, request.IsBirthdayPolicyOverride,
        dates = request.Dates.OrderBy(x => x.Date).ThenBy(x => x.Portion).Select(x => new { x.Date, x.Portion, x.IsBirthdayLeave })
    }))));
}
