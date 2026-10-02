using LeaveManager.Models;

namespace LeaveManager.Services;

public record NotificationPayload(string Type, string Title, string Message, string? Link = null);

public static class NotificationMessageFactory
{
    public static NotificationPayload LeaveRequestCreated(LeaveRequest request)
    {
        var portion = FirstPortion(request);
        var title = request.IsAdvance
            ? "새 휴가 가불 신청"
            : portion == LeaveDayPortion.Birthday ? "새 생일연차 신청"
            : portion == LeaveDayPortion.기타 ? "새 기타 신청" : "새 연차 신청";
        var message = request.IsAdvance
            ? $"{request.Employee?.Name ?? "직원"}님이 {RequestDateLabel(request)}에 {PortionLabel(portion)}를 신청했습니다. 부족분 {request.AdvanceDays:0.#}일은 월차 {request.MonthlyAdvanceDays:0.#}일 / 다음 연차 {request.AnnualAdvanceDays:0.#}일 가불로 차감됩니다."
            : $"{request.Employee?.Name ?? "직원"}님이 {RequestDateLabel(request)}에 {PortionLabel(portion)}를 신청했습니다.";
        return new NotificationPayload("LeaveRequestCreated", title, message, "/Admin");
    }

    public static NotificationPayload LeaveRequestCreatedPublic(LeaveRequest request)
    {
        if (FirstPortion(request) != LeaveDayPortion.Birthday) return LeaveRequestCreated(request);
        return new NotificationPayload(
            "LeaveRequestCreated",
            "새 연차 신청",
            $"{request.Employee?.Name ?? "직원"}님이 {RequestDateLabel(request)}에 연차를 신청했습니다.",
            "/Admin");
    }

    public static NotificationPayload LeaveCancelRequested(LeaveRequest request)
    {
        var requestLabel = RequestLabel(request);
        return new NotificationPayload(
            "LeaveCancelRequested",
            $"{requestLabel} 취소 승인 요청",
            $"{request.Employee?.Name ?? "직원"}님이 {RequestDateLabel(request)} {requestLabel} 취소 승인을 요청했습니다.",
            "/Admin");
    }

    public static NotificationPayload LeaveRequestDecision(LeaveRequest request, bool approve)
    {
        var requestLabel = RequestLabel(request);
        return new NotificationPayload(
            approve ? "LeaveRequestApproved" : "LeaveRequestRejected",
            $"{requestLabel} 신청 {(approve ? "승인" : "반려")}",
            $"{RequestDateLabel(request)} {requestLabel} 신청이 {(approve ? "승인" : "반려")}되었습니다.",
            "/Leave/Index");
    }

    public static NotificationPayload LeaveCancelDecision(LeaveRequest request, bool approve)
    {
        var requestLabel = RequestLabel(request);
        return new NotificationPayload(
            approve ? "LeaveCancelApproved" : "LeaveCancelRejected",
            $"{requestLabel} 취소 {(approve ? "승인" : "반려")}",
            $"{RequestDateLabel(request)} {requestLabel} 취소 요청이 {(approve ? "승인" : "반려")}되었습니다.",
            "/Leave/Index");
    }

    public static NotificationPayload LeaveRequestForceCreated(DateOnly date, LeaveDayPortion portion)
    {
        var title = portion switch
        {
            LeaveDayPortion.특수휴가 => "특수 휴가 기록 추가",
            LeaveDayPortion.기타 => "기타 기록 추가",
            LeaveDayPortion.Birthday => "생일연차 기록 추가",
            _ => "연차 기록 추가"
        };
        return new NotificationPayload(
            "LeaveRequestForceCreated",
            title,
            $"관리자가 {date:yyyy-MM-dd} {PortionLabel(portion)} 기록을 추가했습니다.",
            "/Leave/Index");
    }

    public static NotificationPayload LeaveRequestForceDeleted(LeaveRequest request)
    {
        var portion = FirstPortion(request);
        return new NotificationPayload(
            "LeaveRequestForceDeleted",
            "휴가 기록 삭제",
            $"관리자가 {RequestDateLabel(request)} {PortionLabel(portion)} 기록을 삭제했습니다.",
            "/Leave/Index");
    }

    public static string RequestDateLabel(LeaveRequest request)
    {
        var ordered = request.Dates.OrderBy(x => x.Date).ToList();
        if (ordered.Count == 0) return "날짜 미지정";
        var start = ordered.First().Date;
        var end = ordered.Last().Date;
        return start == end ? start.ToString("yyyy-MM-dd") : $"{start:yyyy-MM-dd} ~ {end:yyyy-MM-dd}";
    }

    public static LeaveDayPortion FirstPortion(LeaveRequest request)
    {
        return request.Dates.OrderBy(x => x.Date).FirstOrDefault()?.Portion ?? LeaveDayPortion.FullDay;
    }

    private static string RequestLabel(LeaveRequest request) => FirstPortion(request) switch
    {
        LeaveDayPortion.Birthday => "생일연차",
        LeaveDayPortion.기타 => "기타",
        _ => "연차"
    };

    public static string PortionLabel(LeaveDayPortion portion) => portion switch
    {
        LeaveDayPortion.FullDay => "연차",
        LeaveDayPortion.Morning => "오전반차",
        LeaveDayPortion.Afternoon => "오후반차",
        LeaveDayPortion.특수휴가 => "특수 휴가",
        LeaveDayPortion.기타 => "기타",
        LeaveDayPortion.Birthday => "생일연차",
        _ => portion.ToString()
    };
}
