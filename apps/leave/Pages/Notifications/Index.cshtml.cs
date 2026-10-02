using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using System.Globalization;

namespace LeaveManager.Pages.Notifications;

public class IndexModel(CurrentEmployeeService current, NotificationService notifications) : PageModel
{
    private const string FormMediaType = "application/vnd.company.workspace-form+json";
    private bool WantsFormResult => Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == FormMediaType);
    public long EmployeeId { get; set; }
    [TempData] public string? StatusMessage { get; set; }
    [TempData] public string? ErrorMessage { get; set; }
    private IActionResult FormResult(string outcome, string message, int status, object? data = null)
    {
        Response.Headers.CacheControl = "no-store";
        return new JsonResult(new { protocol = "workspace-form-v1", outcome, message, data }) { StatusCode = status, ContentType = FormMediaType };
    }
    private IActionResult Saved(string operation, long employeeId, long? id, string? navigateTo = null) =>
        FormResult("saved", "알림을 읽음 처리했습니다.", 200, new {
            operation, employeeId = employeeId.ToString(CultureInfo.InvariantCulture),
            id = id?.ToString(CultureInfo.InvariantCulture), navigateTo
        });
    private IActionResult Unavailable() => FormResult("invalid", "현재 계정에서 알림을 확인할 수 없습니다. 목록을 다시 확인해 주세요.", 422);
    // Old native forms remain compatible; enhanced forms must identify the rendered account.
    private bool MatchesEmployee(long? expectedEmployeeId, long currentEmployeeId) => ModelState.IsValid
        && (expectedEmployeeId == currentEmployeeId || (!WantsFormResult && expectedEmployeeId is null));
    public List<AppNotification> Items { get; set; } = [];
    public int UnreadCount { get; set; }

    public async Task OnGet()
    {
        var employee = await current.GetRequiredAsync();
        EmployeeId = employee.Id;
        Response.Headers.CacheControl = "no-store";
        Items = (await notifications.GetRecentAsync(employee.Id, 120)).ToList();
        UnreadCount = await notifications.GetUnreadCountAsync(employee.Id);
    }

    public async Task<IActionResult> OnGetSummary(long afterId = 0)
    {
        var employee = await current.GetRequiredAsync();
        var unreadCount = await notifications.GetUnreadCountAsync(employee.Id);
        var latestId = await notifications.GetLatestIdAsync(employee.Id);
        var newItems = await notifications.GetUnreadAfterAsync(employee.Id, afterId, 10);

        return new JsonResult(new
        {
            unreadCount,
            latestId,
            items = newItems.Select(x => new
            {
                id = x.Id,
                type = x.Type,
                typeLabel = TypeLabel(x.Type),
                title = x.Title,
                message = x.Message,
                link = x.Link,
                createdAt = Kst(x.CreatedAtUtc)
            })
        });
    }

    public async Task<IActionResult> OnGetOpen(long id)
    {
        var employee = await current.GetRequiredAsync();
        var items = await notifications.GetRecentAsync(employee.Id, 200);
        var item = items.FirstOrDefault(x => x.Id == id);
        if (item is null) return RedirectToPage();
        await notifications.MarkReadAsync(id, employee.Id);
        if (string.IsNullOrWhiteSpace(item.Link)) return RedirectToPage();
        return LocalRedirect(item.Link);
    }

    public async Task<IActionResult> OnPostMarkRead(long id, long? expectedEmployeeId)
    {
        var employee = await current.GetRequiredAsync();
        var found = MatchesEmployee(expectedEmployeeId, employee.Id) && id > 0 && await notifications.MarkReadAsync(id, employee.Id);
        if (WantsFormResult) return found ? Saved("MarkRead", employee.Id, id) : Unavailable();
        if (found) StatusMessage = "알림을 읽음 처리했습니다.";
        else ErrorMessage = "현재 계정에서 알림을 확인할 수 없습니다.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostMarkAllRead(long? expectedEmployeeId)
    {
        var employee = await current.GetRequiredAsync();
        if (!MatchesEmployee(expectedEmployeeId, employee.Id)) {
            if (WantsFormResult) return Unavailable();
            ErrorMessage = "화면을 연 계정과 현재 계정이 다릅니다. 목록을 다시 확인해 주세요.";
            return RedirectToPage();
        }
        await notifications.MarkAllReadAsync(employee.Id);
        if (WantsFormResult) return Saved("MarkAllRead", employee.Id, null);
        StatusMessage = "알림을 모두 읽음 처리했습니다.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostOpen(long id, long? expectedEmployeeId)
    {
        var employee = await current.GetRequiredAsync();
        var items = await notifications.GetRecentAsync(employee.Id, 200);
        var item = items.FirstOrDefault(x => x.Id == id);
        if (!MatchesEmployee(expectedEmployeeId, employee.Id) || item is null) return WantsFormResult ? Unavailable() : RedirectToPage();
        var found = await notifications.MarkReadAsync(id, employee.Id);
        if (WantsFormResult) return found ? Saved("Open", employee.Id, id,
            !string.IsNullOrWhiteSpace(item.Link) && Url.IsLocalUrl(item.Link) ? item.Link : Url.Page("/Notifications/Index")!) : Unavailable();
        if (string.IsNullOrWhiteSpace(item.Link)) return RedirectToPage();
        return LocalRedirect(item.Link);
    }

    public string Kst(DateTime utc) => AppTime.ToKst(utc).ToString("yyyy-MM-dd HH:mm");

    public string TypeLabel(string type) => type switch
    {
        "LeaveRequestCreated" => "연차 신청",
        "LeaveRequestApproved" => "신청 승인",
        "LeaveRequestRejected" => "신청 반려",
        "LeaveCancelRequested" => "취소 요청",
        "LeaveCancelApproved" => "취소 승인",
        "LeaveCancelRejected" => "취소 반려",
        "LeaveRequestForceCreated" => "관리자 추가",
        "LeaveRequestForceDeleted" => "관리자 삭제",
        _ => "알림"
    };
}
