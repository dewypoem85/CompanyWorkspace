using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    const long CalendarPersonId = 9007199254741011L;
    const long CalendarCompanyId = 9007199254742011L;
    const long CalendarProjectId = 9007199254744011L;
    const string CalendarPersonName = "🧑|직원 <b>이름</b> & 검증";

    static async Task SeedCalendarEntities(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        var owner = await db.Employees.FindAsync(long.Parse(s.Owner, CultureInfo.InvariantCulture));
        owner!.HireDate = s.Start.AddYears(-2);
        owner.BirthDate = new DateOnly(2000, s.Start.Month, s.Start.Day);
        for (var i = 0; i < 6; i++) {
            var employee = new Employee {
                Id = CalendarPersonId + i, CompanyUserId = i == 5 ? null : CalendarCompanyId + i,
                Name = i == 0 ? CalendarPersonName : new[] { "", "비공개 검증", "마스터 검증", "공용 검증", "퇴사 검증", "미연결 검증" }[i],
                Email = $"calendar-{i}@example.test", HireDate = s.Start.AddYears(-2), BirthDate = i == 0 ? new DateOnly(2000, s.Start.Month, s.Start.Day) : null,
                IsPrivate = i == 1, IsCompanyMaster = i == 2, IsSharedAccount = i == 3, IsActive = i != 4
            };
            db.Employees.Add(employee);
            db.LeaveRequests.Add(new() { EmployeeId = employee.Id, Status = LeaveRequestStatus.Approved, CalculatedDays = 1,
                Reason = "사유|<b>원문</b>", WorkPlan = "업무|원문", Dates = [new() { Date = i == 0 ? s.Start.AddDays(1) : s.Start, Portion = LeaveDayPortion.FullDay }] });
            db.ExternalSchedules.Add(new() { EmployeeId = employee.Id, StartDate = s.Start, EndDate = s.Start, Category = "출장", Memo = "메모|원문" });
        }
        db.Holidays.Add(new() { Date = s.Start, Name = "공휴일|<b>원문</b>" });
        db.ExternalSchedules.Add(new() { EmployeeId = owner.Id, StartDate = s.Start, EndDate = s.Start, Category = "출장", Memo = "본인 일정" });
        await db.SaveChangesAsync();
    }

    static string CalendarEntityMarkup(string html) => Regex.Match(html, "<div[^>]*id=\"calendarArea\"[^>]*>(.*?)(?=<dialog)", RegexOptions.Singleline).Value;

    [Theory]
    [InlineData("employee", false)]
    [InlineData("admin", true)]
    [InlineData("master", true)]
    public async Task CalendarEntitiesPreserveVisibilityAndExactIdentity(string role, bool admin)
    {
        await using var s = await ApplicationSetup.Create(role); await SeedCalendarEntities(s);
        s.Leave.ScheduleResponse = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { items = new[] { new {
            milestoneId = "9007199254743011", occurrenceIndex = 0, type = "review", title = "주요 일정 <검수> & 확인", date = s.Start.ToString("yyyy-MM-dd"),
            projectId = CalendarProjectId.ToString(CultureInfo.InvariantCulture), projectName = "프로젝트 <원문>"
        } } }) };
        var query = $"Year={s.Start.Year}&Month={s.Start.Month}&SelfOnly=false&ShowOthers=true&SaveCalendarPreference=true";
        var html = await s.Client.GetStringAsync("/Leave?" + query);
        var calendar = CalendarEntityMarkup(html); Assert.NotEmpty(calendar);
        Assert.Contains($"data-employee-id=\"{CalendarPersonId}\"", calendar);
        Assert.Equal(admin, calendar.Contains($"data-employee-id=\"{CalendarPersonId + 1}\""));
        foreach (var offset in new[] { 2, 3 }) Assert.DoesNotContain($"data-employee-id=\"{CalendarPersonId + offset}\"", calendar);
        // Historic external schedules remain visible to admins even for inactive employees.
        Assert.Equal(admin, calendar.Contains($"data-employee-id=\"{CalendarPersonId + 4}\""));
        Assert.Equal(admin, calendar.Contains("data-detail=\"외부일정\""));
        Assert.Contains("data-detail=\"주요일정\"", calendar);
        var milestone = WebUtility.HtmlDecode(Regex.Match(calendar, "<div[^>]*data-detail=\"주요일정\"[^>]*>").Value);
        Assert.Contains("data-milestone-id=\"9007199254743011\"", milestone);
        Assert.Equal("주요 일정 <검수> & 확인", WebUtility.HtmlDecode(Regex.Match(calendar, "data-milestone-title=\"([^\"]*)\"").Groups[1].Value));
        Assert.Contains($"data-project-id=\"{CalendarProjectId}\"", milestone);
        Assert.Equal("프로젝트 <원문>", WebUtility.HtmlDecode(Regex.Match(calendar, "data-project-name=\"([^\"]*)\"").Groups[1].Value));
        Assert.Contains($"data-company-project=\"{CalendarProjectId}\"", calendar);
        var request = Regex.Matches(calendar, "<div[^>]*data-detail=\"신청\"[^>]*>").Select(x => x.Value).First(x => x.Contains($"data-employee-id=\"{CalendarPersonId}\""));
        Assert.Contains("data-status-code=\"Approved\"", request);
        Assert.Equal(CalendarPersonName, WebUtility.HtmlDecode(Regex.Match(request, "data-employee-name=\"([^\"]*)\"").Groups[1].Value));
        Assert.DoesNotContain("<b>이름</b>", calendar); Assert.DoesNotContain("data-detail=\"신청|", calendar);
        var map = JsonDocument.Parse(Regex.Match(html, "<script[^>]*data-company-employee-map[^>]*>(.*?)</script>", RegexOptions.Singleline).Groups[1].Value).RootElement;
        Assert.Equal(CalendarCompanyId.ToString(), map.GetProperty(CalendarPersonId.ToString()).GetString());
        Assert.Equal(admin, map.TryGetProperty((CalendarPersonId + 1).ToString(), out _));
        Assert.False(map.TryGetProperty((CalendarPersonId + 5).ToString(), out _));
        var year = await s.Client.GetStringAsync("/Leave?" + query + "&CalendarView=year");
        Assert.Contains($"data-company-local-employee=\"{CalendarPersonId}\"", year);
        Assert.Contains("year-event milestone", year);
        Assert.Contains("📌", year);
        Assert.Contains($"data-company-project=\"{CalendarProjectId}\"", year);
        if (role != "admin") return;
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return;
        Directory.CreateDirectory(output);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-entities.html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-entities.year.html"), year);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-entities.json"), JsonSerializer.Serialize(new {
            start = s.Start.ToString("yyyy-MM-dd"), localId = CalendarPersonId.ToString(), companyId = CalendarCompanyId.ToString(), projectId = CalendarProjectId.ToString(), name = CalendarPersonName,
            context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation")
        }));
    }

    [Theory]
    [InlineData("employee", false)]
    [InlineData("admin", true)]
    [InlineData("master", true)]
    public async Task CalendarBirthdaysAreVisibleOnlyToSelfAndAdmins(string role, bool admin)
    {
        await using var s = await ApplicationSetup.Create(role); await SeedCalendarEntities(s);
        using (var scope = s.Leave.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.FindAsync(long.Parse(s.Owner, CultureInfo.InvariantCulture)))!.BirthDate = new DateOnly(2000, s.Start.Month, 10);
            foreach (var employee in await db.Employees.Where(x => x.Id >= CalendarPersonId && x.Id <= CalendarPersonId + 4).ToListAsync())
                employee.BirthDate = new DateOnly(2000, s.Start.Month, 11 + (int)(employee.Id - CalendarPersonId));
            await db.SaveChangesAsync();
        }

        var query = $"Year={s.Start.Year}&Month={s.Start.Month}&SelfOnly=false&ShowOthers=true&SaveCalendarPreference=true";
        var html = await s.Client.GetStringAsync("/Leave?" + query);
        var monthBirthdays = Regex.Matches(CalendarEntityMarkup(html), "<div[^>]*data-detail=\"생일\"[^>]*>").Select(x => x.Value).ToList();
        Assert.Contains(monthBirthdays, x => x.Contains($"data-employee-id=\"{s.Owner}\""));
        Assert.Equal(admin, monthBirthdays.Any(x => x.Contains($"data-employee-id=\"{CalendarPersonId}\"")));
        Assert.Equal(admin, monthBirthdays.Any(x => x.Contains($"data-employee-id=\"{CalendarPersonId + 1}\"")));
        foreach (var offset in new[] { 2, 3, 4 })
            Assert.DoesNotContain(monthBirthdays, x => x.Contains($"data-employee-id=\"{CalendarPersonId + offset}\""));

        var year = await s.Client.GetStringAsync("/Leave?" + query + "&CalendarView=year");
        var yearBirthdays = Regex.Matches(year, "<span[^>]*year-event birthday[^>]*>").Select(x => x.Value).ToList();
        Assert.Contains(yearBirthdays, x => x.Contains($"data-employee-id=\"{s.Owner}\""));
        Assert.Equal(admin, yearBirthdays.Any(x => x.Contains($"data-employee-id=\"{CalendarPersonId}\"")));
        Assert.Equal(admin, yearBirthdays.Any(x => x.Contains($"data-employee-id=\"{CalendarPersonId + 1}\"")));
    }

    [Fact]
    public async Task CalendarBirthdayRespectsAdminSelfOnlyAndLeapDayPolicy()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedCalendarEntities(s);
        using (var scope = s.Leave.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.FindAsync(long.Parse(s.Owner, CultureInfo.InvariantCulture)))!.BirthDate = new DateOnly(2000, 2, 29);
            (await db.Employees.FindAsync(CalendarPersonId))!.BirthDate = new DateOnly(2000, 2, 29);
            await db.SaveChangesAsync();
        }

        var html = await s.Client.GetStringAsync("/Leave?Year=2026&Month=2&SelfOnly=true&ShowOthers=false&SaveCalendarPreference=true");
        var monthBirthdays = Regex.Matches(CalendarEntityMarkup(html), "<div[^>]*data-detail=\"생일\"[^>]*>").Select(x => x.Value).ToList();
        Assert.Contains(monthBirthdays, x => x.Contains($"data-employee-id=\"{s.Owner}\""));
        Assert.DoesNotContain(monthBirthdays, x => x.Contains($"data-employee-id=\"{CalendarPersonId}\""));
        Assert.Matches(new Regex("<td[^>]*data-date=\"2026-02-28\"[^>]*>.*?data-detail=\"생일\".*?</td>", RegexOptions.Singleline), CalendarEntityMarkup(html));
    }

    [Theory]
    [InlineData("master")]
    [InlineData("employee")]
    public async Task CalendarSelfScopeDoesNotReintroduceExcludedRenewalsOrExternalSchedules(string role)
    {
        await using var s = await ApplicationSetup.Create(role); await SeedCalendarEntities(s);
        if (role == "employee") {
            using var scope = s.Leave.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.FindAsync(long.Parse(s.Owner)))!.IsPrivate = true; await db.SaveChangesAsync();
        }
        var html = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}&SelfOnly=true&ShowOthers=false&SaveCalendarPreference=true");
        var calendar = CalendarEntityMarkup(html); Assert.NotEmpty(calendar);
        Assert.DoesNotContain("data-detail=\"갱신\"", calendar);
        Assert.DoesNotContain("data-detail=\"외부일정\"", calendar);
        Assert.DoesNotContain("data-detail=\"신청\"", calendar);
    }

    [Fact]
    public async Task CalendarKeepsLeaveContentWhenMilestoneSourceIsUnavailable()
    {
        await using var s = await ApplicationSetup.Create("admin");
        await SeedCalendarEntities(s);
        s.Leave.ScheduleResponse = _ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);

        var html = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}");
        var calendar = CalendarEntityMarkup(html);
        Assert.Contains("일정 페이지의 주요일정을 불러오지 못했습니다.", calendar);
        Assert.Contains("data-detail=\"신청\"", calendar);
        Assert.DoesNotContain("data-detail=\"주요일정\"", calendar);
    }
}
