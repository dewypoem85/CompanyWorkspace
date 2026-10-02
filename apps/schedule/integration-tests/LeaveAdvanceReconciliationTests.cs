using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    [Fact]
    public async Task AdvanceReconciliationUsesActualEntitlementForGrantAddsAndRecalls()
    {
        await using var factory = new ContractFactory<Employee>();
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var today = AppTime.Today;
        var employee = new Employee
        {
            Name = "가불 재계산 직원",
            Email = "advance-reconcile@example.test",
            HireDate = today.AddMonths(-11)
        };
        db.Employees.Add(employee);
        await db.SaveChangesAsync();

        for (var month = 1; month <= 11; month++)
        {
            var grantDate = employee.HireDate.AddMonths(month);
            db.LeaveGrants.Add(new LeaveGrant
            {
                EmployeeId = employee.Id,
                GrantType = LeaveGrantType.Monthly,
                GrantedDate = grantDate,
                ExpiresDate = grantDate.AddYears(1).AddDays(-1),
                GrantedDays = 1m
            });
        }
        db.LeaveGrants.Add(new LeaveGrant
        {
            EmployeeId = employee.Id,
            GrantType = LeaveGrantType.Manual,
            GrantedDate = employee.HireDate,
            ExpiresDate = employee.HireDate.AddYears(1).AddDays(-1),
            GrantedDays = .5m
        });
        await db.SaveChangesAsync();

        var requests = new List<LeaveRequest>();
        for (var index = 0; index < 12; index++)
        {
            var request = new LeaveRequest
            {
                EmployeeId = employee.Id,
                Status = LeaveRequestStatus.Approved,
                CalculatedDays = 1m,
                RequestedAtUtc = DateTime.UtcNow.AddMinutes(index)
            };
            request.Dates.Add(new LeaveRequestDate { Date = employee.HireDate.AddDays(index), Portion = LeaveDayPortion.FullDay });
            requests.Add(request);
        }
        db.LeaveRequests.AddRange(requests);
        await db.SaveChangesAsync();

        var firstGrant = await db.LeaveGrants.OrderBy(x => x.Id).FirstAsync(x => x.EmployeeId == employee.Id);
        var lastRequest = requests[^1];
        lastRequest.IsAdvance = true;
        lastRequest.AdvanceDays = 1m;
        lastRequest.AnnualAdvanceDays = 1m;
        lastRequest.Allocations.Add(new LeaveAllocation { LeaveGrantId = firstGrant.Id, Days = 1m });
        db.LeaveSettlements.Add(new LeaveSettlement
        {
            EmployeeId = employee.Id,
            SourceGrantId = firstGrant.Id,
            Type = LeaveSettlementType.AdvanceRepayment,
            Days = 1m,
            ProcessedDate = today,
            ProcessedByEmployeeId = 0,
            AdvanceLeaveRequestId = lastRequest.Id
        });
        await db.SaveChangesAsync();

        var corrected = await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        Assert.Equal(1m, corrected.BeforeOutstanding);
        Assert.Equal(.5m, corrected.AfterOutstanding);
        Assert.Equal(11.5m, await db.LeaveAllocations.Where(x => requests.Select(r => r.Id).Contains(x.LeaveRequestId)).SumAsync(x => x.Days));
        var advance = Assert.Single(await db.LeaveRequests.Where(x => x.EmployeeId == employee.Id && x.IsAdvance).ToListAsync());
        Assert.Equal(.5m, advance.AdvanceDays);
        Assert.Equal(0m, advance.MonthlyAdvanceDays);
        Assert.Equal(.5m, advance.AnnualAdvanceDays);
        Assert.Empty(await db.LeaveSettlements.Where(x => x.AdvanceLeaveRequestId != null).ToListAsync());

        var manualGift = new LeaveGrant
        {
            EmployeeId = employee.Id,
            GrantType = LeaveGrantType.Imported,
            GrantedDate = employee.HireDate,
            ExpiresDate = employee.HireDate.AddYears(1).AddDays(-1),
            GrantedDays = .5m
        };
        db.LeaveGrants.Add(manualGift);
        await db.SaveChangesAsync();
        var gifted = await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        Assert.Equal(0m, gifted.AfterOutstanding);
        Assert.Empty(await db.LeaveRequests.Where(x => x.EmployeeId == employee.Id && x.IsAdvance).ToListAsync());

        manualGift.GrantedDays = -.5m;
        await db.SaveChangesAsync();
        var recalled = await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        Assert.Equal(1m, recalled.AfterOutstanding);
        Assert.Equal(11m, await db.LeaveAllocations.Where(x => requests.Select(r => r.Id).Contains(x.LeaveRequestId)).SumAsync(x => x.Days));
    }

    [Fact]
    public async Task AutomaticMonthlyAndAnnualGrantsRepayTheRightAdvancePeriod()
    {
        await using var factory = new ContractFactory<Employee>();
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var today = AppTime.Today;

        var monthlyEmployee = new Employee
        {
            Name = "월차 갱신 직원",
            Email = "monthly-renewal@example.test",
            HireDate = today.AddMonths(-1)
        };
        db.Employees.Add(monthlyEmployee);
        await db.SaveChangesAsync();
        var monthlyRequest = new LeaveRequest
        {
            EmployeeId = monthlyEmployee.Id,
            Status = LeaveRequestStatus.Approved,
            CalculatedDays = 1m,
            IsAdvance = true,
            AdvanceDays = 1m,
            MonthlyAdvanceDays = 1m,
            Dates = [new LeaveRequestDate { Date = today.AddDays(-1), Portion = LeaveDayPortion.FullDay }]
        };
        db.LeaveRequests.Add(monthlyRequest);
        await db.SaveChangesAsync();

        await LeaveAccrualWorker.EnsureGrantsAsync(db, monthlyEmployee, today);
        await db.Entry(monthlyRequest).ReloadAsync();
        Assert.False(monthlyRequest.IsAdvance);
        Assert.Equal(0m, monthlyRequest.AdvanceDays);
        Assert.Equal(1m, await db.LeaveAllocations.Where(x => x.LeaveRequestId == monthlyRequest.Id).SumAsync(x => x.Days));

        var annualEmployee = new Employee
        {
            Name = "연차 갱신 직원",
            Email = "annual-renewal@example.test",
            HireDate = today.AddYears(-1)
        };
        db.Employees.Add(annualEmployee);
        await db.SaveChangesAsync();
        var annualRequest = new LeaveRequest
        {
            EmployeeId = annualEmployee.Id,
            Status = LeaveRequestStatus.Approved,
            CalculatedDays = 1m,
            IsAdvance = true,
            AdvanceDays = 1m,
            AnnualAdvanceDays = 1m,
            Dates = [new LeaveRequestDate { Date = today.AddDays(-1), Portion = LeaveDayPortion.FullDay }]
        };
        db.LeaveRequests.Add(annualRequest);
        await db.SaveChangesAsync();

        await LeaveAccrualWorker.EnsureGrantsAsync(db, annualEmployee, today);
        await db.Entry(annualRequest).ReloadAsync();
        Assert.Equal(1m, annualRequest.AnnualAdvanceRepaymentDays);
        Assert.Equal(1m, annualRequest.AdvanceRepaymentDays);
        var annualGrant = await db.LeaveGrants.SingleAsync(x => x.EmployeeId == annualEmployee.Id && x.GrantType == LeaveGrantType.Annual);
        var repayment = await db.LeaveSettlements.SingleAsync(x => x.SourceGrantId == annualGrant.Id && x.AdvanceLeaveRequestId == annualRequest.Id);
        Assert.Equal(1m, repayment.Days);
    }
}
