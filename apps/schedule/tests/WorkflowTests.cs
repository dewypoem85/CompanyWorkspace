using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]

public sealed class ScheduleFactory : WebApplicationFactory<Program>
{
    public const string Secret = "schedule-tests-only-secret-32-characters-minimum";
    public List<Employee> People { get; } = [new() { Id = 1, Name = "관리자", Department = "개발", DepartmentId = 1, Role = "admin", Active = true, Access = true }, new() { Id = 2, Name = "담당자", Department = "개발", DepartmentId = 1, Active = true, Access = true }, new() { Id = 3, Name = "아티스트", Department = "아트", DepartmentId = 2, Active = true, Access = true }, new() { Id = 4, Name = "동료", Department = "개발", DepartmentId = 1, Active = true, Access = true }];
    public List<Department> Departments { get; } = [new() { Id=1, Name="개발" }, new() { Id=2, Name="아트" }, new() { Id=3, Name="기획" }];
    public List<Project> Projects { get; } = [new() { Id=10, Name="테스트 프로젝트" }];
    public List<Membership> Memberships { get; } = [];
    public List<DirectoryLead> Leads { get; } = [];
    public bool InvalidDirectory { get; set; }
    public bool DirectoryDown { get; set; }
    public bool LeaveDown { get; set; }
    public Microsoft.EntityFrameworkCore.Diagnostics.DbTransactionInterceptor? TransactionInterceptor { get; set; }
    public Absence[] LeaveRows { get; set; } = [];
    public CalendarHoliday[] Holidays { get; set; } = [];
    public string DataFolder { get; } = Path.Combine(Path.GetTempPath(), "schedule-tests", Guid.NewGuid().ToString("N"));
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("DataPath", DataFolder);
        builder.UseSetting("Sso:SharedSecret", Secret);
        builder.UseSetting("DemoMode", "false");
        builder.ConfigureServices(services =>
        {
            services.AddHttpClient("internal").ConfigurePrimaryHttpMessageHandler(() => new FakeInternal(this));
            if (TransactionInterceptor is { } interceptor) services.AddDbContext<ScheduleDb>(options => options.AddInterceptors(interceptor));
        });
    }
    public async Task<HttpClient> Login(long id = 1)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var token = Tokens.Sign(new { iss = "company-portal", aud = "schedule", sub = id.ToString(), sid = "test-session", accountType = "employee", permissions = new[] { "schedule.access" }, iat = now, exp = now + 60, jti = Guid.NewGuid().ToString("N") }, Secret);
        var response = await client.PostAsync("/auth/sso/callback", new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token }));
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var boot = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        var snapshots=Environment.GetEnvironmentVariable("WORKSPACE_UI_SNAPSHOTS");
        if (!string.IsNullOrEmpty(snapshots) && id == 1)
        {
            Directory.CreateDirectory(snapshots);
            await File.WriteAllTextAsync(Path.Combine(snapshots,"schedule-bootstrap.json"),boot.GetRawText());
            foreach(var name in new[]{"tasks","milestones","absences"})
                await File.WriteAllTextAsync(Path.Combine(snapshots,$"schedule-{name}.json"),await client.GetStringAsync("/api/"+name+(name is "milestones" or "absences"?"?from=2026-09-07&to=2026-09-11":"")));
        }
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", boot.GetProperty("csrfToken").GetString());
        return client;
    }
    private class FakeInternal(ScheduleFactory factory) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            if (request.RequestUri!.AbsolutePath == "/api/internal/workspace/session")
            {
                Tokens.Verify(request.Headers.Authorization!.Parameter!, Secret, "schedule", "workspace-session");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
            }
            var directory = request.RequestUri!.AbsolutePath.EndsWith("directory");
            Tokens.Verify(request.Headers.Authorization!.Parameter!, Secret, "company-schedule", directory ? "schedule-directory" : "schedule-absences");
            if (directory && factory.DirectoryDown || !directory && factory.LeaveDown) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = directory ? JsonContent.Create(new DirectorySnapshot(1, factory.People.ToArray(), factory.Departments.ToArray(), factory.Projects.ToArray(), factory.InvalidDirectory ? [new Membership { EmployeeId=9999,ProjectId=10 }] : factory.Memberships.ToArray(), factory.Leads.Where(l => factory.People.Any(e => e.Id == l.EmployeeId && e.DepartmentId == l.DepartmentId && e.Active && e.Access && !e.Shared)).ToArray())) : request.RequestUri.AbsolutePath.EndsWith("holidays") ? JsonContent.Create(new { holidays = factory.Holidays }) : JsonContent.Create(factory.LeaveRows) });
        }
    }
}

public class WorkflowTests
{
    [Fact] public async Task MineFiltersUseAuthenticatedEmployeeMembershipAndIdentity()
    {
        await using var f = new ScheduleFactory();
        f.Projects.Add(new Project { Id=20, Name="다른 프로젝트" });
        f.Memberships.Add(new Membership { EmployeeId=2, ProjectId=10 });
        using var admin = await f.Login(); using var member = await f.Login(2);
        var mine = await Create(admin, Input(2) with { ProjectId=10 });
        await Create(admin, Input(2) with { ProjectId=20 });
        await Create(admin, Input(3) with { ProjectId=10 });
        var projects = await member.GetFromJsonAsync<JsonElement>("/api/tasks?projectId=mine");
        Assert.Equal(2,projects.GetProperty("total").GetInt32());
        Assert.All(projects.GetProperty("items").EnumerateArray(),item=>Assert.Equal(10,item.GetProperty("projectId").GetInt64()));
        var personal = await member.GetFromJsonAsync<JsonElement>("/api/tasks?projectId=mine&assigneeId=me");
        Assert.Equal(1,personal.GetProperty("total").GetInt32()); Assert.Equal(mine.Id,personal.GetProperty("items")[0].GetProperty("id").GetInt64());
        Assert.Equal(HttpStatusCode.BadRequest,(await member.GetAsync("/api/tasks?projectId=unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await member.GetAsync("/api/tasks?assigneeId=unknown")).StatusCode);
    }

    [Fact] public async Task MilestoneHolidaysUseRegisteredCompanyDatesAndFailClosed()
    {
        await using var f = new ScheduleFactory();
        f.Holidays = [new CalendarHoliday(new DateOnly(2026, 10, 5), "개천절 대체공휴일")];
        using var anonymous = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/holidays?from=2026-10-01&to=2026-10-31")).StatusCode);
        using var client = await f.Login();
        var result = await client.GetFromJsonAsync<JsonElement>("/api/holidays?from=2026-10-01&to=2026-10-31");
        Assert.True(result.GetProperty("available").GetBoolean());
        Assert.Equal("2026-10-05", result.GetProperty("holidays")[0].GetProperty("date").GetString());
        f.LeaveDown = true;
        result = await client.GetFromJsonAsync<JsonElement>("/api/holidays?from=2026-10-01&to=2026-10-31");
        Assert.False(result.GetProperty("available").GetBoolean());
        Assert.Empty(result.GetProperty("holidays").EnumerateArray());
    }

    [Fact] public async Task PrivateDirectoryProtectsTasksMilestonesImagesAndNotifications()
    {
        await using var f = new ScheduleFactory();
        f.People.Add(new() { Id=5, Name="회사 마스터", Role="master", Active=true, Access=true });
        using var admin = await f.Login(); using var member = await f.Login(2);
        var publicTask = await Create(admin, Input(2) with { ProjectId=10 });
        var personalTask = await Create(admin, Input(4));
        var milestone = await admin.PostAsJsonAsync("/api/milestones", new MilestoneInput("비공개 마감", new(2026,9,8), 10, 0));
        milestone.EnsureSuccessStatusCode();
        var comment = await member.PostAsJsonAsync($"/api/tasks/{publicTask.Id}/comments", new CommentInput("보호할 댓글", null,0,[]));
        var commentId = (await comment.Content.ReadFromJsonAsync<Comment>())!.Id;
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=")), "file","private.png");
        var image = (await (await admin.PostAsync("/api/images",form)).Content.ReadFromJsonAsync<Attachment>())!;
        var imageTask = await Create(admin, Input(2, images:[image.Id]) with { ProjectId=10 });
        f.Projects[0].IsPrivate=true; f.People.Single(e=>e.Id==4).IsPrivate=true;
        // Existing sessions also pick up a privacy change on their next request.
        var refreshed = member;
        var boot = await refreshed.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Empty(boot.GetProperty("projects").EnumerateArray());
        Assert.DoesNotContain(boot.GetProperty("employees").EnumerateArray(), e=>e.GetProperty("id").GetInt64() is 4 or 5);
        Assert.Equal(0,(await refreshed.GetFromJsonAsync<JsonElement>("/api/tasks")).GetProperty("total").GetInt32());
        foreach (var id in new[]{publicTask.Id,personalTask.Id,imageTask.Id}) {
            Assert.Equal(HttpStatusCode.NotFound,(await refreshed.GetAsync($"/api/tasks/{id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await refreshed.PatchAsJsonAsync($"/api/tasks/{id}/status",new StatusInput("done",1))).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,(await refreshed.PostAsJsonAsync($"/api/tasks/{id}/comments",new CommentInput("차단",null,0,[]))).StatusCode);
            Assert.Equal(HttpStatusCode.OK,(await admin.GetAsync($"/api/tasks/{id}")).StatusCode);
        }
        Assert.Equal(HttpStatusCode.NotFound,(await refreshed.PutAsJsonAsync($"/api/comments/{commentId}",new CommentInput("차단",null,1,[]))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await refreshed.GetAsync($"/api/images/{image.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await refreshed.PostAsJsonAsync("/api/tasks",Input() with {ProjectId=10})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/tasks",Input(5))).StatusCode);
        Assert.Empty((await refreshed.GetFromJsonAsync<JsonElement>("/api/milestones?from=2026-09-01&to=2026-09-30")).EnumerateArray());
        Assert.Equal(0,(await refreshed.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
        var adminBoot = await admin.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Single(adminBoot.GetProperty("projects").EnumerateArray());
        Assert.Contains(adminBoot.GetProperty("employees").EnumerateArray(),e=>e.GetProperty("id").GetInt64()==4);
        Assert.DoesNotContain(adminBoot.GetProperty("employees").EnumerateArray(),e=>e.GetProperty("id").GetInt64()==5);
    }
    private static TaskInput Input(long assignee = 2, string body = "", DateOnly? from = null, DateOnly? to = null, string[]? images = null) => new("테스트 업무", body, assignee, null, from, to, "planned", 0, images);
    private static async Task<WorkItem> Create(HttpClient client, TaskInput? input = null)
    {
        var response = await client.PostAsJsonAsync("/api/tasks", input ?? Input());
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, text);
        return JsonSerializer.Deserialize<WorkItem>(text, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
    [Fact] public async Task UnscheduledTaskBecomesScheduledAndKeepsDiscussionAcrossStatusChanges()
    {
        await using var f = new ScheduleFactory(); using var admin = await f.Login(); using var member = await f.Login(2);
        var task = await Create(member); var comment = await member.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("논의 기록", null, 0, [])); comment.EnsureSuccessStatusCode();
        var from = new DateOnly(2026, 12, 31); var input = Input(body: "본문", from: from, to: from.AddDays(3)) with { Version = task.Version };
        (await member.PutAsJsonAsync($"/api/tasks/{task.Id}", input)).EnsureSuccessStatusCode();
        (await member.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("progress", 2))).EnsureSuccessStatusCode();
        var detail = await member.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");
        Assert.Equal(task.Id, detail.GetProperty("task").GetProperty("id").GetInt64()); Assert.Equal("progress", detail.GetProperty("task").GetProperty("status").GetString());
        Assert.Single(detail.GetProperty("comments").EnumerateArray());
        var week = await member.GetFromJsonAsync<JsonElement>("/api/tasks?from=2027-01-01&to=2027-01-07"); Assert.Equal(1, week.GetProperty("total").GetInt32());
        var undated = await member.GetFromJsonAsync<JsonElement>("/api/tasks?unscheduled=true"); Assert.Equal(0, undated.GetProperty("total").GetInt32());
    }
    [Fact] public async Task ServerEnforcesTeamPermissionsAndRevocation()
    {
        await using var f = new ScheduleFactory(); using var admin = await f.Login(); using var member = await f.Login(2); using var artist = await f.Login(3);
        (await member.PostAsJsonAsync("/api/tasks", Input(3))).EnsureSuccessStatusCode();
        f.Leads.Add(new DirectoryLead(1,2));
        var task = await Create(member, Input(4));
        Assert.Equal(HttpStatusCode.Forbidden, (await artist.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("done", task.Version))).StatusCode);
        f.People.Single(x => x.Id == 2).Department = "기획"; f.People.Single(x => x.Id == 2).DepartmentId = 3;
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("done", task.Version))).StatusCode);
        f.People.Single(x => x.Id == 2).Active = false;
        Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync("/api/tasks", Input())).StatusCode);
    }
    [Fact] public async Task ConcurrentEditsRejectStaleVersionAndRequireCsrf()
    {
        await using var f = new ScheduleFactory(); using var a = await f.Login(2); using var b = await f.Login(2); var task = await Create(a);
        var responses = await Task.WhenAll(a.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("progress", 1)), b.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("done", 1)));
        Assert.Single(responses, x => x.IsSuccessStatusCode); Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict);
        a.DefaultRequestHeaders.Remove("X-CSRF-TOKEN"); Assert.Equal(HttpStatusCode.Forbidden, (await a.PostAsJsonAsync("/api/tasks", Input())).StatusCode);
    }
    [Fact] public async Task ImagesRequireAuthenticationOwnershipAndValidatedFormat()
    {
        await using var f = new ScheduleFactory(); using var admin = await f.Login(); using var author = await f.Login(2); using var other = await f.Login(3);
        var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=");
        using var form = new MultipartFormDataContent(); form.Add(new ByteArrayContent(bytes), "file", "image.png");
        var upload = await author.PostAsync("/api/images", form); upload.EnsureSuccessStatusCode(); var image = await upload.Content.ReadFromJsonAsync<Attachment>();
        Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/images/{image!.Id}")).StatusCode);
        var stolen = await other.PostAsJsonAsync("/api/tasks", Input(3, images: [image!.Id])); Assert.Equal(HttpStatusCode.BadRequest, stolen.StatusCode);
        var task = await Create(author, Input(images: [image.Id])); Assert.Equal(HttpStatusCode.OK, (await other.GetAsync($"/api/images/{image.Id}")).StatusCode);
        using var anonymous = f.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/images/{image.Id}")).StatusCode);
        using var invalid = new MultipartFormDataContent(); invalid.Add(new StringContent("<svg onload='alert(1)'/>"), "file", "fake.png"); Assert.Equal(HttpStatusCode.BadRequest, (await author.PostAsync("/api/images", invalid)).StatusCode);
        using var oversized = new MultipartFormDataContent(); oversized.Add(new ByteArrayContent(new byte[10 * 1024 * 1024 + 1]), "file", "large.png"); Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await author.PostAsync("/api/images", oversized)).StatusCode);
    }
    [Fact] public async Task MentionsRepliesAndCommentEditsGenerateDeduplicatedNotifications()
    {
        await using var f = new ScheduleFactory(); using var author = await f.Login(2); using var other = await f.Login(3);
        var task = await Create(author); var response = await other.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("@[담당자](2) @[담당자](2) @[나](3)", null, 0, [])); response.EnsureSuccessStatusCode();
        var comment = (await response.Content.ReadFromJsonAsync<Comment>())!;
        var notices = await author.GetFromJsonAsync<JsonElement>("/api/notifications"); Assert.Equal(1, notices.GetProperty("unread").GetInt32());
        Assert.Equal(0, (await other.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
        (await other.PutAsJsonAsync($"/api/comments/{comment.Id}", new CommentInput("내용 수정 @[담당자](2)", null, 1, []))).EnsureSuccessStatusCode();
        Assert.Equal(1, (await author.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
        var replyResponse = await author.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("답글", comment.Id, 0, [])); replyResponse.EnsureSuccessStatusCode(); var reply = (await replyResponse.Content.ReadFromJsonAsync<Comment>())!;
        Assert.Equal(1, (await other.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await author.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("중첩", reply.Id, 0, []))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await author.PutAsJsonAsync($"/api/comments/{comment.Id}", new CommentInput("타인 수정", null, 2, []))).StatusCode);
        (await other.DeleteAsync($"/api/comments/{comment.Id}?version=2")).EnsureSuccessStatusCode();
        var detail = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}"); Assert.Equal(2, detail.GetProperty("comments").GetArrayLength()); Assert.True(detail.GetProperty("comments")[0].GetProperty("deleted").GetBoolean());
        (await author.PostAsync("/api/notifications/read-all", null)).EnsureSuccessStatusCode(); Assert.Equal(0, (await author.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
    }
    [Fact] public async Task CommentReviewReadsDoNotWriteAndFreshVersionsStillRequireExplicitAuthorSave()
    {
        await using var f = new ScheduleFactory(); using var assignee = await f.Login(2); using var author = await f.Login(3); using var admin = await f.Login();
        var task = await Create(assignee);
        var created = await author.PostAsJsonAsync($"/api/tasks/{task.Id}/comments",new CommentInput("@[담당자](2) 원본 9007199254740993",null,0,[]));created.EnsureSuccessStatusCode();
        var comment = (await created.Content.ReadFromJsonAsync<Comment>())!;
        var view = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");Assert.False(view.GetProperty("canEdit").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden,(await admin.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("관리자도 작성자가 아님",null,1,[]))).StatusCode);
        (await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("다른 탭 수정",null,1,[]))).EnsureSuccessStatusCode();
        var beforeRead = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");
        var reviewed = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");
        Assert.Equal(beforeRead.GetProperty("comments").GetRawText(),reviewed.GetProperty("comments").GetRawText());
        Assert.Equal(beforeRead.GetProperty("history").GetRawText(),reviewed.GetProperty("history").GetRawText());
        var version = reviewed.GetProperty("comments")[0].GetProperty("version").GetInt32();Assert.Equal(2,version);
        (await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("검토 이후 수정",null,version,[]))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict,(await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("아직 오래된 초안",null,version,[]))).StatusCode);
        var latest = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");Assert.Equal("검토 이후 수정",latest.GetProperty("comments")[0].GetProperty("body").GetString());
        var saved = await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("  @[담당자](2) 검토한 초안 9007199254740993  ",null,3,[]));saved.EnsureSuccessStatusCode();
        var acknowledged = (await saved.Content.ReadFromJsonAsync<Comment>())!;Assert.Equal(4,acknowledged.Version);Assert.Equal("@[담당자](2) 검토한 초안 9007199254740993",acknowledged.Body);Assert.Equal(3,acknowledged.AuthorId);
        (await author.DeleteAsync($"/api/comments/{comment.Id}?version=4")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict,(await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("삭제 후 초안",null,4,[]))).StatusCode);
        var deleted = await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");Assert.True(deleted.GetProperty("comments")[0].GetProperty("deleted").GetBoolean());
    }
    [Fact] public async Task ArchiveIsReadOnlyAndAdminCanRestore()
    {
        await using var f = new ScheduleFactory(); using var author = await f.Login(2); using var admin = await f.Login(); var task = await Create(author);
        (await author.PostAsJsonAsync($"/api/tasks/{task.Id}/archive", new VersionInput(1))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await author.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("comment", null, 0, []))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await author.PostAsJsonAsync($"/api/tasks/{task.Id}/restore", new VersionInput(2))).StatusCode);
        (await admin.PostAsJsonAsync($"/api/tasks/{task.Id}/restore", new VersionInput(2))).EnsureSuccessStatusCode();
        Assert.False((await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}")).GetProperty("task").GetProperty("archived").GetBoolean());
    }
    [Fact] public async Task ArchiveAcknowledgesExactTargetAndRejectsStaleOrUnauthorizedIntent()
    {
        await using var f = new ScheduleFactory();using var author=await f.Login(2);using var other=await f.Login(3);using var admin=await f.Login();
        var task=await Create(author,Input(body:"@[담당자](2) 원문 9007199254740993"));
        var comment=(await (await other.PostAsJsonAsync($"/api/tasks/{task.Id}/comments",new CommentInput("논의 유지",null,0,[]))).Content.ReadFromJsonAsync<Comment>())!;
        Assert.Equal(HttpStatusCode.Forbidden,(await other.PostAsJsonAsync($"/api/tasks/{task.Id}/archive",new VersionInput(1))).StatusCode);
        (await author.PatchAsJsonAsync($"/api/tasks/{task.Id}/status",new StatusInput("progress",1))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict,(await author.PostAsJsonAsync($"/api/tasks/{task.Id}/archive",new VersionInput(1))).StatusCode);
        var response=await author.PostAsJsonAsync($"/api/tasks/{task.Id}/archive",new VersionInput(2));response.EnsureSuccessStatusCode();
        var archived=(await response.Content.ReadFromJsonAsync<WorkItem>())!;
        Assert.Equal(task.Id,archived.Id);Assert.Equal(3,archived.Version);Assert.True(archived.Archived);Assert.Equal(task.Body,archived.Body);Assert.Equal(task.Title,archived.Title);Assert.Equal("progress",archived.Status);Assert.True(archived.UpdatedAt>=task.UpdatedAt);
        Assert.Equal(HttpStatusCode.Conflict,(await other.DeleteAsync($"/api/comments/{comment.Id}?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PostAsJsonAsync($"/api/tasks/{task.Id}/restore",new VersionInput(2))).StatusCode);
        var restored=(await (await admin.PostAsJsonAsync($"/api/tasks/{task.Id}/restore",new VersionInput(3))).Content.ReadFromJsonAsync<WorkItem>())!;
        Assert.Equal(task.Id,restored.Id);Assert.Equal(4,restored.Version);Assert.False(restored.Archived);Assert.Equal(task.Body,restored.Body);
        var detail=await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");Assert.Equal("논의 유지",detail.GetProperty("comments")[0].GetProperty("body").GetString());
        Assert.Contains(detail.GetProperty("history").EnumerateArray(),h=>h.GetProperty("action").GetString()=="업무 보관");Assert.Contains(detail.GetProperty("history").EnumerateArray(),h=>h.GetProperty("action").GetString()=="업무 복원");
        f.People.Single(e=>e.Id==2).Access=false;
        Assert.Equal(HttpStatusCode.Forbidden,(await author.PostAsJsonAsync($"/api/tasks/{task.Id}/archive",new VersionInput(4))).StatusCode);
    }
    [Fact] public async Task CommentDeletionRequiresCurrentVersionAndDetachesOnlyItsImagesKeepingRepliesAndAudit()
    {
        await using var f=new ScheduleFactory();using var owner=await f.Login(2);using var author=await f.Login(3);using var admin=await f.Login();var task=await Create(owner);
        using var form=new MultipartFormDataContent();form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=")),"file","comment.png");
        var image=(await (await author.PostAsync("/api/images",form)).Content.ReadFromJsonAsync<Attachment>())!;
        var comment=(await (await author.PostAsJsonAsync($"/api/tasks/{task.Id}/comments",new CommentInput("삭제 대상",null,0,[image.Id]))).Content.ReadFromJsonAsync<Comment>())!;
        var reply=(await (await owner.PostAsJsonAsync($"/api/tasks/{task.Id}/comments",new CommentInput("유지할 답글",comment.Id,0,[]))).Content.ReadFromJsonAsync<Comment>())!;
        Assert.Equal(HttpStatusCode.Forbidden,(await owner.DeleteAsync($"/api/comments/{comment.Id}?version=1")).StatusCode);
        (await author.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("새 내용",null,1,[image.Id]))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict,(await admin.DeleteAsync($"/api/comments/{comment.Id}?version=1")).StatusCode);
        var deleted=await admin.DeleteAsync($"/api/comments/{comment.Id}?version=2");Assert.Equal(HttpStatusCode.NoContent,deleted.StatusCode);Assert.Empty(await deleted.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict,(await admin.DeleteAsync($"/api/comments/{comment.Id}?version=2")).StatusCode);
        var detail=await owner.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");var comments=detail.GetProperty("comments").EnumerateArray().ToArray();
        var parent=Assert.Single(comments,c=>c.GetProperty("id").GetInt64()==comment.Id);Assert.True(parent.GetProperty("deleted").GetBoolean());Assert.Equal("",parent.GetProperty("body").GetString());Assert.Equal(3,parent.GetProperty("version").GetInt32());
        Assert.Contains(comments,c=>c.GetProperty("id").GetInt64()==reply.Id&&c.GetProperty("body").GetString()=="유지할 답글");Assert.Empty(detail.GetProperty("attachments").EnumerateArray());Assert.Contains(detail.GetProperty("history").EnumerateArray(),h=>h.GetProperty("action").GetString()=="댓글 삭제");
        using var scope=f.Services.CreateScope();var detached=await scope.ServiceProvider.GetRequiredService<ScheduleDb>().Attachments.SingleAsync(a=>a.Id==image.Id);Assert.Null(detached.TaskId);Assert.Null(detached.CommentId);
    }
    [Fact] public async Task IntegrationFailurePreservesTasksAndWritesFailClosed()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(); var task = await Create(client); f.LeaveDown = true;
        var absence = await client.GetFromJsonAsync<JsonElement>("/api/absences?from=2026-09-01&to=2026-09-07"); Assert.False(absence.GetProperty("available").GetBoolean());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/tasks/{task.Id}")).StatusCode);
        f.DirectoryDown = true; Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/tasks", Input())).StatusCode);
    }
    [Fact] public async Task FiftyEmployeesAndThousandTasksSupportFiltersPaginationAndPersistence()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login();
        for (var i = 5; i <= 50; i++) f.People.Add(new() { Id = i, Name = $"직원 {i}", Department = i % 2 == 0 ? "개발" : "아트", Active = true, Access = true });
        await Create(client);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            for (var i = 0; i < 1000; i++) db.Tasks.Add(new() { Title = $"업무 {i}", AssigneeId = i % 50 + 1, CreatedBy = 1, StartDate = new(2026, 9, 7), EndDate = new(2026, 9, 11), Status = i % 3 == 0 ? "done" : "planned" });
            await db.SaveChangesAsync();
        }
        var first = await client.GetFromJsonAsync<JsonElement>("/api/tasks?from=2026-09-07&to=2026-09-13&take=200"); Assert.Equal(1000, first.GetProperty("total").GetInt32()); Assert.Equal(200, first.GetProperty("items").GetArrayLength());
        var second = await client.GetFromJsonAsync<JsonElement>("/api/tasks?from=2026-09-07&to=2026-09-13&take=200&skip=200");
        Assert.NotEqual(first.GetProperty("items")[0].GetProperty("id").GetInt64(), second.GetProperty("items")[0].GetProperty("id").GetInt64());
        var person = await client.GetFromJsonAsync<JsonElement>("/api/tasks?assigneeId=50"); Assert.Equal(20, person.GetProperty("total").GetInt32());
        await using var reopened = new ScheduleDb(new DbContextOptionsBuilder<ScheduleDb>().UseSqlite($"Data Source={Path.Combine(f.DataFolder, "schedule.db")}").Options); Assert.Equal(1001, await reopened.Tasks.CountAsync());
    }
    [Fact] public void TokensRejectWrongAudienceExpiredAndTamperedPayloads()
    {
        var good = Tokens.Service("schedule-directory", ScheduleFactory.Secret); Assert.Equal("schedule", Tokens.Verify(good, ScheduleFactory.Secret, "company-schedule", "schedule-directory").GetProperty("sub").GetString());
        Assert.Throws<ApiError>(() => Tokens.Verify(good, ScheduleFactory.Secret, "company-schedule", "schedule-absences"));
        Assert.Throws<ApiError>(() => Tokens.Verify(good + "X", ScheduleFactory.Secret, "company-schedule", "schedule-directory"));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); var expired = Tokens.Sign(new { iss = "company-schedule", aud = "schedule-directory", sub = "schedule", iat = now - 120, exp = now - 60, jti = "old" }, ScheduleFactory.Secret);
        Assert.Throws<ApiError>(() => Tokens.Verify(expired, ScheduleFactory.Secret, "company-schedule", "schedule-directory"));
    }
    [Fact] public async Task PortalOwnsCatalogAndMembershipDoesNotRestrictTaskAssignment()
    {
        await using var f=new ScheduleFactory(); using var client=await f.Login(2);
        f.Memberships.Add(new() { EmployeeId=3,ProjectId=10 });
        var input=Input() with { ProjectId=10 }; var task=await Create(client,input);
        var boot=await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Empty(boot.GetProperty("employees").EnumerateArray().Single(e=>e.GetProperty("id").GetInt64()==2).GetProperty("projectIds").EnumerateArray());
        Assert.Equal(HttpStatusCode.Gone,(await client.PostAsJsonAsync("/api/projects",new ProjectInput("禁止","#112233",false,0))).StatusCode);
        Assert.Equal(HttpStatusCode.Gone,(await client.PostAsJsonAsync("/api/leads",new LeadInput("개발",2))).StatusCode);
        f.Projects.Single().Archived=true;
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/tasks",input)).StatusCode);
        (await client.PutAsJsonAsync($"/api/tasks/{task.Id}",input with { Version=task.Version,Body="기존 연결 유지" })).EnsureSuccessStatusCode();
    }
    [Fact] public async Task InvalidDirectoryCannotPartiallyRenameOrChangePermissions()
    {
        await using var f=new ScheduleFactory(); using var client=await f.Login(2);
        f.People.Single(e=>e.Id==2).Name="변경되면 안 됨"; f.Departments[0].Name="변경 부서"; f.InvalidDirectory=true;
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/tasks",Input())).StatusCode);
        using var scope=f.Services.CreateScope(); var db=scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Equal("담당자",(await db.Employees.FindAsync(2L))!.Name); Assert.Equal("개발",(await db.Departments.FindAsync(1L))!.Name);
        f.InvalidDirectory=false; f.Leads.Add(new(1,2)); await Create(client,Input(4));
        Assert.Equal("변경 부서",(await client.GetFromJsonAsync<JsonElement>("/api/bootstrap")).GetProperty("me").GetProperty("department").GetString());
    }
}
