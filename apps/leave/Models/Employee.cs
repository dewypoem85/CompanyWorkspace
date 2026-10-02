using LeaveManager.Services;
using System.ComponentModel.DataAnnotations;

namespace LeaveManager.Models;

public class Employee
{
    public long Id { get; set; }
    // Company Portal의 안정적인 사용자 키. 기존 연차 FK는 이 값이 아니라 Id를 계속 사용한다.
    public long? CompanyUserId { get; set; }
    // 회사 계정 정보의 로컬 표시용 캐시이며 Leave 관리자 화면에서 직접 수정하지 않는다.
    [Required, EmailAddress, MaxLength(200)] public string Email { get; set; } = "";
    [Required, MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(100)] public string? Department { get; set; }
    // 연차 발생 계산 기준 스냅샷. 기존 프로필은 Portal 로그인만으로 자동 변경하지 않는다.
    public DateOnly HireDate { get; set; }
    // Portal 직원 편집에서 관리하며 연차 달력에만 제한적으로 표시하는 생일 정보.
    public DateOnly? BirthDate { get; set; }
    // Portal의 회사 역할을 Leave 권한으로 투영한 값이다.
    public EmployeeRole Role { get; set; } = EmployeeRole.Employee;
    // 공용 테스트 계정으로 전환된 이력 프로필. 연차 직원 목록과 계산 대상에서 제외한다.
    public bool IsSharedAccount { get; set; }
    public bool IsPrivate { get; set; }
    public bool IsCompanyMaster { get; set; }
    public bool IsActive { get; set; } = true;
    public bool KakaoNotificationsEnabled { get; set; }
    public string? KakaoAccessTokenProtected { get; set; }
    public string? KakaoRefreshTokenProtected { get; set; }
    public DateTime? KakaoAccessTokenExpiresAtUtc { get; set; }
    [MaxLength(50)] public string? DiscordUserId { get; set; }
    [MaxLength(200)] public string? DiscordUsername { get; set; }
    public DateTime? DiscordLinkedAtUtc { get; set; }
    public bool DiscordDmEnabled { get; set; }
    [MaxLength(1000)] public string? DiscordDmNotificationTypes { get; set; }
    public bool CalendarSelfOnly { get; set; }
    public bool CalendarShowApprovedOthers { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
    public bool IsAdmin => Role is EmployeeRole.Admin or EmployeeRole.Master;
    public bool IsMaster => Role == EmployeeRole.Master;
}
