using LeaveManager.Models;

namespace LeaveManager.Services;

public class SecurityPolicyService(IConfiguration configuration)
{
    public bool ForceDeleteRequiresMaster =>
        !bool.TryParse(configuration["Security:ForceDeleteRequiresMaster"], out var value) || value;

    public bool RequireReasonsForSensitiveAdminActions =>
        !bool.TryParse(configuration["Security:RequireReasonsForSensitiveAdminActions"], out var value) || value;

    public void EnsureAdmin(Employee actor)
    {
        if (!actor.IsAdmin) throw new UnauthorizedAccessException("관리자 권한이 필요합니다.");
    }

    public void EnsureMaster(Employee actor)
    {
        if (!actor.IsMaster) throw new UnauthorizedAccessException("마스터 권한이 필요합니다.");
    }

    public void EnsureCanForceDelete(Employee actor)
    {
        EnsureAdmin(actor);
        if (ForceDeleteRequiresMaster && !actor.IsMaster)
            throw new UnauthorizedAccessException("강제 삭제는 마스터만 수행할 수 있습니다.");
    }

    public string RequireReason(string? reason, string label = "사유")
    {
        if (!RequireReasonsForSensitiveAdminActions)
            return string.IsNullOrWhiteSpace(reason) ? "사유 미입력" : reason.Trim();
        if (string.IsNullOrWhiteSpace(reason))
            throw new InvalidOperationException($"{label}를 입력해야 합니다.");
        return reason.Trim();
    }
}
