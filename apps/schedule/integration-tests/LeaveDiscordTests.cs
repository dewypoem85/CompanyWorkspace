using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    sealed class DiscordFactory(ContractFactory<CompanyUser> portal) : LeaveFactory(portal)
    {
        public bool FailMessages { get; set; }
        public List<string> DiscordPaths { get; }=[];
        protected override void ConfigureWebHost(IWebHostBuilder builder) {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Discord:ClientId","isolated-client");builder.UseSetting("Discord:ClientSecret","isolated-secret");
            builder.UseSetting("Discord:BotToken","isolated-bot");builder.UseSetting("Discord:OAuthRedirectUri","https://leave.workspace.test/Auth/DiscordCallback");
            builder.ConfigureServices(services=>services.AddHttpClient(string.Empty).ConfigurePrimaryHttpMessageHandler(()=>new DiscordRelay(this)));
        }
    }
    sealed class DiscordRelay(DiscordFactory owner) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token) {
            Assert.Equal("discord.com",request.RequestUri!.Host);Assert.Equal(HttpMethod.Post,request.Method);
            var path=request.RequestUri.AbsolutePath;owner.DiscordPaths.Add(path);
            Assert.Contains(path,new[]{"/api/v10/users/@me/channels","/api/v10/channels/fixture-channel/messages"});
            return Task.FromResult(new HttpResponseMessage(owner.FailMessages&&path.EndsWith("/messages")?HttpStatusCode.BadGateway:HttpStatusCode.OK) {
                Content=JsonContent.Create(new {id=path.EndsWith("/channels")?"fixture-channel":"fixture-message"})});
        }
    }
    sealed class DiscordSetup : IAsyncDisposable
    {
        public ContractFactory<CompanyUser> Portal {get;}=new();
        public DiscordFactory Leave {get;private set;}=null!;
        public HttpClient PortalClient {get;private set;}=null!;
        public HttpClient Client {get;private set;}=null!;
        public long EmployeeId {get;private set;}
        public long CompanyUserId {get;private set;}
        public static async Task<DiscordSetup> Create(string role="employee",bool linked=true) {
            var s=new DiscordSetup();s.PortalClient=s.Portal.CreateClient(Options);s.Leave=new DiscordFactory(s.Portal);s.Client=s.Leave.CreateClient(Options);
            var user=await Connect(s.Portal,s.PortalClient,s.Client,role);s.CompanyUserId=user!.Id;
            using var scope=s.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var employee=await db.Employees.SingleAsync(e=>e.CompanyUserId==user.Id);s.EmployeeId=employee.Id;
            employee.DiscordUserId=linked?"9007199254740993":null;employee.DiscordUsername=linked?"검증 Discord <script>window.injected=true</script>":null;
            employee.DiscordLinkedAtUtc=linked?new DateTime(2026,9,1,0,0,0,DateTimeKind.Utc):null;
            employee.DiscordDmEnabled=linked;employee.DiscordDmNotificationTypes=linked?"LeaveRequestApproved":null;
            db.Employees.Add(new(){Name="다른 직원",Email="discord-other@example.test",HireDate=new(2025,1,1),DiscordUserId="9007199254740995",DiscordDmEnabled=true});
            await db.SaveChangesAsync();return s;
        }
        public async Task<Employee> Stored() {
            using var scope=Leave.Services.CreateScope();return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Employees.AsNoTracking().SingleAsync(e=>e.Id==EmployeeId);
        }
        public async Task<HttpResponseMessage> Post(string action,bool enabled=true,string[]? selected=null,bool csrf=true,bool enhanced=true,string? owner="current",string? state="current") {
            var html=await Client.GetStringAsync("/Settings/Discord");
            string Field(string name)=>WebUtility.HtmlDecode(Regex.Match(html,"name=\""+name+"\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);
            var fields=new List<KeyValuePair<string,string>>();
            if(csrf){Assert.NotEmpty(Field("__RequestVerificationToken"));fields.Add(new("__RequestVerificationToken",Field("__RequestVerificationToken")));}
            if(owner is not null)fields.Add(new("expectedEmployeeId",owner=="current"?Field("expectedEmployeeId"):owner));
            if(state is not null)fields.Add(new("expectedStateToken",state=="current"?Field("expectedStateToken"):state));
            fields.Add(new("discordDmEnabled",enabled?"true":"false"));fields.Add(new("discordDmEnabled","false"));
            foreach(var type in selected??["LeaveRequestRejected"])fields.Add(new("selectedTypes",type));
            using var request=new HttpRequestMessage(HttpMethod.Post,"/Settings/Discord?handler="+action){Content=new FormUrlEncodedContent(fields)};
            if(enhanced){request.Headers.Add("Accept",NotificationMedia);request.Headers.Add("X-Requested-With","XMLHttpRequest");}
            return await Client.SendAsync(request);
        }
        public async ValueTask DisposeAsync(){Client.Dispose();PortalClient.Dispose();await Leave.DisposeAsync();await Portal.DisposeAsync();}
    }

    [Theory]
    [InlineData("employee")]
    [InlineData("admin")]
    public async Task DiscordFormsPreserveCatalogAndConfirmActualSaveTestAndUnlink(string role) {
        await using var s=await DiscordSetup.Create(role);var initial=await s.Client.GetStringAsync("/Settings/Discord");
        Assert.DoesNotContain("<script>window.injected=true</script>",initial);Assert.DoesNotContain("onsubmit=\"return confirm",initial);
        var initialTest=await NotificationReceipt(await s.Post("Test"));
        var save=await NotificationReceipt(await s.Post("Save",selected:["LeaveRequestRejected"]));
        Assert.Equal("LeaveRequestRejected",(await s.Stored()).DiscordDmNotificationTypes);
        Assert.Equal("9007199254740993",save.GetProperty("data").GetProperty("snapshot").GetProperty("discordUserId").GetString());
        var test=await NotificationReceipt(await s.Post("Test"));Assert.Equal(4,s.Leave.DiscordPaths.Count);
        var unlink=await NotificationReceipt(await s.Post("Unlink"));var stored=await s.Stored();Assert.Null(stored.DiscordUserId);Assert.Null(stored.DiscordUsername);Assert.Null(stored.DiscordLinkedAtUtc);Assert.False(stored.DiscordDmEnabled);Assert.Null(stored.DiscordDmNotificationTypes);
        using(var scope=s.Leave.Services.CreateScope())Assert.True(await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Employees.AnyAsync(e=>e.Email=="discord-other@example.test"&&e.DiscordDmEnabled));
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(!string.IsNullOrEmpty(output)) {
            Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,$"leave.discord.{role}.fixture.html"),initial);
            await File.WriteAllTextAsync(Path.Combine(output,$"leave.discord.{role}.unlinked.fixture.html"),await s.Client.GetStringAsync("/Settings/Discord"));
            var context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context");var navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation");
            await File.WriteAllTextAsync(Path.Combine(output,$"leave.discord.{role}.fixture.json"),JsonSerializer.Serialize(new{context,navigation,save,test,initialTest,unlink}));
        }
    }
    [Fact]
    public async Task DiscordNormalizationAndNativeOAuthCompatibilityRemainServerOwned() {
        await using var s=await DiscordSetup.Create();
        await NotificationReceipt(await s.Post("Save",selected:["LeaveRequestCreated","LeaveRequestRejected","LeaveRequestRejected","unknown"]));Assert.Equal("LeaveRequestRejected",(await s.Stored()).DiscordDmNotificationTypes);
        using var native=await s.Post("Save",enabled:false,enhanced:false,owner:null,state:null);Assert.Equal(HttpStatusCode.Redirect,native.StatusCode);Assert.False((await s.Stored()).DiscordDmEnabled);
        using var link=await s.Post("Link",enhanced:false);Assert.Equal(HttpStatusCode.Redirect,link.StatusCode);Assert.Equal("discord.com",link.Headers.Location!.Host);Assert.Contains("response_type=code",link.Headers.Location.Query);
        Assert.Contains(link.Headers.GetValues("Set-Cookie"),cookie=>cookie.Contains("LeaveManager.DiscordOAuthState=")&&cookie.Contains("httponly",StringComparison.OrdinalIgnoreCase));Assert.Empty(s.Leave.DiscordPaths);
    }
    [Fact]
    public async Task DiscordStaleOwnerStateAndCsrfNeverWriteOrSend() {
        await using var s=await DiscordSetup.Create();var before=await s.Stored();
        foreach(var action in new[]{"Save","Unlink","Test","Link"}) {
            using var missing=await s.Post(action,owner:null,state:null);Assert.Equal(HttpStatusCode.Conflict,missing.StatusCode);
            using var owner=await s.Post(action,owner:"2");Assert.Equal(HttpStatusCode.Conflict,owner.StatusCode);
            using var token=await s.Post(action,state:new string('0',64));Assert.Equal(HttpStatusCode.Conflict,token.StatusCode);
            using var csrf=await s.Post(action,csrf:false);Assert.Equal(HttpStatusCode.BadRequest,csrf.StatusCode);
        }
        var after=await s.Stored();Assert.Equal(before.DiscordUserId,after.DiscordUserId);Assert.Equal(before.DiscordDmNotificationTypes,after.DiscordDmNotificationTypes);Assert.Empty(s.Leave.DiscordPaths);
        s.Leave.ConnectionFailure=HttpStatusCode.ServiceUnavailable;
        using var denied=await s.Client.PostAsync("/Settings/Discord?handler=Unlink",new FormUrlEncodedContent([]));Assert.Equal(HttpStatusCode.ServiceUnavailable,denied.StatusCode);
    }
    [Fact]
    public async Task DiscordPersistenceAndDeliveryFailuresAreNotSavedReceipts() {
        await using var s=await DiscordSetup.Create();s.Leave.FailMessages=true;
        using var test=await s.Post("Test");Assert.Equal(HttpStatusCode.BadGateway,test.StatusCode);Assert.Equal("unknown",(await test.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("outcome").GetString());Assert.Equal(2,s.Leave.DiscordPaths.Count);
        using(var scope=s.Leave.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER reject_discord_update BEFORE UPDATE OF DiscordDmEnabled, DiscordUserId ON Employees BEGIN SELECT RAISE(ABORT, 'isolated-write-failure'); END;");
        foreach(var action in new[]{"Save","Unlink"}){using var result=await s.Post(action,enabled:false);Assert.Equal(HttpStatusCode.InternalServerError,result.StatusCode);Assert.NotEqual(NotificationMedia,result.Content.Headers.ContentType?.MediaType);}
        Assert.Equal("9007199254740993",(await s.Stored()).DiscordUserId);Assert.True((await s.Stored()).DiscordDmEnabled);
    }
    [Fact]
    public async Task DiscordRelinkAfterRenderingRejectsOldSaveUnlinkAndTest() {
        await using var s=await DiscordSetup.Create();var html=await s.Client.GetStringAsync("/Settings/Discord");
        var oldToken=Regex.Match(html,"name=\"expectedStateToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value;Assert.Equal(64,oldToken.Length);
        using(var scope=s.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var employee=await db.Employees.SingleAsync(e=>e.Id==s.EmployeeId);
            employee.DiscordUserId="9007199254740999";employee.DiscordUsername="새 연결";await db.SaveChangesAsync();
        }
        foreach(var action in new[]{"Save","Unlink","Test","Link"}) {using var response=await s.Post(action,state:oldToken);Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);}
        Assert.Equal("9007199254740999",(await s.Stored()).DiscordUserId);Assert.Equal("LeaveRequestApproved",(await s.Stored()).DiscordDmNotificationTypes);Assert.Empty(s.Leave.DiscordPaths);
    }
}
