using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class LeaveAccrualWorker(IServiceScopeFactory scopeFactory, ILogger<LeaveAccrualWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunAsync(stoppingToken); }
            catch (Exception ex) { logger.LogError(ex, "연차 자동 발생/소멸 작업 실패"); }
            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }

    private async Task RunAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var calc = scope.ServiceProvider.GetRequiredService<LeaveCalculationService>();
        var audit = scope.ServiceProvider.GetRequiredService<AuditService>();
        var today = AppTime.Today;
        var employees = await db.Employees.Where(x => x.IsActive).ToListAsync(ct);
        foreach (var e in employees)
        {
            await EnsureGrantsAsync(db, e, today, ct);
        }
        await db.SaveChangesAsync(ct);

        var expiredGrants = await db.LeaveGrants
            .Include(x => x.Employee)
            .Where(x => x.ExpiresDate < today && x.Employee.IsActive)
            .ToListAsync(ct);

        foreach (var grant in expiredGrants)
        {
            var balance = (await calc.GetGrantBalancesAsync(grant.EmployeeId, today, includeExpired: true)).SingleOrDefault(x => x.Grant.Id == grant.Id);
            if (balance is null || balance.Available <= 0) continue;

            db.LeaveSettlements.Add(new LeaveSettlement
            {
                EmployeeId = grant.EmployeeId,
                SourceGrantId = grant.Id,
                Type = LeaveSettlementType.Expiration,
                Days = balance.Available,
                ProcessedDate = today,
                ProcessedByEmployeeId = 0,
                Note = "사용기간 만료 자동 소멸"
            });
            await db.SaveChangesAsync(ct);
            await audit.WriteAsync(null, "LeaveExpiredAutomatically", "LeaveGrant", grant.Id, new { grant.EmployeeId, grant.GrantedDate, grant.ExpiresDate, Days = balance.Available });
        }
    }

    private static bool IsActiveAdvanceStatus(LeaveRequestStatus status)
    {
        return status == LeaveRequestStatus.Pending ||
               status == LeaveRequestStatus.Approved ||
               status == LeaveRequestStatus.CancelRequested;
    }

    private static decimal MonthlyAdvanceOutstanding(LeaveRequest request)
    {
        return Math.Max(0m, request.MonthlyAdvanceDays - request.MonthlyAdvanceRepaymentDays);
    }

    private static decimal AnnualAdvanceOutstanding(LeaveRequest request)
    {
        var hasBreakdown = request.MonthlyAdvanceDays > 0m || request.AnnualAdvanceDays > 0m;
        if (!hasBreakdown)
            return Math.Max(0m, request.AdvanceDays - request.AdvanceRepaymentDays);
        return Math.Max(0m, request.AnnualAdvanceDays - request.AnnualAdvanceRepaymentDays);
    }

    private static async Task<decimal> ApplyAdvanceRepaymentsAsync(AppDbContext db, Employee e, LeaveGrant grant, DateOnly processedDate, decimal grantDays, bool monthly, CancellationToken ct)
    {
        var advanceRequests = await db.LeaveRequests
            .Where(x => x.EmployeeId == e.Id && x.IsAdvance && x.Dates.Any(d => d.Date < processedDate))
            .OrderBy(x => x.RequestedAtUtc)
            .ToListAsync(ct);

        var remainingGrantDays = grantDays;
        var deducted = 0m;
        foreach (var request in advanceRequests.Where(x => IsActiveAdvanceStatus(x.Status)))
        {
            if (remainingGrantDays <= 0) break;
            var outstanding = monthly ? MonthlyAdvanceOutstanding(request) : AnnualAdvanceOutstanding(request);
            if (outstanding <= 0) continue;

            var take = Math.Min(outstanding, remainingGrantDays);
            db.LeaveSettlements.Add(new LeaveSettlement
            {
                EmployeeId = e.Id,
                SourceGrantId = grant.Id,
                Type = LeaveSettlementType.AdvanceRepayment,
                Days = take,
                ProcessedDate = processedDate,
                ProcessedByEmployeeId = 0,
                Note = monthly ? $"월차 가불 자동 차감: 신청 #{request.Id}" : $"연차 가불 자동 차감: 신청 #{request.Id}",
                AdvanceLeaveRequestId = request.Id
            });

            if (monthly) request.MonthlyAdvanceRepaymentDays += take;
            else request.AnnualAdvanceRepaymentDays += take;

            request.AdvanceRepaymentDays = Math.Min(request.AdvanceDays, request.MonthlyAdvanceRepaymentDays + request.AnnualAdvanceRepaymentDays);
            remainingGrantDays -= take;
            deducted += take;
        }

        return deducted;
    }

    public static async Task EnsureGrantsAsync(AppDbContext db, Employee e, DateOnly today, CancellationToken ct = default)
    {
        var completedYears = LeaveCalculationService.CompletedYears(e.HireDate, today);
        var (currentPeriodStart, _) = LeaveCalculationService.GetCurrentLeaveYearPeriod(e.HireDate, today);

        for (var month = 1; month <= 11; month++)
        {
            var grantDate = e.HireDate.AddMonths(month);
            if (grantDate > today) break;
            if (await db.LeaveGrants.AnyAsync(x => x.EmployeeId == e.Id && x.GrantType == LeaveGrantType.Monthly && x.GrantedDate == grantDate, ct))
                continue;

            var grant = new LeaveGrant
            {
                EmployeeId = e.Id,
                GrantType = LeaveGrantType.Monthly,
                GrantedDate = grantDate,
                ExpiresDate = grantDate.AddYears(1).AddDays(-1),
                GrantedDays = 1m,
                Note = $"입사 {month}개월 개근 발생"
            };
            db.LeaveGrants.Add(grant);
            await db.SaveChangesAsync(ct);

            if (grantDate < currentPeriodStart)
            {
                var deducted = await ApplyAdvanceRepaymentsAsync(db, e, grant, grantDate, 1m, monthly: true, ct: ct);
                if (deducted > 0)
                    grant.Note = $"입사 {month}개월 개근 발생 · 월차 가불 {deducted:0.#}일 차감";
            }
            await db.SaveChangesAsync(ct);
        }

        for (var year = 1; year <= completedYears; year++)
        {
            var grantDate = e.HireDate.AddYears(year);
            if (grantDate > today) break;
            if (await db.LeaveGrants.AnyAsync(x => x.EmployeeId == e.Id && x.GrantType == LeaveGrantType.Annual && x.GrantedDate == grantDate, ct))
                continue;

            var annualDays = LeaveCalculationService.AnnualDays(year);
            var grant = new LeaveGrant
            {
                EmployeeId = e.Id,
                GrantType = LeaveGrantType.Annual,
                GrantedDate = grantDate,
                ExpiresDate = grantDate.AddYears(1).AddDays(-1),
                GrantedDays = annualDays,
                Note = $"입사 {year}주년 연차"
            };
            db.LeaveGrants.Add(grant);
            await db.SaveChangesAsync(ct);

            var deducted = await ApplyAdvanceRepaymentsAsync(db, e, grant, grantDate, annualDays, monthly: false, ct: ct);
            if (deducted > 0)
                grant.Note = $"입사 {year}주년 연차 · 연차 가불 {deducted:0.#}일 차감";
            await db.SaveChangesAsync(ct);
        }

        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, e, today, ct);
    }
}
