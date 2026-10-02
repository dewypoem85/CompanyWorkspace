using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public record LeaveBalance(decimal Granted, decimal ReservedOrUsed, decimal Settled, decimal Available);
public record CurrentLeaveYearSummary(DateOnly PeriodStart, DateOnly PeriodEnd, decimal Granted, decimal Used, decimal Pending, decimal Settled, decimal Available);
public record AdvanceOutstanding(decimal Monthly, decimal Annual, decimal Total);

public class LeaveCalculationService(AppDbContext db)
{
    public async Task<LeaveBalance> GetBalanceAsync(long employeeId, DateOnly asOf)
    {
        var grants = await db.LeaveGrants
            .Where(x => x.EmployeeId == employeeId && x.GrantedDate <= asOf && x.ExpiresDate >= asOf)
            .ToListAsync();
        var grantIds = grants.Select(x => x.Id).ToArray();
        if (grantIds.Length == 0) return new(0, 0, 0, 0);

        var allocations = await db.LeaveAllocations
            .Where(x => grantIds.Contains(x.LeaveGrantId) &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
                 x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                 x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
            .SumAsync(x => (decimal?)x.Days) ?? 0m;
        var settled = await db.LeaveSettlements.Where(x => grantIds.Contains(x.SourceGrantId)).SumAsync(x => (decimal?)x.Days) ?? 0m;
        var granted = grants.Sum(x => x.GrantedDays);
        return new(granted, allocations, settled, Math.Max(0, granted - allocations - settled));
    }

    public async Task<LeaveBalance> GetCurrentLeaveYearBalanceAsync(long employeeId, DateOnly asOf)
    {
        var summary = await GetCurrentLeaveYearSummaryAsync(employeeId, asOf);
        return new(summary.Granted, summary.Used + summary.Pending, summary.Settled, summary.Available);
    }

    public async Task<CurrentLeaveYearSummary> GetCurrentLeaveYearSummaryAsync(long employeeId, DateOnly asOf)
    {
        var employee = await db.Employees.SingleAsync(x => x.Id == employeeId);
        var (periodStart, periodEnd) = GetCurrentLeaveYearPeriod(employee.HireDate, asOf);

        var grants = await db.LeaveGrants
            .Where(x => x.EmployeeId == employeeId &&
                        x.GrantedDate >= periodStart &&
                        x.GrantedDate <= periodEnd &&
                        x.GrantedDate <= asOf &&
                        x.ExpiresDate >= asOf)
            .ToListAsync();

        var grantIds = grants.Select(x => x.Id).ToArray();
        var settled = grantIds.Length == 0
            ? 0m
            : await db.LeaveSettlements
                .Where(x => grantIds.Contains(x.SourceGrantId))
                // 가불 차감 정산 중 실제 사용일이 현재 연차년도 안에 있는 건 used/pending에서 이미 차감된다.
                // 이 경우 settlement까지 다시 빼면 월차 가불이 이중 차감되므로, 해당 정산은 현재년도 요약의 settled에서는 제외한다.
                .Where(x => x.Type != LeaveSettlementType.AdvanceRepayment ||
                            x.AdvanceLeaveRequestId == null ||
                            !db.LeaveRequestDates.Any(d => d.LeaveRequestId == x.AdvanceLeaveRequestId && d.Date >= periodStart && d.Date <= periodEnd))
                .SumAsync(x => (decimal?)x.Days) ?? 0m;

        var used = await db.LeaveRequestDates
            .Where(x => x.LeaveRequest.EmployeeId == employeeId &&
                        x.Date >= periodStart && x.Date <= periodEnd &&
                        (x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                         x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
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

        // 화면에 표시되는 남은 연차는 반드시 같은 기준에서 계산한다.
        // 따라서 "지급 - 사용 - 승인대기"가 남은 연차가 되며,
        // 기존 배정 테이블(LeaveAllocations)의 누락/오차가 있어도 카드 표시가 따로 놀지 않는다.
        var granted = Math.Max(0m, grants.Sum(x => x.GrantedDays) - settled);
        var available = Math.Max(0m, granted - used - pending);
        return new(periodStart, periodEnd, granted, used, pending, settled, available);
    }

    public async Task<List<LeaveGrantBalance>> GetCurrentLeaveYearGrantBalancesAsync(long employeeId, DateOnly asOf)
    {
        var employee = await db.Employees.SingleAsync(x => x.Id == employeeId);
        var (periodStart, periodEnd) = GetCurrentLeaveYearPeriod(employee.HireDate, asOf);

        var grants = await db.LeaveGrants
            .Include(x => x.Employee)
            .Where(x => x.EmployeeId == employeeId &&
                        x.GrantedDate >= periodStart &&
                        x.GrantedDate <= periodEnd &&
                        x.GrantedDate <= asOf &&
                        x.ExpiresDate >= asOf)
            .OrderBy(x => x.ExpiresDate)
            .ThenBy(x => x.GrantedDate)
            .ToListAsync();

        var result = new List<LeaveGrantBalance>();
        foreach (var grant in grants)
        {
            var allocated = await db.LeaveAllocations.Where(x => x.LeaveGrantId == grant.Id &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
                 x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                 x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
                .SumAsync(x => (decimal?)x.Days) ?? 0m;

            var settled = await db.LeaveSettlements
                .Where(x => x.SourceGrantId == grant.Id)
                .SumAsync(x => (decimal?)x.Days) ?? 0m;

            result.Add(new(grant, Math.Max(0, grant.GrantedDays - allocated - settled)));
        }

        return result;
    }

    public static (DateOnly Start, DateOnly End) GetCurrentLeaveYearPeriod(DateOnly hireDate, DateOnly asOf)
    {
        var years = asOf.Year - hireDate.Year;
        var start = hireDate.AddYears(years);
        if (start > asOf) start = hireDate.AddYears(years - 1);
        var end = start.AddYears(1).AddDays(-1);
        return (start, end);
    }

    public async Task<List<LeaveGrantBalance>> GetGrantBalancesAsync(long employeeId, DateOnly asOf, bool includeExpired = false)
    {
        var query = db.LeaveGrants.Include(x => x.Employee).Where(x => x.EmployeeId == employeeId && x.GrantedDate <= asOf);
        if (!includeExpired) query = query.Where(x => x.ExpiresDate >= asOf);

        var grants = await query.OrderBy(x => x.ExpiresDate).ThenBy(x => x.GrantedDate).ToListAsync();
        var result = new List<LeaveGrantBalance>();
        foreach (var grant in grants)
        {
            var allocated = await db.LeaveAllocations.Where(x => x.LeaveGrantId == grant.Id &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending || x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
                .SumAsync(x => (decimal?)x.Days) ?? 0m;
            var settled = await db.LeaveSettlements.Where(x => x.SourceGrantId == grant.Id).SumAsync(x => (decimal?)x.Days) ?? 0m;
            result.Add(new(grant, Math.Max(0, grant.GrantedDays - allocated - settled)));
        }
        return result;
    }

    public async Task<AdvanceOutstanding> GetOutstandingAdvanceBreakdownAsync(long employeeId)
    {
        var advances = await db.LeaveRequests
            .Where(x => x.EmployeeId == employeeId &&
                        x.IsAdvance &&
                        (x.Status == LeaveRequestStatus.Pending ||
                         x.Status == LeaveRequestStatus.Approved ||
                         x.Status == LeaveRequestStatus.CancelRequested))
            .Select(x => new
            {
                x.AdvanceDays,
                x.AdvanceRepaymentDays,
                x.MonthlyAdvanceDays,
                x.AnnualAdvanceDays,
                x.MonthlyAdvanceRepaymentDays,
                x.AnnualAdvanceRepaymentDays
            })
            .ToListAsync();

        decimal monthly = 0m;
        decimal annual = 0m;
        foreach (var x in advances)
        {
            var hasBreakdown = x.MonthlyAdvanceDays > 0m || x.AnnualAdvanceDays > 0m;
            if (hasBreakdown)
            {
                monthly += Math.Max(0m, x.MonthlyAdvanceDays - x.MonthlyAdvanceRepaymentDays);
                annual += Math.Max(0m, x.AnnualAdvanceDays - x.AnnualAdvanceRepaymentDays);
            }
            else
            {
                // v9.41 계열에서 생성된 구형 가불 기록은 전부 다음 연차 차감 대상으로 취급한다.
                annual += Math.Max(0m, x.AdvanceDays - x.AdvanceRepaymentDays);
            }
        }

        return new AdvanceOutstanding(monthly, annual, monthly + annual);
    }

    public async Task<decimal> GetOutstandingAdvanceDaysAsync(long employeeId)
    {
        return (await GetOutstandingAdvanceBreakdownAsync(employeeId)).Total;
    }

    public async Task<decimal> GetOutstandingAdvanceDaysBeforeNextAnnualAsync(long employeeId)
    {
        return (await GetOutstandingAdvanceBreakdownAsync(employeeId)).Annual;
    }

    public async Task<decimal> GetFutureMonthlyGrantDaysAsync(long employeeId, DateOnly asOf)
    {
        var employee = await db.Employees.SingleAsync(x => x.Id == employeeId);
        if (CompletedYears(employee.HireDate, asOf) >= 1) return 0m;

        var days = 0m;
        for (var month = 1; month <= 11; month++)
        {
            var grantDate = employee.HireDate.AddMonths(month);
            if (grantDate > asOf) days += 1m;
        }

        return days;
    }

    public static int CompletedYears(DateOnly hireDate, DateOnly asOf)
    {
        var years = asOf.Year - hireDate.Year;
        if (asOf < hireDate.AddYears(years)) years--;
        return Math.Max(0, years);
    }

    public static int AnnualDays(int completedYears)
    {
        if (completedYears < 1) return 0;
        return Math.Min(15 + Math.Max(0, (completedYears - 1) / 2), 25);
    }

    public static bool IsActiveForLeaveConsumption(LeaveRequestStatus status)
    {
        return status == LeaveRequestStatus.Pending ||
               status == LeaveRequestStatus.Approved ||
               status == LeaveRequestStatus.CancelRequested;
    }
}

public record LeaveGrantBalance(LeaveGrant Grant, decimal Available);
