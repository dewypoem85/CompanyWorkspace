using System.ComponentModel.DataAnnotations;

namespace CompanyPortal.Models;

public class CompanyUser
{
    public long Id { get; set; }
    [Required, EmailAddress, MaxLength(200)] public string Email { get; set; } = "";
    [Required, MaxLength(100)] public string Name { get; set; } = "";
    [MaxLength(100)] public string? Department { get; set; }
    public long? DepartmentId { get; set; }
    public DateOnly HireDate { get; set; }
    // 인사/연차 계산 전용 정보. 일반 직원 목록과 서비스 디렉터리에는 노출하지 않는다.
    public DateOnly? BirthDate { get; set; }
    public bool IsActive { get; set; } = true;
    // 실제 재직자가 아닌 QA/운영용 공용 로그인 계정. Leave 직원 투영 대상에서 제외한다.
    public bool IsSharedAccount { get; set; }
    public bool IsPrivate { get; set; }
    public bool IsAdmin { get; set; }
    public bool IsMaster { get; set; }
    [MaxLength(1000)] public string Permissions { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
