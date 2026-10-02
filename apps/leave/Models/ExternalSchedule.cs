using LeaveManager.Services;
using System.ComponentModel.DataAnnotations;

namespace LeaveManager.Models;

/// <summary>
/// 연차를 차감하지 않는 관리자 전용 외근/외부 일정 기록.
/// 일반 직원 화면과 연차 계산에는 노출하거나 포함하지 않는다.
/// </summary>
public class ExternalSchedule
{
    public long Id { get; set; }
    public long EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    [Required, MaxLength(50)] public string Category { get; set; } = "외근";
    [Required, MaxLength(500)] public string Memo { get; set; } = "";
    public long? CreatedByEmployeeId { get; set; }
    public long? UpdatedByEmployeeId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = AppTime.UtcNow;
}
