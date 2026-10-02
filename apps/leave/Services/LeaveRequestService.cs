using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public record CreateLeaveRequestInput(DateOnly StartDate, DateOnly EndDate, LeaveDayPortion Portion, string? Reason, string? WorkPlan);
public sealed class LeaveRequestValidationException(string message) : InvalidOperationException(message);

public class LeaveRequestService(AppDbContext db, LeaveCalculationService calc, AuditService audit, DiscordNotificationService discord, NotificationService notifications, SecurityPolicyService security)
{

    private async Task<Employee> GetActorAdminAsync(long actorId)
    {
        var actor = await db.Employees.SingleAsync(x => x.Id == actorId && x.IsActive);
        security.EnsureAdmin(actor);
        return actor;
    }

    private static string StatusActionLabel(bool approve) => approve ? "승인" : "반려";
    private static string PortionLabel(LeaveDayPortion portion) => portion switch
    {
        LeaveDayPortion.FullDay => "연차",
        LeaveDayPortion.Morning => "오전반차",
        LeaveDayPortion.Afternoon => "오후반차",
        LeaveDayPortion.특수휴가 => "특수 휴가",
        LeaveDayPortion.기타 => "기타",
        LeaveDayPortion.Birthday => "생일연차",
        _ => portion.ToString()
    };

    private static string RequestDateLabel(LeaveRequest request)
    {
        var ordered = request.Dates.OrderBy(x => x.Date).ToList();
        if (ordered.Count == 0) return "날짜 미지정";
        var start = ordered.First().Date;
        var end = ordered.Last().Date;
        return start == end ? start.ToString("yyyy-MM-dd") : $"{start:yyyy-MM-dd} ~ {end:yyyy-MM-dd}";
    }

    private async Task ReverseAdvanceRepaymentsAsync(LeaveRequest request)
    {
        if (!request.IsAdvance) return;

        var repayments = await db.LeaveSettlements
            .Where(x => x.AdvanceLeaveRequestId == request.Id && x.Type == LeaveSettlementType.AdvanceRepayment)
            .ToListAsync();
        if (repayments.Count == 0) return;

        var sourceGrantIds = repayments.Select(x => x.SourceGrantId).Distinct().ToList();
        var grantTypes = await db.LeaveGrants
            .Where(x => sourceGrantIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x.GrantType);

        var restoredMonthlyDays = repayments
            .Where(x => grantTypes.TryGetValue(x.SourceGrantId, out var type) && type == LeaveGrantType.Monthly)
            .Sum(x => x.Days);
        var restoredAnnualDays = repayments.Sum(x => x.Days) - restoredMonthlyDays;

        db.LeaveSettlements.RemoveRange(repayments);
        request.MonthlyAdvanceRepaymentDays = Math.Max(0m, request.MonthlyAdvanceRepaymentDays - restoredMonthlyDays);
        request.AnnualAdvanceRepaymentDays = Math.Max(0m, request.AnnualAdvanceRepaymentDays - restoredAnnualDays);
        request.AdvanceRepaymentDays = Math.Max(0m, request.AdvanceRepaymentDays - restoredMonthlyDays - restoredAnnualDays);
    }

    public async Task<LeaveRequest> CreateAsync(long employeeId, CreateLeaveRequestInput input)
    {
        var today = AppTime.Today;
        var startDate = input.StartDate;
        var endDate = input.EndDate < input.StartDate ? input.StartDate : input.EndDate;

        if (input.Portion == LeaveDayPortion.특수휴가)
            throw new LeaveRequestValidationException("특수 휴가는 관리자만 추가할 수 있습니다.");
        if (startDate < today)
            throw new LeaveRequestValidationException("지난 날짜는 신청할 수 없습니다.");
        if (input.Portion is LeaveDayPortion.Morning or LeaveDayPortion.Afternoon && startDate != endDate)
            throw new LeaveRequestValidationException("반차는 한 날짜만 신청할 수 있습니다.");
        if (input.Portion == LeaveDayPortion.Birthday && startDate != endDate)
            throw new LeaveRequestValidationException("생일연차는 하루만 신청할 수 있습니다.");

        var employee = await db.Employees.SingleAsync(x => x.Id == employeeId && x.IsActive);
        BirthdayLeaveWindow? birthdayWindow = null;
        if (input.Portion == LeaveDayPortion.Birthday)
        {
            if (!employee.BirthDate.HasValue)
                throw new LeaveRequestValidationException("생일 월·일이 등록되어 있지 않습니다. 관리자에게 직원 정보 확인을 요청해 주세요.");
            birthdayWindow = BirthdayLeavePolicy.Resolve(employee.BirthDate.Value, startDate);
            if (birthdayWindow is null)
                throw new LeaveRequestValidationException("생일연차는 생일 당일 기준 전후 30일 안의 근무일에만 신청할 수 있습니다.");
            if (employee.HireDate > birthdayWindow.BenefitDate)
                throw new LeaveRequestValidationException("해당 생일 당시 재직자가 아니어서 이번 생일연차를 신청할 수 없습니다.");
        }

        var holidays = await db.Holidays
            .Where(x => x.Date >= startDate && x.Date <= endDate)
            .Select(x => x.Date)
            .ToListAsync();
        var holidaySet = holidays.ToHashSet();

        var dates = Enumerable.Range(0, endDate.DayNumber - startDate.DayNumber + 1)
            .Select(i => startDate.AddDays(i))
            .Where(d => d.DayOfWeek is not DayOfWeek.Saturday and not DayOfWeek.Sunday)
            .Where(d => !holidaySet.Contains(d))
            .ToList();
        if (dates.Count == 0) throw new LeaveRequestValidationException("신청 가능한 근무일이 없습니다.");
        var requestDates = dates.Select(d => new LeaveRequestDate { Date = d, Portion = input.Portion, IsBirthdayLeave = input.Portion == LeaveDayPortion.Birthday }).ToList();

        foreach (var date in dates)
        {
            var existing = await db.LeaveRequestDates.Where(x => x.LeaveRequest.EmployeeId == employeeId && x.Date == date &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending || x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
                .Select(x => x.Portion).ToListAsync();

            var conflict = input.Portion switch
            {
                LeaveDayPortion.FullDay or LeaveDayPortion.기타 or LeaveDayPortion.Birthday => existing.Any(),
                LeaveDayPortion.Morning => existing.Contains(LeaveDayPortion.FullDay) || existing.Contains(LeaveDayPortion.Morning) || existing.Contains(LeaveDayPortion.특수휴가) || existing.Contains(LeaveDayPortion.기타) || existing.Contains(LeaveDayPortion.Birthday),
                LeaveDayPortion.Afternoon => existing.Contains(LeaveDayPortion.FullDay) || existing.Contains(LeaveDayPortion.Afternoon) || existing.Contains(LeaveDayPortion.특수휴가) || existing.Contains(LeaveDayPortion.기타) || existing.Contains(LeaveDayPortion.Birthday),
                _ => true
            };

            if (conflict) throw new LeaveRequestValidationException($"{date:yyyy-MM-dd}에 중복 신청이 있습니다.");
        }

        var workPlan = input.WorkPlan?.Trim();
        if (string.IsNullOrWhiteSpace(workPlan))
            throw new LeaveRequestValidationException("연차 신청 시 해당일의 업무 일정과 인수인계/분담 내용을 입력해야 합니다.");
        if (workPlan.Length > 2000)
            throw new LeaveRequestValidationException("업무 일정 기록은 2000자 이하로 입력하세요.");

        if (input.Portion is not (LeaveDayPortion.FullDay or LeaveDayPortion.Morning or LeaveDayPortion.Afternoon or LeaveDayPortion.기타 or LeaveDayPortion.Birthday))
            throw new LeaveRequestValidationException("지원하지 않는 휴가 유형입니다.");

        if (birthdayWindow is not null)
        {
            await using var birthdayTx = await db.Database.BeginTransactionAsync();
            if (await BirthdayLeavePolicy.HasActiveClaimAsync(db, employeeId, birthdayWindow.BenefitDate))
                throw new LeaveRequestValidationException("해당 생일의 생일연차는 이미 신청했습니다. 반려되거나 취소가 완료된 뒤 다시 신청할 수 있습니다.");
            var birthdayRequest = new LeaveRequest
            {
                EmployeeId = employeeId,
                Reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim(),
                WorkPlan = workPlan,
                CalculatedDays = 0m,
                BirthdayBenefitDate = birthdayWindow.BenefitDate,
                Dates = requestDates
            };
            db.LeaveRequests.Add(birthdayRequest);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (
                ex.InnerException?.Message.Contains("LeaveRequests.EmployeeId", StringComparison.Ordinal) == true &&
                ex.InnerException.Message.Contains("LeaveRequests.BirthdayBenefitDate", StringComparison.Ordinal))
            {
                throw new LeaveRequestValidationException("해당 생일의 생일연차는 이미 신청했습니다. 반려되거나 취소가 완료된 뒤 다시 신청할 수 있습니다.");
            }
            await birthdayTx.CommitAsync();
            await audit.WriteAsync(employeeId, "BirthdayLeaveRequestCreated", "LeaveRequest", birthdayRequest.Id, new { birthdayRequest.BirthdayBenefitDate, birthdayRequest.CalculatedDays, Dates = birthdayRequest.Dates.Select(x => new { x.Date, x.Portion, x.IsBirthdayLeave }), birthdayRequest.Reason, birthdayRequest.WorkPlan });
            birthdayRequest.Employee = employee;
            var birthdayNotification = NotificationMessageFactory.LeaveRequestCreated(birthdayRequest);
            if (!employee.IsPrivate && !employee.IsCompanyMaster) await discord.NotifyAsync(NotificationMessageFactory.LeaveRequestCreatedPublic(birthdayRequest));
            await notifications.NotifyAdminsAsync(birthdayNotification);
            return birthdayRequest;
        }
        var required = requestDates.Sum(x => x.Days);
        var completedYears = LeaveCalculationService.CompletedYears(employee.HireDate, today);
        var nextAnnualDays = LeaveCalculationService.AnnualDays(completedYears + 1);
        await using var tx = await db.Database.BeginTransactionAsync();
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        var balance = await calc.GetCurrentLeaveYearBalanceAsync(employeeId, today);
        var shortage = Math.Max(0m, required - balance.Available);
        var isAdvance = shortage > 0;
        var monthlyAdvanceDays = 0m;
        var annualAdvanceDays = 0m;

        if (isAdvance)
        {
            var outstandingAdvance = await calc.GetOutstandingAdvanceBreakdownAsync(employeeId);
            var futureMonthlyDays = completedYears < 1
                ? await calc.GetFutureMonthlyGrantDaysAsync(employeeId, today)
                : 0m;

            var monthlyCapacityLeft = Math.Max(0m, futureMonthlyDays - outstandingAdvance.Monthly);
            var annualCapacityLeft = Math.Max(0m, nextAnnualDays - outstandingAdvance.Annual);

            monthlyAdvanceDays = Math.Min(shortage, monthlyCapacityLeft);
            annualAdvanceDays = shortage - monthlyAdvanceDays;

            if (annualAdvanceDays > annualCapacityLeft)
            {
                throw new LeaveRequestValidationException($"가불 가능한 한도를 초과합니다. 앞으로 발생할 월차 잔여 {monthlyCapacityLeft:0.#}일, 다음 연차 잔여 {annualCapacityLeft:0.#}일, 이번 부족분 {shortage:0.#}일입니다.");
            }
        }

        var request = new LeaveRequest
        {
            EmployeeId = employeeId,
            Reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim(),
            WorkPlan = workPlan,
            CalculatedDays = required,
            IsAdvance = isAdvance,
            AdvanceDays = shortage,
            AdvanceRepaymentDays = 0m,
            MonthlyAdvanceDays = monthlyAdvanceDays,
            AnnualAdvanceDays = annualAdvanceDays,
            MonthlyAdvanceRepaymentDays = 0m,
            AnnualAdvanceRepaymentDays = 0m
        };
        request.Dates = requestDates;

        db.LeaveRequests.Add(request);
        await db.SaveChangesAsync();
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        await tx.CommitAsync();
        await audit.WriteAsync(employeeId, "LeaveRequestCreated", "LeaveRequest", request.Id, new { request.CalculatedDays, request.IsAdvance, request.AdvanceDays, request.MonthlyAdvanceDays, request.AnnualAdvanceDays, Dates = request.Dates.Select(x => new { x.Date, x.Portion, x.IsBirthdayLeave }), request.Reason, request.WorkPlan });
        await db.Entry(request).Reference(x => x.Employee).LoadAsync();
        var createdNotification = NotificationMessageFactory.LeaveRequestCreated(request);
        // A channel webhook has no employee-level access control.
        if (!request.Employee.IsPrivate && !request.Employee.IsCompanyMaster) await discord.NotifyAsync(NotificationMessageFactory.LeaveRequestCreatedPublic(request));
        await notifications.NotifyAdminsAsync(createdNotification);
        return request;
    }


    public async Task<LeaveRequest> ForceCreateForDateAsync(long targetEmployeeId, long adminId, DateOnly date, LeaveDayPortion portion, string? reason)
    {
        var actor = await GetActorAdminAsync(adminId);
        var requiredReason = security.RequireReason(reason, "강제 추가 사유");
        var employee = await db.Employees.SingleOrDefaultAsync(x => x.Id == targetEmployeeId && x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster)
            ?? throw new LeaveRequestValidationException("연차를 추가할 실제 재직 직원을 찾을 수 없습니다.");

        var existing = await db.LeaveRequestDates
            .Where(x => x.LeaveRequest.EmployeeId == targetEmployeeId && x.Date == date &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
                 x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                 x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
            .Select(x => x.Portion)
            .ToListAsync();

        var conflict = portion switch
        {
            LeaveDayPortion.FullDay or LeaveDayPortion.특수휴가 or LeaveDayPortion.기타 or LeaveDayPortion.Birthday => existing.Any(),
            LeaveDayPortion.Morning => existing.Contains(LeaveDayPortion.FullDay) || existing.Contains(LeaveDayPortion.Morning) || existing.Contains(LeaveDayPortion.특수휴가) || existing.Contains(LeaveDayPortion.기타) || existing.Contains(LeaveDayPortion.Birthday),
            LeaveDayPortion.Afternoon => existing.Contains(LeaveDayPortion.FullDay) || existing.Contains(LeaveDayPortion.Afternoon) || existing.Contains(LeaveDayPortion.특수휴가) || existing.Contains(LeaveDayPortion.기타) || existing.Contains(LeaveDayPortion.Birthday),
            _ => true
        };
        if (conflict) throw new LeaveRequestValidationException($"{date:yyyy-MM-dd}에 중복 신청이 있습니다.");

        var days = portion switch
        {
            LeaveDayPortion.FullDay => 1m,
            LeaveDayPortion.Morning or LeaveDayPortion.Afternoon => 0.5m,
            LeaveDayPortion.특수휴가 or LeaveDayPortion.기타 or LeaveDayPortion.Birthday => 0m,
            _ => throw new LeaveRequestValidationException("지원하지 않는 휴가 유형입니다.")
        };
        BirthdayLeaveWindow? birthdayWindow = null;
        var birthdayOverride = false;
        if (portion == LeaveDayPortion.Birthday)
        {
            if (!employee.BirthDate.HasValue)
                throw new LeaveRequestValidationException("생일 월·일이 등록되지 않은 직원에게는 생일연차를 추가할 수 없습니다.");
            birthdayWindow = BirthdayLeavePolicy.Resolve(employee.BirthDate.Value, date) ?? BirthdayLeavePolicy.ResolveNearest(employee.BirthDate.Value, date);
            birthdayOverride = !birthdayWindow.Contains(date) || employee.HireDate > birthdayWindow.BenefitDate || await BirthdayLeavePolicy.HasActiveClaimAsync(db, targetEmployeeId, birthdayWindow.BenefitDate);
        }
        var request = new LeaveRequest
        {
            EmployeeId = targetEmployeeId,
            Status = LeaveRequestStatus.Approved,
            Reason = requiredReason,
            CalculatedDays = days,
            DecidedAtUtc = AppTime.UtcNow,
            DecidedByEmployeeId = adminId,
            BirthdayBenefitDate = birthdayWindow?.BenefitDate,
            IsBirthdayPolicyOverride = birthdayOverride
        };
        request.Dates.Add(new LeaveRequestDate { Date = date, Portion = portion, IsBirthdayLeave = portion == LeaveDayPortion.Birthday });

        await using var tx = await db.Database.BeginTransactionAsync();
        db.LeaveRequests.Add(request);
        await db.SaveChangesAsync();
        if (portion != LeaveDayPortion.Birthday)
            await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        await tx.CommitAsync();
        await audit.WriteAsync(adminId, "LeaveRequestForceCreated", "LeaveRequest", request.Id, new
        {
            Employee = employee.Name,
            employee.Email,
            Date = date,
            Portion = portion,
            Days = days,
            IsBirthdayLeave = portion == LeaveDayPortion.Birthday,
            request.BirthdayBenefitDate,
            request.IsBirthdayPolicyOverride,
            Reason = request.Reason
        }, reason: requiredReason);
        await notifications.NotifyAsync(targetEmployeeId, NotificationMessageFactory.LeaveRequestForceCreated(date, portion));
        return request;
    }

    public async Task DecideAsync(long requestId, long adminId, bool approve, string? note)
    {
        var actor = await GetActorAdminAsync(adminId);
        var request = await db.LeaveRequests.Include(x => x.Dates).SingleAsync(x => x.Id == requestId);
        if (request.EmployeeId == actor.Id)
            throw new InvalidOperationException("자기 자신의 연차 신청은 승인/반려할 수 없습니다. 다른 관리자 또는 마스터에게 처리를 요청하세요.");
        if (request.Status != LeaveRequestStatus.Pending) throw new InvalidOperationException("대기 중인 신청만 처리할 수 있습니다.");
        request.Status = approve ? LeaveRequestStatus.Approved : LeaveRequestStatus.Rejected;
        if (!approve) await ReverseAdvanceRepaymentsAsync(request);
        request.DecidedAtUtc = AppTime.UtcNow;
        request.DecidedByEmployeeId = adminId;
        request.DecisionNote = note;
        await db.SaveChangesAsync();
        if (!approve)
        {
            var employee = await db.Employees.SingleAsync(x => x.Id == request.EmployeeId);
            await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        }
        await audit.WriteAsync(adminId, approve ? "LeaveRequestApproved" : "LeaveRequestRejected", "LeaveRequest", requestId, new { note });
        await notifications.NotifyAsync(request.EmployeeId, NotificationMessageFactory.LeaveRequestDecision(request, approve));
    }

    public async Task RequestCancelAsync(long requestId, long employeeId)
    {
        var request = await db.LeaveRequests
            .Include(x => x.Dates)
            .SingleAsync(x => x.Id == requestId && x.EmployeeId == employeeId);

        if (request.Status == LeaveRequestStatus.Pending)
        {
            request.Status = LeaveRequestStatus.Cancelled;
            await ReverseAdvanceRepaymentsAsync(request);
        }
        else if (request.Status == LeaveRequestStatus.Approved)
        {
            var today = AppTime.Today;
            if (request.Dates.Any(x => x.Date < today))
                throw new InvalidOperationException("이미 사용일이 지난 연차는 취소 신청할 수 없습니다. 관리자에게 문의하세요.");

            request.Status = LeaveRequestStatus.CancelRequested;
            request.CancelRequestedAtUtc = AppTime.UtcNow;
        }
        else throw new InvalidOperationException("취소할 수 없는 상태입니다.");
        await db.SaveChangesAsync();
        if (request.Status == LeaveRequestStatus.Cancelled)
        {
            var employee = await db.Employees.SingleAsync(x => x.Id == request.EmployeeId);
            await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        }
        await audit.WriteAsync(employeeId, request.Status == LeaveRequestStatus.CancelRequested ? "LeaveCancelRequested" : "LeaveRequestCancelled", "LeaveRequest", requestId);
        if (request.Status == LeaveRequestStatus.CancelRequested)
        {
            await db.Entry(request).Reference(x => x.Employee).LoadAsync();
            await notifications.NotifyAdminsAsync(NotificationMessageFactory.LeaveCancelRequested(request));
        }
    }

    public async Task WithdrawCancelRequestAsync(long requestId, long employeeId)
    {
        var request = await db.LeaveRequests
            .SingleAsync(x => x.Id == requestId && x.EmployeeId == employeeId);

        if (request.Status != LeaveRequestStatus.CancelRequested)
            throw new InvalidOperationException("취소 승인 대기 상태인 신청만 취소 요청을 철회할 수 있습니다.");

        request.Status = LeaveRequestStatus.Approved;
        request.CancelRequestedAtUtc = null;
        request.CancelDecidedAtUtc = null;
        request.CancelDecidedByEmployeeId = null;
        await db.SaveChangesAsync();
        await audit.WriteAsync(employeeId, "LeaveCancelWithdrawn", "LeaveRequest", requestId);
    }



    public async Task ForceDeleteAsync(long requestId, long adminId, string? reason)
    {
        var actor = await db.Employees.SingleAsync(x => x.Id == adminId && x.IsActive);
        security.EnsureCanForceDelete(actor);
        var requiredReason = security.RequireReason(reason, "강제 삭제 사유");
        var request = await db.LeaveRequests
            .Include(x => x.Employee)
            .Include(x => x.Dates)
            .Include(x => x.Allocations)
            .SingleAsync(x => x.Id == requestId);

        var before = new
        {
            request.Id,
            Employee = request.Employee.Name,
            request.Employee.Email,
            request.Status,
            request.CalculatedDays,
            request.IsAdvance,
            request.AdvanceDays,
            request.AdvanceRepaymentDays,
            request.MonthlyAdvanceDays,
            request.AnnualAdvanceDays,
            request.MonthlyAdvanceRepaymentDays,
            request.AnnualAdvanceRepaymentDays,
            Dates = request.Dates.OrderBy(x => x.Date).Select(x => new { x.Date, x.Portion }).ToList(),
            request.Reason,
            request.WorkPlan
        };

        var targetEmployeeId = request.EmployeeId;
        await ReverseAdvanceRepaymentsAsync(request);
        db.LeaveRequests.Remove(request);
        await db.SaveChangesAsync();
        var employee = await db.Employees.SingleAsync(x => x.Id == targetEmployeeId);
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        await audit.WriteAsync(adminId, "LeaveRequestForceDeleted", "LeaveRequest", requestId, before, before: before, reason: requiredReason);
        await notifications.NotifyAsync(targetEmployeeId, NotificationMessageFactory.LeaveRequestForceDeleted(request));
    }

    public async Task DecideCancelAsync(long requestId, long adminId, bool approve)
    {
        var actor = await GetActorAdminAsync(adminId);
        var request = await db.LeaveRequests.Include(x => x.Dates).SingleAsync(x => x.Id == requestId);
        if (request.EmployeeId == actor.Id)
            throw new InvalidOperationException("자기 자신의 연차 취소 요청은 승인/반려할 수 없습니다. 다른 관리자 또는 마스터에게 처리를 요청하세요.");
        if (request.Status != LeaveRequestStatus.CancelRequested) throw new InvalidOperationException("취소 승인 대기 상태가 아닙니다.");
        request.Status = approve ? LeaveRequestStatus.Cancelled : LeaveRequestStatus.Approved;
        if (approve) await ReverseAdvanceRepaymentsAsync(request);
        request.CancelDecidedAtUtc = AppTime.UtcNow;
        request.CancelDecidedByEmployeeId = adminId;
        await db.SaveChangesAsync();
        if (approve)
        {
            var employee = await db.Employees.SingleAsync(x => x.Id == request.EmployeeId);
            await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        }
        await audit.WriteAsync(adminId, approve ? "LeaveCancelApproved" : "LeaveCancelRejected", "LeaveRequest", requestId);
        await notifications.NotifyAsync(request.EmployeeId, NotificationMessageFactory.LeaveCancelDecision(request, approve));
    }
}
