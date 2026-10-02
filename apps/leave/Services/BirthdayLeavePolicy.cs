using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public record BirthdayLeaveWindow(DateOnly BenefitDate)
{
    public DateOnly StartsOn => BenefitDate.AddDays(-BirthdayLeavePolicy.WindowDays);
    public DateOnly EndsOn => BenefitDate.AddDays(BirthdayLeavePolicy.WindowDays);
    public bool Contains(DateOnly date) => date >= StartsOn && date <= EndsOn;
}

public record BirthdayLeaveAvailability(
    string State,
    string Title,
    string Message,
    string Tone,
    BirthdayLeaveWindow? Window,
    IReadOnlyList<DateOnly> ActiveBenefitDates)
{
    public bool IsAvailable => State == "available";
}

public static class BirthdayLeavePolicy
{
    public const int WindowDays = 30;

    public static BirthdayLeaveWindow? Resolve(DateOnly birthDate, DateOnly selectedDate)
    {
        return CandidateWindows(birthDate, selectedDate.Year)
            .Where(x => x.Contains(selectedDate))
            .OrderBy(x => Math.Abs(x.BenefitDate.DayNumber - selectedDate.DayNumber))
            .FirstOrDefault();
    }

    public static BirthdayLeaveWindow ResolveNearest(DateOnly birthDate, DateOnly selectedDate)
    {
        return CandidateWindows(birthDate, selectedDate.Year)
            .OrderBy(x => Math.Abs(x.BenefitDate.DayNumber - selectedDate.DayNumber))
            .ThenBy(x => x.BenefitDate)
            .First();
    }

    public static async Task<bool> HasActiveClaimAsync(AppDbContext db, long employeeId, DateOnly benefitDate)
    {
        var activeRequest = await db.LeaveRequests.AnyAsync(x =>
            x.EmployeeId == employeeId && x.BirthdayBenefitDate == benefitDate &&
            (x.Status == LeaveRequestStatus.Pending || x.Status == LeaveRequestStatus.Approved || x.Status == LeaveRequestStatus.CancelRequested));
        if (activeRequest) return true;

        // 신규 혜택 필드가 없던 시기의 생일 연차도 같은 혜택을 사용한 것으로 취급한다.
        return await db.LeaveRequestDates.AnyAsync(x =>
            x.LeaveRequest.EmployeeId == employeeId && x.IsBirthdayLeave &&
            x.LeaveRequest.BirthdayBenefitDate == null && x.Date == benefitDate &&
            (x.LeaveRequest.Status == LeaveRequestStatus.Pending || x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested));
    }

    public static async Task<BirthdayLeaveAvailability> GetAvailabilityAsync(AppDbContext db, Employee employee, DateOnly today)
    {
        if (!employee.BirthDate.HasValue)
            return new("missing", "생일 정보가 필요합니다", "포털 직원 정보에 생일 월·일을 등록하면 생일연차 기간을 안내합니다.", "neutral", null, []);

        var activeDates = await db.LeaveRequests
            .Where(x => x.EmployeeId == employee.Id && x.BirthdayBenefitDate != null &&
                (x.Status == LeaveRequestStatus.Pending || x.Status == LeaveRequestStatus.Approved || x.Status == LeaveRequestStatus.CancelRequested))
            .Select(x => x.BirthdayBenefitDate!.Value)
            .Distinct()
            .ToListAsync();
        var legacyDates = await db.LeaveRequestDates
            .Where(x => x.LeaveRequest.EmployeeId == employee.Id && x.IsBirthdayLeave && x.LeaveRequest.BirthdayBenefitDate == null &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Pending || x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested))
            .Select(x => x.Date)
            .Distinct()
            .ToListAsync();
        activeDates.AddRange(legacyDates);
        activeDates = activeDates.Distinct().OrderBy(x => x).ToList();

        var windows = Enumerable.Range(today.Year - 1, 4)
            .Select(year => new BirthdayLeaveWindow(BirthdayCalendarDate.InYear(employee.BirthDate.Value, year)))
            .Where(x => employee.HireDate <= x.BenefitDate)
            .OrderBy(x => x.BenefitDate)
            .ToList();
        var current = windows.FirstOrDefault(x => x.Contains(today));
        if (current is not null)
        {
            var used = activeDates.Contains(current.BenefitDate);
            return used
                ? new("used", "올해 생일연차를 이미 신청했습니다", $"기준 생일 {current.BenefitDate:MM월 dd일} 혜택이 신청·승인 또는 취소 승인 대기 중입니다.", "neutral", current, activeDates)
                : new("available", "🎂 지금 생일연차를 사용할 수 있어요", $"{current.StartsOn:yyyy-MM-dd} ~ {current.EndsOn:yyyy-MM-dd} 중 근무일 하루를 선택하세요. 일반 연차는 차감되지 않습니다.", "info", current, activeDates);
        }

        var next = windows.First(x => x.EndsOn >= today && x.StartsOn > today);
        return new("upcoming", "다음 생일연차 기간", $"{next.StartsOn:yyyy-MM-dd} ~ {next.EndsOn:yyyy-MM-dd}입니다. 신청 폼에서 해당 기간의 미래 근무일을 미리 선택할 수 있습니다.", "info", next, activeDates);
    }

    private static IEnumerable<BirthdayLeaveWindow> CandidateWindows(DateOnly birthDate, int selectedYear)
    {
        for (var year = selectedYear - 1; year <= selectedYear + 1; year++)
            yield return new BirthdayLeaveWindow(BirthdayCalendarDate.InYear(birthDate, year));
    }
}
