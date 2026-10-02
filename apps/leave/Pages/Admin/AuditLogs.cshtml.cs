using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public class AuditLogsModel(AppDbContext db) : PageModel
{
    public List<AuditLog> Items { get; set; } = [];
    public List<string> ActionOptions { get; set; } = [];
    public List<Employee> ActorOptions { get; set; } = [];
    public string? ActionFilter { get; set; }
    public long? ActorFilter { get; set; }
    public string? TargetFilter { get; set; }
    public int AuditLimit { get; set; } = 10;
    public int AuditPage { get; set; } = 1;
    public int AuditTotalCount { get; set; }
    public int AuditTotalPages => Math.Max(1, (int)Math.Ceiling(AuditTotalCount / (double)AuditLimit));

    public async Task OnGet(string? actionFilter, long? actorFilter, string? targetFilter, int auditLimit = 10, int auditPage = 1)
    {
        ActionFilter = actionFilter;
        ActorFilter = actorFilter;
        TargetFilter = targetFilter;
        AuditLimit = NormalizeAuditLimit(auditLimit);
        AuditPage = Math.Max(1, auditPage);

        ActionOptions = await db.AuditLogs
            .Where(x => x.Action != "")
            .Select(x => x.Action)
            .Distinct()
            .OrderBy(x => x)
            .ToListAsync();

        var actorIds = await db.AuditLogs
            .Where(x => x.ActorEmployeeId != null)
            .Select(x => x.ActorEmployeeId!.Value)
            .Distinct()
            .ToListAsync();
        ActorOptions = await db.Employees
            .Where(x => actorIds.Contains(x.Id))
            .OrderBy(x => x.Name)
            .ToListAsync();

        var q = db.AuditLogs.Include(x => x.ActorEmployee).AsQueryable();
        if (!string.IsNullOrWhiteSpace(actionFilter)) q = q.Where(x => x.Action == actionFilter);
        if (actorFilter.HasValue) q = q.Where(x => x.ActorEmployeeId == actorFilter.Value);
        if (!string.IsNullOrWhiteSpace(targetFilter)) q = q.Where(x => x.TargetType.Contains(targetFilter) || (x.TargetId ?? "").Contains(targetFilter));
        AuditTotalCount = await q.CountAsync();
        var totalPages = Math.Max(1, (int)Math.Ceiling(AuditTotalCount / (double)AuditLimit));
        AuditPage = Math.Clamp(AuditPage, 1, totalPages);
        Items = await q
            .OrderByDescending(x => x.CreatedAtUtc)
            .Skip((AuditPage - 1) * AuditLimit)
            .Take(AuditLimit)
            .ToListAsync();
    }

    public static int NormalizeAuditLimit(int value) => value switch
    {
        10 or 20 or 50 or 100 => value,
        _ => 10
    };

    public string Kst(DateTime utc) => AppTime.ToKst(utc).ToString("yyyy-MM-dd HH:mm:ss");

    public string ActionLabel(string action) => action switch
    {
        "EmployeeAdded" => "직원 계정 추가",
        "EmployeeUpdated" => "직원 정보 수정",
        "EmployeeRetired" => "직원 퇴사 처리",
        "EmployeeActivated" => "직원 재활성화",
        "EmployeeDeleted" => "직원 계정 영구 삭제",
        "LeaveRequestCreated" => "연차 신청",
        "LeaveRequestApproved" => "연차 신청 승인",
        "LeaveRequestRejected" => "연차 신청 반려",
        "LeaveRequestCancelled" => "연차 신청 취소",
        "LeaveCancelRequested" => "승인 연차 취소 요청",
        "LeaveCancelApproved" => "승인 연차 취소 승인",
        "LeaveCancelRejected" => "승인 연차 취소 반려",
        "LeaveCancelWithdrawn" => "승인 연차 취소 요청 철회",
        "LeaveRequestForceCreated" => "연차 신청 강제 추가",
        "LeaveRequestForceDeleted" => "연차 신청 강제 삭제",
        "LeaveSettlementCreated" => "연차 정산 처리",
        "LeaveSettlementExpiration" => "연차 소멸 처리",
        "LeaveSettlementCarryOver" => "연차 이월 처리",
        "LeaveSettlementCompensation" => "연차 보상 처리",
        "LeaveExpired" => "연차 자동 소멸",
        "LeaveAdjustmentApplied" => "연차 개수 보정",
        "LeaveCountAdjusted" => "연차 개수 보정",
        "LeaveGrantAdded" => "연차 발생분 추가",
        "LeaveGrantDeleted" => "연차 발생분 삭제",
        "HistoryImported" => "기존 기록 가져오기",
        "HolidayCreated" => "공휴일 추가",
        "HolidayUpdated" => "공휴일 수정",
        "HolidayDeleted" => "공휴일 삭제",
        "ExternalScheduleCreated" => "외부 일정 기록 추가",
        "ExternalScheduleUpdated" => "외부 일정 기록 수정",
        "ExternalScheduleDeleted" => "외부 일정 기록 삭제",
        "DiscordNotificationTested" => "디스코드 알림 테스트",
        "DiscordWebhookAdded" => "디스코드 웹훅 추가",
        "DiscordWebhookDeleted" => "디스코드 웹훅 삭제",
        _ => action
    };

    public string TargetLabel(AuditLog log)
    {
        var target = log.TargetType switch
        {
            "Employee" => "직원",
            "LeaveRequest" => "연차 신청",
            "LeaveGrant" => "연차 발생분",
            "LeaveSettlement" => "연차 정산",
            "Holiday" => "공휴일",
            "ExternalSchedule" => "외부 일정 기록",
            "Discord" => "디스코드 알림",
            _ => log.TargetType
        };
        return string.IsNullOrWhiteSpace(log.TargetId) ? target : $"{target} #{log.TargetId}";
    }
}
