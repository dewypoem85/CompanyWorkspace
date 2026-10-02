using LeaveManager.Models;

namespace LeaveManager.Services;

public record DiscordDmNotificationOption(string Type, string Label, string Description, bool AdminOnly);

public static class DiscordDmNotificationCatalog
{
    public static readonly IReadOnlyList<DiscordDmNotificationOption> All = new List<DiscordDmNotificationOption>
    {
        new("LeaveRequestCreated", "새 연차 신청", "직원이 새 연차/반차/기타를 신청했을 때", true),
        new("LeaveCancelRequested", "연차 취소 승인 요청", "직원이 승인된 연차의 취소 승인을 요청했을 때", true),
        new("LeaveRequestApproved", "내 연차 승인", "내 연차 신청이 승인되었을 때", false),
        new("LeaveRequestRejected", "내 연차 반려", "내 연차 신청이 반려되었을 때", false),
        new("LeaveCancelApproved", "내 취소 요청 승인", "내 연차 취소 요청이 승인되었을 때", false),
        new("LeaveCancelRejected", "내 취소 요청 반려", "내 연차 취소 요청이 반려되었을 때", false),
        new("LeaveRequestForceCreated", "관리자 연차 추가", "관리자가 내 연차 기록을 강제로 추가했을 때", false),
        new("LeaveRequestForceDeleted", "관리자 연차 삭제", "관리자가 내 연차 기록을 강제로 삭제했을 때", false),
    };

    public static IReadOnlyList<DiscordDmNotificationOption> GetAllowed(EmployeeRole role)
    {
        var isAdmin = role is EmployeeRole.Admin or EmployeeRole.Master;
        return All.Where(x => isAdmin || !x.AdminOnly).ToList();
    }

    public static bool IsAllowed(string type, EmployeeRole role)
    {
        return GetAllowed(role).Any(x => string.Equals(x.Type, type, StringComparison.OrdinalIgnoreCase));
    }

    public static IReadOnlySet<string> ParseSelected(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return raw.Split(new[] { ',', ';', '\n', '\r', ' ' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public static string NormalizeSelected(IEnumerable<string> selected, EmployeeRole role)
    {
        var allowed = GetAllowed(role).Select(x => x.Type).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return string.Join(',', selected.Where(x => allowed.Contains(x)).Distinct(StringComparer.OrdinalIgnoreCase));
    }
}
