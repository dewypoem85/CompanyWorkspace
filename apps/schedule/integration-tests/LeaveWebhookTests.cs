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
    const string WebhookOne="https://discord.com/api/webhooks/123456789/synthetic-one-token-xxxxxxxx";
    const string WebhookTwo="https://discord.com/api/webhooks/987654321/synthetic-two-token-xxxxxxxx";
    sealed class WebhookFactory(ContractFactory<CompanyUser> portal):LeaveFactory(portal){
        public bool FailSecond {get;set;}
        public List<string> Sent {get;}=[];
        protected override void ConfigureWebHost(IWebHostBuilder builder){base.ConfigureWebHost(builder);builder.ConfigureServices(services=>services.AddHttpClient(string.Empty).ConfigurePrimaryHttpMessageHandler(()=>new WebhookRelay(this)));}
    }
    sealed class WebhookRelay(WebhookFactory owner):HttpMessageHandler{
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){
            Assert.Equal(HttpMethod.Post,request.Method);Assert.Contains(request.RequestUri!.ToString(),new[]{WebhookOne,WebhookTwo});owner.Sent.Add(request.RequestUri.ToString());
            return Task.FromResult(new HttpResponseMessage(owner.FailSecond&&request.RequestUri.ToString()==WebhookTwo?HttpStatusCode.BadGateway:HttpStatusCode.NoContent){Content=new StringContent("private-webhook-canary")});
        }
    }
    sealed class WebhookSetup:IAsyncDisposable{
        public ContractFactory<CompanyUser> Portal {get;}=new();
        public WebhookFactory Leave {get;private set;}=null!;
        public HttpClient Client {get;private set;}=null!;
        public HttpClient PortalClient {get;private set;}=null!;
        public static async Task<WebhookSetup> Create(){
            var s=new WebhookSetup();s.PortalClient=s.Portal.CreateClient(Options);s.Leave=new(s.Portal);s.Client=s.Leave.CreateClient(Options);
            await Connect(s.Portal,s.PortalClient,s.Client,"admin");
            using var scope=s.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            db.DiscordWebhooks.Add(new(){Id=9007199254740993,Url=WebhookOne,Memo="검증 채널 <script>bad()</script>",CreatedAtUtc=new(2026,9,1,0,0,0,DateTimeKind.Utc)});await db.SaveChangesAsync();return s;
        }
        public async Task<HttpResponseMessage> Post(string operation,Dictionary<string,string>? values=null,bool csrf=true,bool enhanced=true){
            var html=await Client.GetStringAsync("/Admin/NotificationSettings");var snapshot=JsonDocument.Parse(Regex.Match(html,"data-webhook-snapshot>(.*?)</script>",RegexOptions.Singleline).Groups[1].Value).RootElement;
            var data=new Dictionary<string,string>{{"expectedEmployeeId",snapshot.GetProperty("actorEmployeeId").GetString()!},{"expectedStateToken",snapshot.GetProperty("stateToken").GetString()!},{"WebhookUrl",WebhookTwo},{"Memo","추가 채널"},{"id","9007199254740993"}};
            if(csrf)data["__RequestVerificationToken"]=WebUtility.HtmlDecode(Regex.Match(html,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
            if(values is not null)foreach(var item in values)data[item.Key]=item.Value;
            using var request=new HttpRequestMessage(HttpMethod.Post,"/Admin/NotificationSettings?handler="+operation){Content=new FormUrlEncodedContent(data)};
            if(enhanced){request.Headers.Add("Accept",NotificationMedia);request.Headers.Add("X-Requested-With","XMLHttpRequest");}return await Client.SendAsync(request);
        }
        public async Task<List<DiscordWebhook>> Stored(){using var scope=Leave.Services.CreateScope();return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().DiscordWebhooks.AsNoTracking().OrderBy(x=>x.Id).ToListAsync();}
        public async ValueTask DisposeAsync(){Client.Dispose();PortalClient.Dispose();await Leave.DisposeAsync();await Portal.DisposeAsync();}
    }
    [Fact]
    public async Task WebhookSharedFormsPreserveExactIdsMaskedListsAndConfirmedTargets(){
        await using var s=await WebhookSetup.Create();var html=await s.Client.GetStringAsync("/Admin/NotificationSettings");
        Assert.DoesNotContain(WebhookOne,html);Assert.DoesNotContain("<script>bad()",html);Assert.DoesNotContain("return confirm",html);
        var initialTest=await NotificationReceipt(await s.Post("Test"));Assert.Equal(new[]{WebhookOne},s.Leave.Sent);
        var add=await NotificationReceipt(await s.Post("Add"));Assert.Equal(2,(await s.Stored()).Count);
        Assert.Equal("9007199254740994",add.GetProperty("data").GetProperty("affected").GetProperty("id").GetString());
        var test=await NotificationReceipt(await s.Post("Test"));Assert.Equal(new[]{WebhookOne,WebhookOne,WebhookTwo},s.Leave.Sent);
        var delete=await NotificationReceipt(await s.Post("Delete"));Assert.Equal(WebhookTwo,Assert.Single(await s.Stored()).Url);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(!string.IsNullOrEmpty(output)){
            Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,"leave.webhook.html"),html);
            await File.WriteAllTextAsync(Path.Combine(output,"leave.webhook.json"),JsonSerializer.Serialize(new{context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation"),add,test,initialTest,delete}));
        }
    }
    [Theory]
    [InlineData("expectedEmployeeId","999",409)]
    [InlineData("expectedStateToken","stale",409)]
    [InlineData("WebhookUrl","https://example.test/secret",422)]
    [InlineData("WebhookUrl",WebhookOne,422)]
    public async Task WebhookInvalidOrStaleRequestsDoNotWrite(string field,string value,int status){
        await using var s=await WebhookSetup.Create();using var result=await s.Post("Add",new(){{field,value}});Assert.Equal(status,(int)result.StatusCode);Assert.Single(await s.Stored());Assert.Empty(s.Leave.Sent);
    }
    [Fact]
    public async Task WebhookCsrfNativeAndPartialExternalFailureRemainExplicit(){
        await using var s=await WebhookSetup.Create();using(var denied=await s.Post("Add",csrf:false))Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);
        using(var native=await s.Post("Add",enhanced:false)){native.EnsureSuccessStatusCode();Assert.Contains("추가했습니다",WebUtility.HtmlDecode(await native.Content.ReadAsStringAsync()));}
        s.Leave.FailSecond=true;using var failed=await s.Post("Test");Assert.Equal(HttpStatusCode.BadGateway,failed.StatusCode);
        var body=await failed.Content.ReadAsStringAsync();Assert.Contains("unknown",body);Assert.DoesNotContain("private-webhook-canary",body);Assert.DoesNotContain(WebhookTwo,body);Assert.Equal(2,s.Leave.Sent.Count);Assert.Equal(2,(await s.Stored()).Count);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task WebhookAuditFailureDoesNotClaimDatabaseRollback(bool enhanced){
        await using var s=await WebhookSetup.Create();using(var scope=s.Leave.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER webhook_audit_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-webhook-audit'); END;");
        using var result=await s.Post("Add",enhanced:enhanced);var body=await result.Content.ReadAsStringAsync();
        if(enhanced){Assert.Equal(HttpStatusCode.BadGateway,result.StatusCode);Assert.Contains("unknown",body);}
        else{result.EnsureSuccessStatusCode();Assert.Matches("<fieldset[^>]*data-webhook-fields[^>]*disabled",body);Assert.DoesNotMatch("<p[^>]*data-webhook-recheck[^>]*hidden",body);Assert.Contains(WebhookTwo,body);}
        Assert.DoesNotContain("private-webhook-audit",body);Assert.Equal(2,(await s.Stored()).Count);
    }
    [Fact]
    public async Task WebhookServerRejectsEmployeeWritesAndCanonicalizesMaskedHost(){
        Assert.Equal("https://discord.com/api/webhooks/***",LeaveManager.Services.DiscordNotificationService.MaskWebhookUrl("https://DISCORD.COM./api/webhooks/123/token"));
        await using var portal=new ContractFactory<CompanyUser>();using var portalClient=portal.CreateClient(Options);await using var leave=new LeaveFactory(portal);using var client=leave.CreateClient(Options);
        await Connect(portal,portalClient,client,"employee");
        foreach(var operation in new[]{"Add","Delete","Test"}){
            using var request=new HttpRequestMessage(HttpMethod.Post,"/Admin/NotificationSettings?handler="+operation){Content=new FormUrlEncodedContent(new Dictionary<string,string>{{"WebhookUrl",WebhookTwo}})};
            request.Headers.Add("Accept",NotificationMedia);request.Headers.Add("X-Requested-With","XMLHttpRequest");
            using var response=await client.SendAsync(request);Assert.Equal(HttpStatusCode.Forbidden,response.StatusCode);
        }
        using var scope=leave.Services.CreateScope();Assert.Empty(await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().DiscordWebhooks.ToListAsync());
    }
}
