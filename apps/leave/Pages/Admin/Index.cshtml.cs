using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace LeaveManager.Pages.Admin;

public class IndexModel(AppDbContext db, CurrentEmployeeService current, LeaveRequestService service, LeaveCalculationService calc, SecurityPolicyService security, ILogger<IndexModel> logger) : PageModel
{
    const string FormMedia = "application/vnd.company.workspace-form+json";
    public string? ErrorMessage { get; private set; }
    public string? SubmittedReason { get; private set; }
    public bool WriteLocked { get; private set; }
    public static string Snapshot(LeaveRequest request) => LeaveRequestSnapshot.Compute(request);
    private static readonly string[] QueueAuditActions =
    [
        "LeaveRequestCreated",
        "LeaveRequestApproved",
        "LeaveRequestRejected",
        "LeaveRequestCancelled",
        "LeaveCancelRequested",
        "LeaveCancelWithdrawn",
        "LeaveCancelApproved",
        "LeaveCancelRejected",
        "LeaveRequestForceDeleted"
    ];

    [BindProperty(SupportsGet = true)] public int RecentLimit { get; set; } = 10;
    [BindProperty(SupportsGet = true)] public int RecentPage { get; set; } = 1;
    public List<RequestRow> Pending { get; set; } = [];
    public List<RequestRow> CancelPending { get; set; } = [];
    public List<RequestRow> RecentRequests { get; set; } = [];
    public int RecentTotalCount { get; set; }
    public int RecentTotalPages => Math.Max(1, (int)Math.Ceiling(RecentTotalCount / (double)RecentLimit));
    public DateOnly Today { get; set; } = AppTime.Today;
    public bool CanForceDelete { get; set; }
    public Employee CurrentEmployee { get; set; } = null!;
    public long QueueVersion { get; set; }

    public async Task OnGet()
    {
        Response.Headers.CacheControl = "no-store";
        CurrentEmployee = await current.GetRequiredAsync();
        var actor = CurrentEmployee;
        CanForceDelete = actor.IsMaster || !security.ForceDeleteRequiresMaster;
        await LoadApprovalQueuesAsync();
        RecentLimit = NormalizeRecentLimit(RecentLimit);
        RecentPage = Math.Max(1, RecentPage);
        RecentRequests = await LoadRecentRows();
    }

    public async Task<IActionResult> OnGetQueueSummary()
    {
        Response.Headers.CacheControl = "no-store";
        await current.GetRequiredAsync();
        var counts = await db.LeaveRequests
            .Where(x => !x.Employee.IsCompanyMaster && (x.Status == LeaveRequestStatus.Pending || x.Status == LeaveRequestStatus.CancelRequested))
            .GroupBy(x => x.Status)
            .Select(x => new { Status = x.Key, Count = x.Count() })
            .ToDictionaryAsync(x => x.Status, x => x.Count);

        return new JsonResult(new
        {
            pendingCount = counts.GetValueOrDefault(LeaveRequestStatus.Pending),
            cancelPendingCount = counts.GetValueOrDefault(LeaveRequestStatus.CancelRequested),
            version = (await LoadQueueVersionAsync()).ToString(CultureInfo.InvariantCulture)
        });
    }

    public async Task<PartialViewResult> OnGetQueue()
    {
        Response.Headers.CacheControl = "no-store";
        CurrentEmployee = await current.GetRequiredAsync();
        CanForceDelete = CurrentEmployee.IsMaster || !security.ForceDeleteRequiresMaster;
        await LoadApprovalQueuesAsync();
        return Partial("_ApprovalQueues", this);
    }


    public static int NormalizeRecentLimit(int value) => value switch
    {
        10 or 20 or 50 or 100 => value,
        _ => 10
    };

    private async Task<List<RequestRow>> LoadRows(LeaveRequestStatus status)
    {
        var requests = await db.LeaveRequests.Include(x => x.Employee).Include(x => x.Dates)
            .Where(x => !x.Employee.IsCompanyMaster && x.Status == status)
            .OrderBy(x => status == LeaveRequestStatus.Pending ? x.RequestedAtUtc : x.CancelRequestedAtUtc)
            .ToListAsync();
        return await BuildRowsAsync(requests);
    }

    private async Task LoadApprovalQueuesAsync()
    {
        Pending = await LoadRows(LeaveRequestStatus.Pending);
        CancelPending = await LoadRows(LeaveRequestStatus.CancelRequested);
        QueueVersion = await LoadQueueVersionAsync();
    }

    private async Task<long> LoadQueueVersionAsync()
        => await db.AuditLogs
            .Where(x => QueueAuditActions.Contains(x.Action))
            .Select(x => (long?)x.Id)
            .MaxAsync() ?? 0;


    private async Task<List<RequestRow>> LoadRecentRows()
    {
        RecentTotalCount = await db.LeaveRequests.CountAsync(x => !x.Employee.IsCompanyMaster);
        var totalPages = Math.Max(1, (int)Math.Ceiling(RecentTotalCount / (double)RecentLimit));
        RecentPage = Math.Clamp(RecentPage, 1, totalPages);

        var requests = await db.LeaveRequests.Include(x => x.Employee).Include(x => x.Dates)
            .Where(x => !x.Employee.IsCompanyMaster)
            .OrderByDescending(x => x.RequestedAtUtc)
            .Skip((RecentPage - 1) * RecentLimit)
            .Take(RecentLimit)
            .ToListAsync();
        return await BuildRowsAsync(requests);
    }

    private async Task<List<RequestRow>> BuildRowsAsync(List<LeaveRequest> requests)
    {
        var actorIds = requests
            .SelectMany(x => new long?[] { x.DecidedByEmployeeId, x.CancelDecidedByEmployeeId })
            .Where(x => x.HasValue)
            .Select(x => x!.Value)
            .Distinct()
            .ToList();

        var actorNames = actorIds.Count == 0
            ? new Dictionary<long, string>()
            : await db.Employees
                .Where(x => actorIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, x => x.Name);

        var rows = new List<RequestRow>();
        foreach (var r in requests)
        {
            var balance = await calc.GetBalanceAsync(r.EmployeeId, Today);
            rows.Add(new RequestRow(r, balance, GetDecisionActorLabel(r, actorNames)));
        }
        return rows;
    }

    private static string GetDecisionActorLabel(LeaveRequest request, IReadOnlyDictionary<long, string> actorNames)
    {
        static string NameOrDash(long? id, IReadOnlyDictionary<long, string> names)
        {
            if (!id.HasValue) return "-";
            return names.TryGetValue(id.Value, out var name) ? name : $"직원 #{id.Value}";
        }

        return request.Status switch
        {
            LeaveRequestStatus.Pending => "-",
            LeaveRequestStatus.Approved => $"승인: {NameOrDash(request.DecidedByEmployeeId, actorNames)}",
            LeaveRequestStatus.Rejected => $"반려: {NameOrDash(request.DecidedByEmployeeId, actorNames)}",
            LeaveRequestStatus.CancelRequested => $"승인: {NameOrDash(request.DecidedByEmployeeId, actorNames)}",
            LeaveRequestStatus.Cancelled => $"취소 처리: {NameOrDash(request.CancelDecidedByEmployeeId ?? request.DecidedByEmployeeId, actorNames)}",
            _ => "-"
        };
    }


    public string AdvanceKindLabel(LeaveRequest r)
    {
        if (!r.IsAdvance) return "";
        var monthly = r.MonthlyAdvanceDays;
        var annual = r.AnnualAdvanceDays;
        if (monthly <= 0m && annual <= 0m) annual = r.AdvanceDays;
        if (monthly > 0m && annual > 0m) return "월차/연차 가불";
        if (monthly > 0m) return "월차 가불";
        return "연차 가불";
    }

    public string AdvanceBreakdownLabel(LeaveRequest r)
    {
        if (!r.IsAdvance) return "";
        var monthly = r.MonthlyAdvanceDays;
        var annual = r.AnnualAdvanceDays;
        if (monthly <= 0m && annual <= 0m) annual = r.AdvanceDays;
        var parts = new List<string>();
        if (monthly > 0m) parts.Add($"월차 {monthly:0.#}일");
        if (annual > 0m) parts.Add($"연차 {annual:0.#}일");
        return string.Join(" / ", parts);
    }

    public Task<IActionResult> OnPostDecide(long id, bool approve) => Act("Decide", id, approve, null);
    public Task<IActionResult> OnPostCancelDecide(long id, bool approve) => Act("CancelDecide", id, approve, null);
    public Task<IActionResult> OnPostForceDelete(long id, string? reason) => Act("ForceDelete", id, false, reason);
    async Task<IActionResult> Act(string operation, long id, bool approve, string? reason)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == FormMedia);
        async Task<IActionResult> Failure(string outcome, string message, int status) {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = FormMedia };
            ErrorMessage = message; SubmittedReason = reason; WriteLocked = true;
            await OnGet(); Response.StatusCode = status; return Page();
        }
        var actor = await current.GetRequiredAsync();
        var actorId = actor.Id.ToString(CultureInfo.InvariantCulture);
        var hasBaseline = Request.Form.ContainsKey("expectedEmployeeId") || Request.Form.ContainsKey("expectedSnapshot");
        if (!actor.IsAdmin) return await Failure("denied", "관리자 권한이 필요합니다.", 403);
        if (!ModelState.IsValid || id <= 0 || Request.Form["id"].Count != 1
            || operation != "ForceDelete" && (Request.Form["approve"].Count != 1 || Request.Form["approve"].ToString() is not ("true" or "false")))
            return await Failure("invalid", "신청 대상과 처리 종류를 확인해 주세요.", 422);
        if ((enhanced || hasBaseline) && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != actorId))
            return await Failure("conflict", "화면을 연 직원과 현재 계정이 다릅니다. 현재 계정으로 다시 확인해 주세요.", 409);
        var request = await db.LeaveRequests.Include(x => x.Employee).Include(x => x.Dates).SingleOrDefaultAsync(x => x.Id == id);
        if (request is null || request.Employee.IsCompanyMaster) return await Failure("conflict", "처리할 신청을 확인할 수 없습니다. 최신 목록을 확인해 주세요.", 409);
        var before = Snapshot(request);
        if ((enhanced || hasBaseline) && (Request.Form["expectedSnapshot"].Count != 1 || Request.Form["expectedSnapshot"] != before))
            return await Failure("conflict", "신청 내용이나 처리 상태가 바뀌었습니다. 최신 목록을 확인해 주세요.", 409);
        if (operation != "ForceDelete" && request.EmployeeId == actor.Id)
            return await Failure("invalid", "본인의 신청과 취소 요청은 다른 관리자가 처리해야 합니다.", 422);
        if (operation == "Decide" && request.Status != LeaveRequestStatus.Pending || operation == "CancelDecide" && request.Status != LeaveRequestStatus.CancelRequested)
            return await Failure("conflict", "이미 처리되었거나 대기 상태가 아닙니다. 최신 목록을 확인해 주세요.", 409);
        if (operation == "ForceDelete") {
            if (Request.Form["reason"].Count != 1) return await Failure("invalid", "강제 삭제 사유를 확인해 주세요.", 422);
            try { security.EnsureCanForceDelete(actor); security.RequireReason(reason, "강제 삭제 사유"); }
            catch (UnauthorizedAccessException) { return await Failure("denied", "강제 삭제 권한이 없습니다.", 403); }
            catch (InvalidOperationException ex) { return await Failure("invalid", ex.Message, 422); }
        }
        try {
            if (operation == "Decide") await service.DecideAsync(id, actor.Id, approve, null);
            else if (operation == "CancelDecide") await service.DecideCancelAsync(id, actor.Id, approve);
            else await service.ForceDeleteAsync(id, actor.Id, reason);
            if (!enhanced) return RedirectToPage();
            var status = operation == "ForceDelete" ? "deleted" : (operation == "Decide" ? (approve ? LeaveRequestStatus.Approved : LeaveRequestStatus.Rejected) : (approve ? LeaveRequestStatus.Cancelled : LeaveRequestStatus.Approved)).ToString();
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = "연차 신청 처리를 완료했습니다.", data = new {
                operation, employeeId = actorId, id = id.ToString(CultureInfo.InvariantCulture), approve = operation == "ForceDelete" ? null : approve ? "true" : "false",
                previousSnapshot = before, status
            } }) { ContentType = FormMedia };
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) {
            logger.LogError(ex, "Leave approval action {Operation} failed for {RequestId}", operation, id);
            return await Failure("unknown", "처리 결과를 확인하지 못했습니다. 신청 변경 또는 알림 일부가 반영되었을 수 있습니다. 다시 실행하지 말고 최신 내역을 확인해 주세요.", 500);
        }
    }

    public string Kst(DateTime utc) => AppTime.ToKst(utc).ToString("yyyy-MM-dd HH:mm");

    public string StatusName(LeaveRequestStatus s) => s switch { LeaveRequestStatus.Pending => "승인 대기", LeaveRequestStatus.Approved => "승인", LeaveRequestStatus.Rejected => "반려", LeaveRequestStatus.CancelRequested => "취소 승인 대기", LeaveRequestStatus.Cancelled => "취소", _ => s.ToString() };

    public string PortionName(LeaveDayPortion p) => p switch
    {
        LeaveDayPortion.FullDay => "연차",
        LeaveDayPortion.Morning => "오전반차",
        LeaveDayPortion.Afternoon => "오후반차",
        LeaveDayPortion.특수휴가 => "특수 휴가",
        LeaveDayPortion.기타 => "기타",
        LeaveDayPortion.Birthday => "🎂 생일연차",
        _ => p.ToString()
    };
}

public record RequestRow(LeaveRequest Request, LeaveBalance Balance, string DecisionActorLabel);
public record ApprovalActionModel(LeaveRequest Request, Employee Actor, string Operation, bool Locked);
