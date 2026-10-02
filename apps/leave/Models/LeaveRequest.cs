using LeaveManager.Services;
using System.ComponentModel.DataAnnotations;

namespace LeaveManager.Models;

public class LeaveRequest
{
    public long Id { get; set; }
    public long EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public LeaveRequestStatus Status { get; set; } = LeaveRequestStatus.Pending;
    [MaxLength(500)] public string? Reason { get; set; }
    [MaxLength(2000)] public string? WorkPlan { get; set; }
    public decimal CalculatedDays { get; set; }
    public bool IsAdvance { get; set; }
    public decimal AdvanceDays { get; set; }
    public decimal AdvanceRepaymentDays { get; set; }
    public decimal MonthlyAdvanceDays { get; set; }
    public decimal AnnualAdvanceDays { get; set; }
    public decimal MonthlyAdvanceRepaymentDays { get; set; }
    public decimal AnnualAdvanceRepaymentDays { get; set; }
    public DateOnly? BirthdayBenefitDate { get; set; }
    public bool IsBirthdayPolicyOverride { get; set; }
    public DateTime RequestedAtUtc { get; set; } = AppTime.UtcNow;
    public DateTime? DecidedAtUtc { get; set; }
    public long? DecidedByEmployeeId { get; set; }
    [MaxLength(500)] public string? DecisionNote { get; set; }
    public DateTime? CancelRequestedAtUtc { get; set; }
    public DateTime? CancelDecidedAtUtc { get; set; }
    public long? CancelDecidedByEmployeeId { get; set; }
    public List<LeaveRequestDate> Dates { get; set; } = [];
    public List<LeaveAllocation> Allocations { get; set; } = [];
}

public class LeaveRequestDate
{
    public long Id { get; set; }
    public long LeaveRequestId { get; set; }
    public LeaveRequest LeaveRequest { get; set; } = null!;
    public DateOnly Date { get; set; }
    public LeaveDayPortion Portion { get; set; }
    // 기존 무료 생일 연차 이력의 정산을 보존한다. 신규 신청은 이 값을 설정하지 않는다.
    public bool IsBirthdayLeave { get; set; }
    public decimal Days => IsBirthdayLeave ? 0m : Portion switch
    {
        LeaveDayPortion.FullDay => 1m,
        LeaveDayPortion.Morning or LeaveDayPortion.Afternoon => 0.5m,
        LeaveDayPortion.특수휴가 or LeaveDayPortion.기타 or LeaveDayPortion.Birthday => 0m,
        _ => 0m
    };
}

public class LeaveAllocation
{
    public long Id { get; set; }
    public long LeaveRequestId { get; set; }
    public LeaveRequest LeaveRequest { get; set; } = null!;
    public long LeaveGrantId { get; set; }
    public LeaveGrant LeaveGrant { get; set; } = null!;
    public decimal Days { get; set; }
}
