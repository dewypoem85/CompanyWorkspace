using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Schedule;
using System.Text.Json;
using Xunit;

public class MilestoneTests
{
    [Fact]
    public async Task ProjectFilterLimitsMilestonesToTheSelectedOrMemberProjects()
    {
        await using var factory = new ScheduleFactory();
        factory.Projects.Add(new Project { Id = 20, Name = "다른 프로젝트" });
        factory.Memberships.Add(new Membership { EmployeeId = 2, ProjectId = 10 });
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        foreach (var input in new[] { new MilestoneInput("선택 프로젝트", new(2026, 9, 8), 10, 0), new MilestoneInput("다른 프로젝트", new(2026, 9, 8), 20, 0), new MilestoneInput("미지정", new(2026, 9, 8), null, 0) })
        {
            var created = await admin.PostAsJsonAsync("/api/milestones", input); created.EnsureSuccessStatusCode();
        }
        var bootstrap = await employee.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Equal(10, Assert.Single(bootstrap.GetProperty("me").GetProperty("projectIds").EnumerateArray()).GetInt64());
        var selected = await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-09-01&to=2026-09-30&projectId=10");
        Assert.Equal("선택 프로젝트", Assert.Single(selected!).Title);
        var mine = await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-09-01&to=2026-09-30&projectId=mine");
        Assert.Equal("선택 프로젝트", Assert.Single(mine!).Title);
        Assert.Equal(HttpStatusCode.BadRequest, (await employee.GetAsync("/api/milestones?from=2026-09-01&to=2026-09-30&projectId=unknown")).StatusCode);
    }

    [Fact]
    public async Task OneMilestoneKeepsOneDeadlinePerTypeAndNormalizesLegacyRanges()
    {
        await using var factory = new ScheduleFactory();
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        var input = new MilestoneInput("신캐릭터&신스킨", new(2026, 10, 30), 10, 0, "모든 단계가 공유하는 내용", "update",
            EndDate: new(2026, 10, 31), AdditionalSchedules: [new("prototype", new(2026, 10, 10), Memo: "신캐릭터 마감"), new("review", new(2026, 10, 20), new(2026, 10, 22), "신스킨 마감")], DeadlineMemo: "업데이트 마감");
        var created = await admin.PostAsJsonAsync("/api/milestones", input); created.EnsureSuccessStatusCode();
        var saved = (await created.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(2, saved.AdditionalSchedules.Count); Assert.Equal(new DateOnly(2026, 10, 31), saved.Date); Assert.Null(saved.EndDate);
        Assert.Equal("업데이트 마감", saved.DeadlineMemo); Assert.Equal("신캐릭터 마감", saved.AdditionalSchedules[0].Memo);
        Assert.Equal(new DateOnly(2026, 10, 22), saved.AdditionalSchedules[1].Date); Assert.Null(saved.AdditionalSchedules[1].EndDate);
        Assert.Equal("신스킨 마감", saved.AdditionalSchedules[1].Memo);
        foreach (var day in new[] { 10, 22, 31 })
        {
            var rows = await employee.GetFromJsonAsync<Milestone[]>($"/api/milestones?from=2026-10-{day:00}&to=2026-10-{day:00}");
            var visible = Assert.Single(rows!);
            Assert.Equal(saved.Id, visible.Id); Assert.Equal(input.Description, visible.Description);
            Assert.Equal(new[] { "prototype", "review" }, visible.AdditionalSchedules.Select(x => x.Type));
        }
        Assert.Empty((await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-10-21&to=2026-10-21"))!);
        Assert.Empty((await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-10-30&to=2026-10-30"))!);
        var legacy = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", new { title = "10월 업데이트 수정", date = saved.Date, projectId = 10, version = saved.Version });
        legacy.EnsureSuccessStatusCode();
        saved = (await legacy.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(2, saved.AdditionalSchedules.Count); Assert.Equal(new DateOnly(2026, 10, 31), saved.Date); Assert.Null(saved.EndDate); Assert.Equal("업데이트 마감", saved.DeadlineMemo);
        var invalid = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = saved.Version, AdditionalSchedules = [new("review", new(2026, 10, 22), new(2026, 10, 20))] });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task PrototypeCanBeCreatedAndChangedWithoutLosingProjectOrDescription()
    {
        await using var factory = new ScheduleFactory();
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        var input = new MilestoneInput("프로토타입 시연", new(2026, 9, 8), 10, 0, "조작감 확인", "prototype");
        var response = await admin.PostAsJsonAsync("/api/milestones", input); response.EnsureSuccessStatusCode();
        var saved = (await response.Content.ReadFromJsonAsync<Milestone>())!;
        var rows = await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-09-01&to=2026-09-30");
        var visible = Assert.Single(rows!);
        Assert.Equal("prototype", visible.Type); Assert.Equal(10, visible.ProjectId); Assert.Equal(input.Description, visible.Description);
        foreach (var type in new[] { "review", "prototype" })
        {
            var updated = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = saved.Version, Type = type });
            updated.EnsureSuccessStatusCode(); saved = (await updated.Content.ReadFromJsonAsync<Milestone>())!;
            Assert.Equal(type, saved.Type); Assert.Equal(10, saved.ProjectId); Assert.Equal(input.Description, saved.Description);
        }
    }

    [Fact]
    public async Task DescriptionRoundTripsAndOldClientsCannotAccidentallyEraseIt()
    {
        await using var factory = new ScheduleFactory();
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        var input = new MilestoneInput("업데이트 검수", new(2026, 9, 8), 10, 0, "준비 사항\n1. 빌드 전달\n2. QA 확인 <완료>", "review");
        var response = await admin.PostAsJsonAsync("/api/milestones", input); response.EnsureSuccessStatusCode();
        var saved = (await response.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(input.Description, saved.Description); Assert.Equal("review", saved.Type);
        var rows = await employee.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-09-01&to=2026-09-30");
        Assert.Equal(input.Description, Assert.Single(rows!).Description);
        var updated = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = saved.Version, Type = "update", Description = "수정된 준비 사항\n이미지 대신 전달 경로 기재" });
        updated.EnsureSuccessStatusCode(); saved = (await updated.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = saved.Version, Description = new string('x', 10001) })).StatusCode);
        var legacy = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", new { title = "이름만 수정", date = input.Date, projectId = 10, version = saved.Version });
        legacy.EnsureSuccessStatusCode(); var preserved = (await legacy.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(saved.Description, preserved.Description); Assert.Equal("update", preserved.Type);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = preserved.Version, Type = "invalid" })).StatusCode);
        var cleared = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = preserved.Version, Description = "" });
        cleared.EnsureSuccessStatusCode(); Assert.Equal("", (await cleared.Content.ReadFromJsonAsync<Milestone>())!.Description);
        var oldCreate = await admin.PostAsJsonAsync("/api/milestones", new MilestoneInput("기존 형식", input.Date, null, 0));
        oldCreate.EnsureSuccessStatusCode(); Assert.Equal("", (await oldCreate.Content.ReadFromJsonAsync<Milestone>())!.Description);
    }

    [Fact]
    public async Task EveryEmployeeCanCreateAndUpdateWhileAuthorshipAndChangesAreAudited()
    {
        await using var factory = new ScheduleFactory();
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        var input = new MilestoneInput("공통 일정", new(2026, 9, 8), null, 0, new string('가', 10000));
        var created = await employee.PostAsJsonAsync("/api/milestones", input); created.EnsureSuccessStatusCode();
        var saved = (await created.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(10000, saved.Description.Length); Assert.Equal(2, saved.CreatedBy); Assert.Equal(2, saved.UpdatedBy); Assert.NotNull(saved.CreatedAt); Assert.NotNull(saved.UpdatedAt);
        var updated = await admin.PutAsJsonAsync($"/api/milestones/{saved.Id}", input with { Version = saved.Version, Title = "공통 일정 수정", Description = "관리자가 상세 수정" });
        updated.EnsureSuccessStatusCode(); saved = (await updated.Content.ReadFromJsonAsync<Milestone>())!;
        Assert.Equal(2, saved.CreatedBy); Assert.Equal(1, saved.UpdatedBy); Assert.Equal("공통 일정 수정", saved.Title);
        var history = await employee.GetFromJsonAsync<MilestoneRevision[]>($"/api/milestones/{saved.Id}/history");
        Assert.Equal(2, history!.Length); Assert.Equal("update", history[0].Action); Assert.Equal(1, history[0].ActorId);
        Assert.Equal("공통 일정", JsonDocument.Parse(history[0].BeforeSnapshot).RootElement.GetProperty("title").GetString()); Assert.Equal("공통 일정 수정", JsonDocument.Parse(history[0].AfterSnapshot).RootElement.GetProperty("title").GetString());
        Assert.Equal("create", history[1].Action); Assert.Equal(2, history[1].ActorId); Assert.Equal("", history[1].BeforeSnapshot); Assert.Equal("공통 일정", JsonDocument.Parse(history[1].AfterSnapshot).RootElement.GetProperty("title").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.DeleteAsync($"/api/milestones/{saved.Id}?version={saved.Version}")).StatusCode);
    }

    [Fact]
    public async Task MigrationKeepsExistingMilestoneAndCanRunAgain()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new ScheduleDb(new DbContextOptionsBuilder<ScheduleDb>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE Milestones (Id INTEGER PRIMARY KEY, Title TEXT NOT NULL, Date TEXT NOT NULL, ProjectId INTEGER NULL, Version INTEGER NOT NULL); INSERT INTO Milestones VALUES (17,'기존 마감','2026-09-08',10,9);");
        await MilestoneSchema.ApplyAsync(db); await MilestoneSchema.ApplyAsync(db);
        var old = await db.Milestones.SingleAsync();
        Assert.Equal("general", old.Type); Assert.Equal(17, old.Id); Assert.Equal("기존 마감", old.Title); Assert.Equal(10, old.ProjectId); Assert.Equal(9, old.Version); Assert.Equal("", old.Description); Assert.Equal("", old.DeadlineMemo); Assert.Empty(old.AdditionalSchedules); Assert.Null(old.EndDate); Assert.Null(old.CreatedBy); Assert.Empty(await db.MilestoneRevisions.ToListAsync());
        old.Type = "update"; old.Description = "추가 내용\n보존 확인"; await db.SaveChangesAsync();
        await MilestoneSchema.ApplyAsync(db); db.ChangeTracker.Clear();
        Assert.Equal("추가 내용\n보존 확인", (await db.Milestones.SingleAsync()).Description);
        Assert.Equal("update", (await db.Milestones.SingleAsync()).Type);
        var legacyRange = await db.Milestones.SingleAsync();
        legacyRange.EndDate = new(2026, 9, 10); legacyRange.AdditionalSchedules = [new("review", new(2026, 9, 12), new(2026, 9, 14))]; await db.SaveChangesAsync();
        await MilestoneSchema.ApplyAsync(db); db.ChangeTracker.Clear();
        var deadline = await db.Milestones.SingleAsync();
        Assert.Equal(new DateOnly(2026, 9, 10), deadline.Date); Assert.Null(deadline.EndDate);
        Assert.Equal(new DateOnly(2026, 9, 14), Assert.Single(deadline.AdditionalSchedules).Date);
        Assert.Null(Assert.Single(deadline.AdditionalSchedules).EndDate);
        var version = deadline.Version;
        await MilestoneSchema.ApplyAsync(db); db.ChangeTracker.Clear();
        Assert.Equal(version, (await db.Milestones.SingleAsync()).Version);
    }
}
