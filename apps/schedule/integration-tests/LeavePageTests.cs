using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using LeaveManager.Workspace;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    class LeaveFactory(ContractFactory<CompanyUser> portal) : ContractFactory<Employee>
    {
        public HttpStatusCode? ConnectionFailure { get; set; }
        public Func<HttpRequestMessage, HttpResponseMessage>? ScheduleResponse { get; set; }
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Schedule:InternalUrl", "http://company-schedule:8080");
            builder.ConfigureServices(services => services.AddHttpClient("WorkspaceSession")
                .ConfigurePrimaryHttpMessageHandler(() => new PortalRelay(this, portal.Server.CreateHandler())));
            builder.ConfigureServices(services => services.AddHttpClient("ScheduleInternal")
                .ConfigurePrimaryHttpMessageHandler(() => new ScheduleRelay(this)));
        }
    }
    sealed class PortalRelay(LeaveFactory owner, HttpMessageHandler inner) : DelegatingHandler(inner)
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            owner.ConnectionFailure is {} status ? Task.FromResult(new HttpResponseMessage(status)) : base.SendAsync(request, token);
    }
    sealed class ScheduleRelay(LeaveFactory owner) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            var payload = Schedule.Tokens.Verify(request.Headers.Authorization?.Parameter ?? "", ContractFactory<Employee>.Secret, "company-leave", "leave-milestones");
            Assert.True(long.TryParse(payload.GetProperty("sub").GetString(), out var actor) && actor > 0);
            return Task.FromResult(owner.ScheduleResponse?.Invoke(request)
                ?? new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { items = Array.Empty<object>() }) });
        }
    }
    static async Task<CompanyUser?> Connect(ContractFactory<CompanyUser> portal, HttpClient portalClient, HttpClient leaveClient, string role)
    {
        if (role == "guest") return null;
        var (user, _) = await WorkspaceTests.Login(portal, portalClient, role == "shared", role == "admin", role == "master");
        using (var scope = portal.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            (await db.Users.SingleAsync(x=>x.Id==user.Id)).HireDate = new(2025,1,1);
            await db.SaveChangesAsync();
        }
        var launch=await portalClient.GetAsync("/Auth/leave");
        if (role == "shared") { Assert.Equal(HttpStatusCode.Redirect,launch.StatusCode); return user; }
        launch.EnsureSuccessStatusCode();
        var html=await launch.Content.ReadAsStringAsync();
        var token=Regex.Match(html,"name=\"token\"[^>]*value=\"([^\"]+)\"").Groups[1].Value;
        Assert.NotEmpty(token);
        var response=await leaveClient.PostAsync("/auth/sso/callback",new FormUrlEncodedContent(new Dictionary<string,string>{{"token",WebUtility.HtmlDecode(token)}}));
        Assert.Equal(HttpStatusCode.Redirect,response.StatusCode);
        return user;
    }
    static WebApplicationFactoryClientOptions Options => new() { AllowAutoRedirect=false };

    [Theory]
    [InlineData("guest")]
    [InlineData("employee")]
    [InlineData("shared")]
    [InlineData("admin")]
    [InlineData("master")]
    public async Task RegisteredLeavePagesPreserveRealSsoAndRolePolicies(string role)
    {
        await using var portal=new ContractFactory<CompanyUser>();
        using var portalClient=portal.CreateClient(Options);
        await using var leave=new LeaveFactory(portal);
        using var client=leave.CreateClient(Options);
        await Connect(portal,portalClient,client,role);
        var signedIn=role is not ("guest" or "shared");
        using(var scope=leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var employee=new Employee {Name="검증 직원",Email="leave-fixture@example.test",CompanyUserId=9000,HireDate=new(2025,1,1),IsPrivate=true};
            db.Employees.Add(employee);
            var today=LeaveManager.Services.AppTime.Today;
            foreach(var status in new[]{LeaveRequestStatus.Pending,LeaveRequestStatus.CancelRequested,LeaveRequestStatus.Approved})
                db.LeaveRequests.Add(new(){Employee=employee,Status=status,Reason="검증용 신청 사유",WorkPlan="긴 업무 인수인계 텍스트로 모바일 표의 줄바꿈과 상태 표시를 확인합니다.",CalculatedDays=0.5m,Dates=[new(){Date=today,Portion=LeaveDayPortion.Morning}]});
            db.Holidays.Add(new(){Date=today,Name="검증 공휴일"});
            await db.SaveChangesAsync();
        }
        bool Allowed(WorkspacePage page)=>page.Anonymous || page.Policy switch
        {
            "EmployeeOnly"=>signedIn,
            // Company admin and master both project to the existing Leave Master role.
            "AdminOnly" or "MasterOnly"=>role is "admin" or "master",
            _=>throw new InvalidOperationException("Add explicit policy coverage")
        };
        var navResponse=await client.GetAsync("/api/workspace/navigation");
        JsonElement? navigation=null;
        if(!signedIn)Assert.Equal(HttpStatusCode.Unauthorized,navResponse.StatusCode);
        else
        {
            navResponse.EnsureSuccessStatusCode();navigation=await navResponse.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(WorkspacePages.All.Where(p=>p.Navigation&&Allowed(p)).Select(p=>p.Id),navigation.Value.GetProperty("pages").EnumerateArray().Select(x=>x.GetString()));
            var badges=navigation.Value.GetProperty("badges");
            if(role is "admin" or "master")Assert.Equal(2,badges.GetProperty("leave.approvals").GetInt32());
            else Assert.Empty(badges.EnumerateObject());
        }
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        var records=new List<object>();
        foreach(var page in WorkspacePages.All)
        foreach(var path in new[]{page.Path}.Concat(page.Aliases))
        {
            var response=await client.GetAsync(path);
            if(!Allowed(page))
            {
                Assert.Equal(HttpStatusCode.Redirect,response.StatusCode);
                Assert.Contains(signedIn?"/Account/AccessDenied":"/Account/Login",response.Headers.Location!.ToString());
                continue;
            }
            response.EnsureSuccessStatusCode();
            var html=await response.Content.ReadAsStringAsync();
            Assert.Contains("data-workspace-view=\""+page.Id+"\"",html);
            Assert.Contains("<title>"+page.Title+" - 연차관리</title>",WebUtility.HtmlDecode(html));
            Assert.Equal(1,html.Split("data-company-workspace").Length-1);
            Assert.Equal(signedIn?1:0,html.Split("data-workspace-navigation=\"leave\"").Length-1);
            if(!string.IsNullOrEmpty(output)&&path==page.Path)
            {
                Directory.CreateDirectory(output);var file=page.Id+"."+role+".html";
                await File.WriteAllTextAsync(Path.Combine(output,file),html);
                records.Add(new{id=page.Id,path,query=page.Query,title=page.Title,file});
            }
        }
        if(!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(output);
            var context=await portalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context");
            JsonElement? approvalSummary=null;
            var grantCatalogs = new Dictionary<string, JsonElement>();
            if(role is "admin" or "master")
            {
                approvalSummary=await client.GetFromJsonAsync<JsonElement>("/Admin?handler=QueueSummary");
                await File.WriteAllTextAsync(Path.Combine(output,"leave.queue."+role+".html"),await client.GetStringAsync("/Admin?handler=Queue"));
                using var scope = leave.Services.CreateScope();
                var employeeIds = await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Employees.Where(x => !x.IsSharedAccount && !x.IsCompanyMaster).Select(x => x.Id).ToListAsync();
                foreach (var id in employeeIds) grantCatalogs[id.ToString()] = await client.GetFromJsonAsync<JsonElement>($"/Admin/Adjustments?handler=Baseline&employeeId={id}");
            }
            await File.WriteAllTextAsync(Path.Combine(output,"leave."+role+".json"),JsonSerializer.Serialize(new{role,context,navigation,approvalSummary,grantCatalogs,pages=records}));
        }
        if(signedIn)Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync("/unregistered-page")).StatusCode);
    }

    [Fact]
    public async Task NavigationRetainsSessionFailureAndRevocationBoundary()
    {
        await using var portal=new ContractFactory<CompanyUser>();using var portalClient=portal.CreateClient(Options);
        await using var leave=new LeaveFactory(portal);using var client=leave.CreateClient(Options);
        var user=await Connect(portal,portalClient,client,"admin");
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/workspace/navigation")).StatusCode);
        leave.ConnectionFailure=HttpStatusCode.ServiceUnavailable;
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/workspace/navigation")).StatusCode);
        leave.ConnectionFailure=null;
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/workspace/navigation")).StatusCode);
        using(var scope=portal.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            (await db.Users.SingleAsync(x=>x.Id==user!.Id)).IsActive=false;await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/api/workspace/navigation")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/Admin")).StatusCode);
        using(var scope=portal.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceSessions SET Revoked=1 WHERE UserId={user!.Id}");
        }
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/workspace/navigation")).StatusCode);
        Assert.Equal(HttpStatusCode.Redirect,(await client.GetAsync("/Admin")).StatusCode);
    }
}
