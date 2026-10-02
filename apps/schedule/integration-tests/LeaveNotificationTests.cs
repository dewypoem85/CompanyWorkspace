using System.Net;
using System.Net.Http.Json;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    const string NotificationMedia = "application/vnd.company.workspace-form+json";
    const long NoticeOne = 9007199254740993, NoticeTwo = 9007199254740995, ForeignNotice = 9007199254740997;
    sealed class NotificationSetup : IAsyncDisposable
    {
        public ContractFactory<CompanyUser> Portal { get; } = new();
        public LeaveFactory Leave { get; private set; } = null!;
        public HttpClient PortalClient { get; private set; } = null!;
        public HttpClient Client { get; private set; } = null!;
        public long EmployeeId { get; private set; }
        public long CompanyUserId { get; private set; }
        public static async Task<NotificationSetup> Create()
        {
            var setup = new NotificationSetup(); setup.PortalClient = setup.Portal.CreateClient(Options);
            setup.Leave = new LeaveFactory(setup.Portal); setup.Client = setup.Leave.CreateClient(Options);
            var user = await Connect(setup.Portal, setup.PortalClient, setup.Client, "employee");
            setup.CompanyUserId = user!.Id;
            using var scope = setup.Leave.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            setup.EmployeeId = (await db.Employees.SingleAsync(e=>e.CompanyUserId == user!.Id)).Id;
            var other = new Employee {Name="다른 직원",Email="other-notice@example.test",HireDate=new(2025,1,1)};
            db.Employees.Add(other);await db.SaveChangesAsync();
            db.AppNotifications.AddRange(
                new(){Id=NoticeOne,RecipientEmployeeId=setup.EmployeeId,Type="LeaveRequestApproved",Title="연차 승인 검증",Message="긴 알림 본문 <script>window.injected=true</script>와 모바일 줄바꿈을 검증합니다.",Link="/Leave/Usage?Year=2026"},
                new(){Id=NoticeTwo,RecipientEmployeeId=setup.EmployeeId,Type="LeaveCancelRequested",Title="취소 요청 검증",Message="취소 요청 상태를 확인해 주세요.",Link="/Leave"},
                new(){Id=ForeignNotice,RecipientEmployeeId=other.Id,Type="LeaveRequestApproved",Title="다른 직원 비공개",Message="노출하지 않는 알림"});
            await db.SaveChangesAsync();return setup;
        }
        public async Task<HttpResponseMessage> Post(string action, string? id=null, bool token=true, bool ajax=true, string? expectedOwner="current")
        {
            var fields = new Dictionary<string,string>();if(id is not null) fields["id"] = id;
            if(expectedOwner is not null) fields["expectedEmployeeId"] = expectedOwner == "current" ? EmployeeId.ToString(CultureInfo.InvariantCulture) : expectedOwner;
            if (token) {
                var html = await Client.GetStringAsync("/Notifications");
                var value = Regex.Match(html,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value;
                Assert.NotEmpty(value);fields["__RequestVerificationToken"] = WebUtility.HtmlDecode(value);
            }
            using var request = new HttpRequestMessage(HttpMethod.Post,"/Notifications?handler="+action) {Content=new FormUrlEncodedContent(fields)};
            if(ajax){request.Headers.Add("Accept",NotificationMedia);request.Headers.Add("X-Requested-With","XMLHttpRequest");}
            return await Client.SendAsync(request);
        }
        public async Task<AppNotification> Stored(long id) {
            using var scope=Leave.Services.CreateScope();return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().AppNotifications.AsNoTracking().SingleAsync(x=>x.Id==id);
        }
        public async ValueTask DisposeAsync() { Client.Dispose();PortalClient.Dispose();await Leave.DisposeAsync();await Portal.DisposeAsync(); }
    }
    static async Task<JsonElement> NotificationReceipt(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();Assert.Equal(NotificationMedia,response.Content.Headers.ContentType!.MediaType);Assert.True(response.Headers.CacheControl!.NoStore);
        var result=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("workspace-form-v1",result.GetProperty("protocol").GetString());Assert.Equal("saved",result.GetProperty("outcome").GetString());return result;
    }

    [Fact]
    public async Task NotificationFormsUseOwnedStringIdReceiptsAndNativeCompatibility()
    {
        await using var setup=await NotificationSetup.Create();
        var initial=await setup.Client.GetStringAsync("/Notifications");Assert.Contains("data-notification-id=\""+NoticeOne+"\"",initial);Assert.DoesNotContain("다른 직원 비공개",WebUtility.HtmlDecode(initial));
        var read=await NotificationReceipt(await setup.Post("MarkRead",NoticeOne.ToString(CultureInfo.InvariantCulture)));
        Assert.Equal(NoticeOne.ToString(CultureInfo.InvariantCulture),read.GetProperty("data").GetProperty("id").GetString());
        Assert.Equal(setup.EmployeeId.ToString(CultureInfo.InvariantCulture),read.GetProperty("data").GetProperty("employeeId").GetString());
        var first=await setup.Stored(NoticeOne);Assert.True(first.IsRead);Assert.NotNull(first.ReadAtUtc);
        await NotificationReceipt(await setup.Post("MarkRead",NoticeOne.ToString(CultureInfo.InvariantCulture)));Assert.Equal(first.ReadAtUtc,(await setup.Stored(NoticeOne)).ReadAtUtc);
        var opened=await NotificationReceipt(await setup.Post("Open",NoticeTwo.ToString(CultureInfo.InvariantCulture)));Assert.Equal("/Leave",opened.GetProperty("data").GetProperty("navigateTo").GetString());
        var all=await NotificationReceipt(await setup.Post("MarkAllRead"));Assert.Equal(JsonValueKind.Null,all.GetProperty("data").GetProperty("id").ValueKind);
        Assert.False((await setup.Stored(ForeignNotice)).IsRead);
        using var native=await setup.Post("MarkRead",NoticeOne.ToString(CultureInfo.InvariantCulture),ajax:false,expectedOwner:null);Assert.Equal(HttpStatusCode.Redirect,native.StatusCode);
        using var legacy=await setup.Client.GetAsync("/Notifications?handler=Open&id="+NoticeOne);Assert.Equal(HttpStatusCode.Redirect,legacy.StatusCode);Assert.Equal("/Leave/Usage?Year=2026",legacy.Headers.Location!.OriginalString);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(output)) {
            Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,"leave.notifications.fixture.html"),initial);
            var context=await setup.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context");var navigation=await setup.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation");
            await File.WriteAllTextAsync(Path.Combine(output,"leave.notifications.fixture.json"),JsonSerializer.Serialize(new {context,navigation,read,opened,all}));
        }
    }
    [Fact]
    public async Task NotificationWritesRejectForeignInvalidAndCsrfRequestsWithoutChangingData()
    {
        await using var setup=await NotificationSetup.Create();
        foreach(var action in new[]{"MarkRead","Open"}) foreach(var id in new[]{ForeignNotice.ToString(),"0","-1","9223372036854775808","not-an-id"}) {
            using var response=await setup.Post(action,id);Assert.Equal(HttpStatusCode.UnprocessableEntity,response.StatusCode);Assert.Equal("invalid",(await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("outcome").GetString());
        }
        using var csrf=await setup.Post("MarkRead",NoticeOne.ToString(),token:false);Assert.Equal(HttpStatusCode.BadRequest,csrf.StatusCode);
        foreach(var action in new[]{"MarkRead","MarkAllRead","Open"}) foreach(var owner in new string?[]{null,"2","0","invalid","9223372036854775808"}) {
            using var stale=await setup.Post(action,action=="MarkAllRead"?null:NoticeOne.ToString(),expectedOwner:owner);Assert.Equal(HttpStatusCode.UnprocessableEntity,stale.StatusCode);
        }
        using var staleNative=await setup.Post("MarkAllRead",ajax:false,expectedOwner:"2");Assert.Equal(HttpStatusCode.Redirect,staleNative.StatusCode);
        Assert.False((await setup.Stored(NoticeOne)).IsRead);Assert.False((await setup.Stored(ForeignNotice)).IsRead);
    }
    [Fact]
    public async Task NotificationAllReadIncludesOlderOwnedItemsOutsideVisiblePage()
    {
        await using var setup=await NotificationSetup.Create();
        using(var scope=setup.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.AppNotifications.SingleAsync(n=>n.Id==NoticeOne)).CreatedAtUtc=DateTime.UtcNow.AddYears(-1);
            (await db.AppNotifications.SingleAsync(n=>n.Id==NoticeTwo)).IsRead=true;
            for(var i=0;i<121;i++)db.AppNotifications.Add(new(){RecipientEmployeeId=setup.EmployeeId,Type="test",Title="이미 읽은 알림",Message="검증",IsRead=true});await db.SaveChangesAsync();
        }
        var html=await setup.Client.GetStringAsync("/Notifications");Assert.Contains("data-notification-action=\"MarkAllRead\"",html);Assert.DoesNotContain("data-notification-id=\""+NoticeOne+"\"",html);
        await NotificationReceipt(await setup.Post("MarkAllRead"));Assert.True((await setup.Stored(NoticeOne)).IsRead);Assert.False((await setup.Stored(ForeignNotice)).IsRead);
    }
    [Fact]
    public async Task NotificationFailedPersistenceNeverReturnsSavedAcknowledgement()
    {
        await using var setup=await NotificationSetup.Create();
        using(var scope=setup.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER reject_notification_update BEFORE UPDATE ON AppNotifications BEGIN SELECT RAISE(ABORT, 'isolated-write-failure'); END;");
        }
        using var response=await setup.Post("MarkRead",NoticeOne.ToString());Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);Assert.NotEqual(NotificationMedia,response.Content.Headers.ContentType?.MediaType);Assert.False((await setup.Stored(NoticeOne)).IsRead);
    }
    [Fact]
    public async Task NotificationResponseNeverNavigatesToAnExternalStoredLink()
    {
        await using var setup=await NotificationSetup.Create();
        using(var scope=setup.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();(await db.AppNotifications.SingleAsync(n=>n.Id==NoticeOne)).Link="https://external.invalid/";await db.SaveChangesAsync();
        }
        var result=await NotificationReceipt(await setup.Post("Open",NoticeOne.ToString()));Assert.Equal("/Notifications/Index",result.GetProperty("data").GetProperty("navigateTo").GetString());Assert.True((await setup.Stored(NoticeOne)).IsRead);
    }
    [Fact]
    public async Task NotificationWritesRetainCentralSessionFailureAndRevocationChecks()
    {
        await using var setup=await NotificationSetup.Create();setup.Leave.ConnectionFailure=HttpStatusCode.ServiceUnavailable;
        using(var response=await setup.Post("MarkAllRead",token:false))Assert.Equal(HttpStatusCode.ServiceUnavailable,response.StatusCode);
        setup.Leave.ConnectionFailure=null;
        using(var scope=setup.Portal.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();(await db.Users.SingleAsync(u=>u.Id==setup.CompanyUserId)).IsActive=false;await db.SaveChangesAsync();
        }
        using(var response=await setup.Post("MarkAllRead",token:false))Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
        using(var scope=setup.Portal.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceSessions SET Revoked=1 WHERE UserId={setup.CompanyUserId}");
        }
        using(var response=await setup.Post("MarkAllRead",token:false))Assert.Equal(HttpStatusCode.Unauthorized,response.StatusCode);
        Assert.False((await setup.Stored(NoticeOne)).IsRead);Assert.False((await setup.Stored(ForeignNotice)).IsRead);
    }
}
