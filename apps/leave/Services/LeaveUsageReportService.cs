using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class LeaveUsageReportService(AppDbContext db, LeaveCalculationService calc)
{
    public async Task<LeaveUsageReport> BuildAsync(long employeeId, DateOnly asOf)
    {
        var employee = await db.Employees.SingleAsync(x => x.Id == employeeId);
        var lastRequestDate = await db.LeaveRequestDates
            .Where(x => x.LeaveRequest.EmployeeId == employeeId)
            .MaxAsync(x => (DateOnly?)x.Date);
        var lastGrantDate = await db.LeaveGrants
            .Where(x => x.EmployeeId == employeeId)
            .MaxAsync(x => (DateOnly?)x.GrantedDate);

        var reportEnd = MaxDate(asOf, lastRequestDate, lastGrantDate);
        if (reportEnd < employee.HireDate) reportEnd = asOf;

        var maxYearIndex = Math.Max(0, CompletedLeaveYearIndex(employee.HireDate, reportEnd));
        var rows = new List<LeaveUsageYearRow>();

        for (var yearIndex = 0; yearIndex <= maxYearIndex; yearIndex++)
        {
            var periodStart = employee.HireDate.AddYears(yearIndex);
            var periodEnd = employee.HireDate.AddYears(yearIndex + 1).AddDays(-1);

            var grantQuery = db.LeaveGrants.Where(x => x.EmployeeId == employeeId && x.GrantedDate >= periodStart && x.GrantedDate <= periodEnd);
            var granted = await grantQuery.SumAsync(x => (decimal?)x.GrantedDays) ?? 0m;

            var grantIds = await grantQuery.Select(x => x.Id).ToListAsync();
            var settled = grantIds.Count == 0
                ? 0m
                : await db.LeaveSettlements.Where(x => grantIds.Contains(x.SourceGrantId)).SumAsync(x => (decimal?)x.Days) ?? 0m;

            var used = await db.LeaveRequestDates
                .Where(x => x.LeaveRequest.EmployeeId == employeeId &&
                            x.Date >= periodStart && x.Date <= periodEnd &&
                            (x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
                .SumAsync(x => x.IsBirthdayLeave
                    ? 0m
                    : x.Portion == LeaveDayPortion.FullDay
                    ? 1m
                    : x.Portion == LeaveDayPortion.Morning || x.Portion == LeaveDayPortion.Afternoon
                        ? 0.5m
                        : 0m);

            var pending = await db.LeaveRequestDates
                .Where(x => x.LeaveRequest.EmployeeId == employeeId &&
                            x.Date >= periodStart && x.Date <= periodEnd &&
                            x.LeaveRequest.Status == LeaveRequestStatus.Pending)
                .SumAsync(x => x.IsBirthdayLeave
                    ? 0m
                    : x.Portion == LeaveDayPortion.FullDay
                    ? 1m
                    : x.Portion == LeaveDayPortion.Morning || x.Portion == LeaveDayPortion.Afternoon
                        ? 0.5m
                        : 0m);

            var rejectedOrCancelled = await db.LeaveRequestDates
                .Where(x => x.LeaveRequest.EmployeeId == employeeId &&
                            x.Date >= periodStart && x.Date <= periodEnd &&
                            (x.LeaveRequest.Status == LeaveRequestStatus.Rejected || x.LeaveRequest.Status == LeaveRequestStatus.Cancelled))
                .SumAsync(x => x.IsBirthdayLeave
                    ? 0m
                    : x.Portion == LeaveDayPortion.FullDay
                    ? 1m
                    : x.Portion == LeaveDayPortion.Morning || x.Portion == LeaveDayPortion.Afternoon
                        ? 0.5m
                        : 0m);

            var requestCount = await db.LeaveRequests
                .Where(x => x.EmployeeId == employeeId &&
                            x.Dates.Any(d => d.Date >= periodStart && d.Date <= periodEnd))
                .CountAsync();

            rows.Add(new LeaveUsageYearRow(
                YearIndex: yearIndex,
                Label: yearIndex == 0 ? "0년차" : $"{yearIndex}년차",
                PeriodStart: periodStart,
                PeriodEnd: periodEnd,
                GrantedDays: granted,
                UsedDays: used,
                PendingDays: pending,
                RejectedOrCancelledDays: rejectedOrCancelled,
                SettledDays: settled,
                RequestCount: requestCount,
                IsCurrent: periodStart <= asOf && asOf <= periodEnd));
        }

        var currentBalance = await calc.GetCurrentLeaveYearBalanceAsync(employeeId, asOf);

        return new LeaveUsageReport(employee, rows, currentBalance);
    }

    private static int CompletedLeaveYearIndex(DateOnly hireDate, DateOnly date)
    {
        var years = date.Year - hireDate.Year;
        var anniversary = hireDate.AddYears(years);
        if (anniversary > date) years--;
        return Math.Max(0, years);
    }

    private static DateOnly MaxDate(DateOnly baseDate, DateOnly? a, DateOnly? b)
    {
        var result = baseDate;
        if (a.HasValue && a.Value > result) result = a.Value;
        if (b.HasValue && b.Value > result) result = b.Value;
        return result;
    }
}

public record LeaveUsageReport(Employee Employee, List<LeaveUsageYearRow> Rows, LeaveBalance CurrentBalance)
{
    public decimal TotalUsed => Rows.Sum(x => x.UsedDays);
    public decimal TotalPending => Rows.Sum(x => x.PendingDays);
    public int TotalRequestCount => Rows.Sum(x => x.RequestCount);
}

public record LeaveUsageYearRow(
    int YearIndex,
    string Label,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    decimal GrantedDays,
    decimal UsedDays,
    decimal PendingDays,
    decimal RejectedOrCancelledDays,
    decimal SettledDays,
    int RequestCount,
    bool IsCurrent);
