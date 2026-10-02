using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public record LeaveAdvanceReconciliationResult(decimal BeforeOutstanding, decimal AfterOutstanding, int RequestCount);

/// <summary>
/// 현재 연차년도의 지급분, 사용분, 배정, 가불을 하나의 장부로 다시 맞춘다.
/// 관리자 강제 추가처럼 과거에 배정이 생략된 사용 기록과 수동 증감도 같은 기준으로 처리한다.
/// </summary>
public static class LeaveAdvanceReconciliationService
{
    public static async Task<LeaveAdvanceReconciliationResult> ReconcileCurrentPeriodAsync(
        AppDbContext db,
        Employee employee,
        DateOnly asOf,
        CancellationToken ct = default)
    {
        var (periodStart, periodEnd) = LeaveCalculationService.GetCurrentLeaveYearPeriod(employee.HireDate, asOf);
        var requests = await db.LeaveRequests
            .Include(x => x.Dates)
            .Include(x => x.Allocations)
            .Where(x => x.EmployeeId == employee.Id &&
                        (x.Status == LeaveRequestStatus.Pending ||
                         x.Status == LeaveRequestStatus.Approved ||
                         x.Status == LeaveRequestStatus.CancelRequested) &&
                        x.Dates.Any(d => d.Date >= periodStart && d.Date <= periodEnd))
            .OrderBy(x => x.RequestedAtUtc)
            .ThenBy(x => x.Id)
            .ToListAsync(ct);

        var requestIds = requests.Select(x => x.Id).ToArray();
        var beforeOutstanding = requests.Sum(OutstandingDays);

        // 같은 연차년도에 발생한 월차로 갚은 가불은 사용 기록을 새 발생분에 직접 재배정한다.
        // 정산과 배정을 동시에 남기면 같은 사용량이 두 번 차감될 수 있다.
        if (requestIds.Length > 0)
        {
            var currentPeriodRepayments = await db.LeaveSettlements
                .Where(x => x.Type == LeaveSettlementType.AdvanceRepayment &&
                            x.AdvanceLeaveRequestId != null &&
                            requestIds.Contains(x.AdvanceLeaveRequestId.Value))
                .ToListAsync(ct);
            if (currentPeriodRepayments.Count > 0)
                db.LeaveSettlements.RemoveRange(currentPeriodRepayments);
        }

        var allocations = requests.SelectMany(x => x.Allocations).ToList();
        if (allocations.Count > 0)
            db.LeaveAllocations.RemoveRange(allocations);

        foreach (var request in requests)
        {
            request.IsAdvance = false;
            request.AdvanceDays = 0m;
            request.AdvanceRepaymentDays = 0m;
            request.MonthlyAdvanceDays = 0m;
            request.AnnualAdvanceDays = 0m;
            request.MonthlyAdvanceRepaymentDays = 0m;
            request.AnnualAdvanceRepaymentDays = 0m;
        }

        await db.SaveChangesAsync(ct);

        var grants = await db.LeaveGrants
            .Where(x => x.EmployeeId == employee.Id &&
                        x.GrantedDate >= periodStart && x.GrantedDate <= periodEnd &&
                        x.GrantedDate <= asOf && x.ExpiresDate >= asOf)
            .OrderBy(x => x.ExpiresDate)
            .ThenBy(x => x.GrantedDate)
            .ThenBy(x => x.Id)
            .ToListAsync(ct);
        var grantIds = grants.Select(x => x.Id).ToArray();
        var settlements = grantIds.Length == 0
            ? []
            : await db.LeaveSettlements
                .Where(x => grantIds.Contains(x.SourceGrantId))
                .ToListAsync(ct);

        var capacityByGrant = grants.ToDictionary(
            x => x.Id,
            x => Math.Max(0m, x.GrantedDays - settlements.Where(s => s.SourceGrantId == x.Id).Sum(s => s.Days)));
        var totalBudget = Math.Max(0m, grants.Sum(x => x.GrantedDays) - settlements.Sum(x => x.Days));
        var remainingBudget = totalBudget;
        var shortages = new List<(LeaveRequest Request, decimal Days)>();

        foreach (var request in requests)
        {
            var required = request.Dates
                .Where(x => x.Date >= periodStart && x.Date <= periodEnd)
                .Sum(x => x.Days);
            if (required <= 0m) continue;

            var covered = Math.Min(required, remainingBudget);
            var remainingToAllocate = covered;
            foreach (var grant in grants)
            {
                if (remainingToAllocate <= 0m) break;
                var available = capacityByGrant[grant.Id];
                if (available <= 0m) continue;

                var take = Math.Min(available, remainingToAllocate);
                request.Allocations.Add(new LeaveAllocation { LeaveGrantId = grant.Id, Days = take });
                capacityByGrant[grant.Id] -= take;
                remainingToAllocate -= take;
            }

            var allocated = covered - remainingToAllocate;
            remainingBudget -= allocated;
            var shortage = required - allocated;
            if (shortage > 0m) shortages.Add((request, shortage));
        }

        var futureMonthlyDays = LeaveCalculationService.CompletedYears(employee.HireDate, asOf) < 1
            ? FutureMonthlyGrantDays(employee.HireDate, asOf)
            : 0m;
        var monthlyRemaining = futureMonthlyDays;

        foreach (var (request, shortage) in shortages)
        {
            var monthly = Math.Min(shortage, monthlyRemaining);
            var annual = shortage - monthly;
            monthlyRemaining -= monthly;

            request.IsAdvance = true;
            request.AdvanceDays = shortage;
            request.MonthlyAdvanceDays = monthly;
            request.AnnualAdvanceDays = annual;
        }

        await db.SaveChangesAsync(ct);
        return new LeaveAdvanceReconciliationResult(beforeOutstanding, shortages.Sum(x => x.Days), requests.Count);
    }

    private static decimal OutstandingDays(LeaveRequest request)
    {
        var hasBreakdown = request.MonthlyAdvanceDays > 0m || request.AnnualAdvanceDays > 0m;
        if (!hasBreakdown) return Math.Max(0m, request.AdvanceDays - request.AdvanceRepaymentDays);
        return Math.Max(0m, request.MonthlyAdvanceDays - request.MonthlyAdvanceRepaymentDays) +
               Math.Max(0m, request.AnnualAdvanceDays - request.AnnualAdvanceRepaymentDays);
    }

    private static decimal FutureMonthlyGrantDays(DateOnly hireDate, DateOnly asOf)
    {
        var days = 0m;
        for (var month = 1; month <= 11; month++)
            if (hireDate.AddMonths(month) > asOf) days += 1m;
        return days;
    }
}
