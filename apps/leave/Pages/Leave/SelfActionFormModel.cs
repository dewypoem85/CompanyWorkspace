using LeaveManager.Models;
namespace LeaveManager.Pages.Leave;

public record SelfActionFormModel(IndexModel Page, string Operation, LeaveRequest? Request = null)
{
    public bool Detail => Request is null;
    public string? FormId => !Detail ? null : Operation == "Cancel" ? "detailCancelForm" : "detailWithdrawCancelForm";
    public string? InputId => !Detail ? null : Operation == "Cancel" ? "detailCancelRequestId" : "detailWithdrawCancelRequestId";
    public static string DateLabel(LeaveRequest request) {
        var dates=request.Dates.Select(x=>x.Date).Order().ToList();
        return dates.Count==0 ? "날짜 없음" : dates[0]==dates[^1] ? dates[0].ToString("yyyy-MM-dd") : $"{dates[0]:yyyy-MM-dd} ~ {dates[^1]:yyyy-MM-dd}";
    }
}
