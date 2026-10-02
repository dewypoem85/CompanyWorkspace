using LeaveManager.Services;
namespace LeaveManager.Models;

public class LeaveGrant
{
    public long Id { get; set; }
    public long EmployeeId { get; set; }
    public Employee Employee { get; set; } = null!;
    public LeaveGrantType GrantType { get; set; }
    // 과거에 자동 지급된 생일 미사용 보상의 귀속 연도. 다른 지급 유형에는 null이다.
    public int? BenefitYear { get; set; }
    public DateOnly GrantedDate { get; set; }
    public DateOnly ExpiresDate { get; set; }
    public decimal GrantedDays { get; set; }
    public long? SourceGrantId { get; set; }
    public string? Note { get; set; }
    public bool IsImported { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
}
