using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class LeaveMilestoneReadApiTests
{
    [Fact]
    public async Task LeaveCalendarReceivesOnlyActorVisibleMilestoneOccurrences()
    {
        await using var factory = new ScheduleFactory();
        factory.Projects.Add(new Project { Id = 11, Name = "비공개 프로젝트", IsPrivate = true });
        using var initialize = LeaveClient(factory, 2);
        (await initialize.GetAsync("/api/internal/leave/milestones?from=2026-09-01&to=2026-09-30")).EnsureSuccessStatusCode();

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            db.Milestones.AddRange(
                new Milestone { Id = 9007199254740993, Title = "회사 전체 검수", Type = "review", Date = new(2026, 9, 10), Description = "내부 상세", DeadlineMemo = "1차 검수 마감", AdditionalSchedules = [new("update", new(2026, 9, 12), Memo: "정식 업데이트 마감")] },
                new Milestone { Id = 9007199254740994, Title = "공개 프로젝트", Type = "general", Date = new(2026, 9, 11), ProjectId = 10 },
                new Milestone { Id = 9007199254740995, Title = "비공개 프로젝트 일정", Type = "prototype", Date = new(2026, 9, 13), ProjectId = 11 },
                new Milestone { Id = 9007199254740996, Title = "범위 밖", Type = "general", Date = new(2026, 10, 1) });
            await db.SaveChangesAsync();
        }

        using var employee = LeaveClient(factory, 2);
        var response = await employee.GetAsync("/api/internal/leave/milestones?from=2026-09-01&to=2026-09-30");
        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl!.NoStore);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var rows = body.GetProperty("items").EnumerateArray().ToArray();
        Assert.Equal(3, rows.Length);
        Assert.Equal(new[] { "2026-09-10", "2026-09-11", "2026-09-12" }, rows.Select(row => row.GetProperty("date").GetString()).ToArray());
        Assert.Equal("1차 검수 마감", rows[0].GetProperty("title").GetString());
        Assert.Equal("정식 업데이트 마감", rows[2].GetProperty("title").GetString());
        Assert.DoesNotContain(rows, row => row.GetProperty("milestoneId").GetString() == "9007199254740995");
        Assert.All(rows, row => Assert.Equal(new[] { "milestoneId", "occurrenceIndex", "type", "title", "date", "projectId", "projectName" }, row.EnumerateObject().Select(property => property.Name).ToArray()));
        Assert.DoesNotContain("내부 상세", await response.Content.ReadAsStringAsync());

        using var admin = LeaveClient(factory, 1);
        var adminBody = await admin.GetFromJsonAsync<JsonElement>("/api/internal/leave/milestones?from=2026-09-01&to=2026-09-30");
        Assert.Contains(adminBody.GetProperty("items").EnumerateArray(), row => row.GetProperty("milestoneId").GetString() == "9007199254740995" && row.GetProperty("projectName").GetString() == "비공개 프로젝트");
    }

    [Fact]
    public async Task LeaveMilestoneReadRejectsAnonymousWrongAudienceAndInvalidRange()
    {
        await using var factory = new ScheduleFactory();
        using var anonymous = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        const string path = "/api/internal/leave/milestones?from=2026-09-01&to=2026-09-30";
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);

        using var wrong = LeaveClient(factory, 1, "company-notifications");
        Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync(path)).StatusCode);

        using var valid = LeaveClient(factory, 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await valid.GetAsync("/api/internal/leave/milestones?from=2026-01-01&to=2027-12-31")).StatusCode);
    }

    private static HttpClient LeaveClient(ScheduleFactory factory, long actor, string audience = "leave-milestones")
    {
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var token = Tokens.Sign(new
        {
            iss = "company-leave",
            aud = audience,
            sub = actor.ToString(System.Globalization.CultureInfo.InvariantCulture),
            iat = now,
            exp = now + 60,
            jti = Guid.NewGuid().ToString("N")
        }, ScheduleFactory.Secret);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
