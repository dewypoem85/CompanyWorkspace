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
    sealed class ApprovalSetup : IAsyncDisposable
    {
        public ContractFactory<CompanyUser> Portal { get; } = new();
        public LeaveFactory Leave { get; private set; } = null!;
        public HttpClient PortalClient { get; private set; } = null!;
        public HttpClient Client { get; private set; } = null!;
        public long Owner { get; private set; }
        public static async Task<ApprovalSetup> Create(string role="admin") {
            var setup=new ApprovalSetup();setup.PortalClient=setup.Portal.CreateClient(Options);setup.Leave=new LeaveFactory(setup.Portal);setup.Client=setup.Leave.CreateClient(Options);
            var user=await Connect(setup.Portal,setup.PortalClient,setup.Client,role);
            using var scope=setup.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            setup.Owner=(await db.Employees.SingleAsync(x=>x.CompanyUserId==user!.Id)).Id;
            var employee=new Employee{Name="검증 직원",Email="approval@example.test",HireDate=new(2025,1,1),IsActive=false};db.Employees.Add(employee);await db.SaveChangesAsync();
            foreach(var (id,status) in new[]{(9007199254740993L,LeaveRequestStatus.Pending),(9007199254740995L,LeaveRequestStatus.CancelRequested),(9007199254740997L,LeaveRequestStatus.Approved)})
                db.LeaveRequests.Add(new(){Id=id,EmployeeId=employee.Id,Status=status,Reason="검증 사유",WorkPlan="업무 인수인계",CalculatedDays=0.5m,RequestedAtUtc=new(2026,9,1,0,0,0,DateTimeKind.Utc),CancelRequestedAtUtc=status==LeaveRequestStatus.CancelRequested?new(2026,9,2,0,0,0,DateTimeKind.Utc):null,Dates=[new(){Date=new(2027,1,5),Portion=LeaveDayPortion.Morning}]});
            await db.SaveChangesAsync();return setup;
        }
        public async Task<LeaveRequest?> Stored(long id){using var scope=Leave.Services.CreateScope();return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().LeaveRequests.Include(x=>x.Dates).AsNoTracking().SingleOrDefaultAsync(x=>x.Id==id);}
        public async Task<HttpResponseMessage> Post(string operation,long id,bool approve=true,string? reason=null,string? owner=null,string? snapshot=null,bool csrf=true,bool enhanced=true,bool baseline=true){
            var data=new List<KeyValuePair<string,string>>{new("id",id.ToString(CultureInfo.InvariantCulture))};
            if(operation!="ForceDelete")data.Add(new("approve",approve?"true":"false"));else data.Add(new("reason",reason??"검증용 강제 삭제"));
            if(baseline){data.Add(new("expectedEmployeeId",owner??Owner.ToString(CultureInfo.InvariantCulture)));data.Add(new("expectedSnapshot",snapshot??LeaveManager.Pages.Admin.IndexModel.Snapshot((await Stored(id))!)));}
            if(csrf){var html=await Client.GetStringAsync("/Leave");data.Add(new("__RequestVerificationToken",WebUtility.HtmlDecode(Regex.Match(html,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value)));}
            using var request=new HttpRequestMessage(HttpMethod.Post,"/Admin?handler="+operation){Content=new FormUrlEncodedContent(data)};
            if(enhanced){request.Headers.Add("Accept",NotificationMedia);request.Headers.Add("X-Requested-With","XMLHttpRequest");}return await Client.SendAsync(request);
        }
        public async ValueTask DisposeAsync(){Client.Dispose();PortalClient.Dispose();await Leave.DisposeAsync();await Portal.DisposeAsync();}
    }
    [Theory]
    [InlineData("Decide",9007199254740993L,true,LeaveRequestStatus.Approved)]
    [InlineData("Decide",9007199254740993L,false,LeaveRequestStatus.Rejected)]
    [InlineData("CancelDecide",9007199254740995L,true,LeaveRequestStatus.Cancelled)]
    [InlineData("CancelDecide",9007199254740995L,false,LeaveRequestStatus.Approved)]
    public async Task ApprovalFormsConfirmExactActorTargetAndAction(string action,long id,bool approve,LeaveRequestStatus status){
        await using var s=await ApprovalSetup.Create();var before=LeaveManager.Pages.Admin.IndexModel.Snapshot((await s.Stored(id))!);
        using var response=await s.Post(action,id,approve);var receipt=await NotificationReceipt(response);var data=receipt.GetProperty("data");
        Assert.Equal(action,data.GetProperty("operation").GetString());Assert.Equal(id.ToString(CultureInfo.InvariantCulture),data.GetProperty("id").GetString());Assert.Equal(s.Owner.ToString(CultureInfo.InvariantCulture),data.GetProperty("employeeId").GetString());Assert.Equal(before,data.GetProperty("previousSnapshot").GetString());Assert.Equal(status.ToString(),data.GetProperty("status").GetString());Assert.Equal(status,(await s.Stored(id))!.Status);
        using var scope=s.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var target=id.ToString(CultureInfo.InvariantCulture);Assert.True(await db.AuditLogs.AnyAsync(x=>x.TargetId==target));Assert.True(await db.AppNotifications.AnyAsync());
        using var duplicate=await s.Post(action,id,approve,snapshot:before);Assert.Equal(HttpStatusCode.Conflict,duplicate.StatusCode);
    }
    [Fact]
    public async Task ApprovalFormsRejectStaleAccountSnapshotSelfMissingAndUnauthorized(){
        await using var s=await ApprovalSetup.Create();const long id=9007199254740993;
        Assert.Equal(HttpStatusCode.BadRequest,(await s.Post("Decide",id,csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await s.Post("Decide",id,owner:"999")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await s.Post("Decide",id,snapshot:"old")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await s.Post("Decide",100,snapshot:"old")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await s.Post("Decide",id,baseline:false)).StatusCode);
        using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();(await db.LeaveRequests.FindAsync(id))!.EmployeeId=s.Owner;await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await s.Post("Decide",id)).StatusCode);
        Assert.Equal(LeaveRequestStatus.Pending,(await s.Stored(id))!.Status);
        await using var ordinary=await ApprovalSetup.Create("employee");Assert.Equal(HttpStatusCode.Forbidden,(await ordinary.Post("Decide",id)).StatusCode);
    }
    [Fact]
    public async Task ApprovalFormsPreserveNativeDeleteReceiptAndSanitizePartialFailure(){
        await using var s=await ApprovalSetup.Create();const long id=9007199254740997;
        using(var advanceScope=s.Leave.Services.CreateScope()){var advanceDb=advanceScope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var advance=(await advanceDb.LeaveRequests.FindAsync(9007199254740993L))!;advance.IsAdvance=true;advance.AdvanceDays=0.5m;advance.AnnualAdvanceDays=0.5m;await advanceDb.SaveChangesAsync();}
        var html=await s.Client.GetStringAsync("/Admin");Assert.Contains("data-approval-form",html);Assert.Contains("expectedSnapshot",html);Assert.Contains("advance-badge cw-state-pill\" data-tone=\"warning\"",html);Assert.DoesNotContain("return confirm(",html);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(output)){Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,"leave.approvals.html"),html);await File.WriteAllTextAsync(Path.Combine(output,"leave.approvals.json"),JsonSerializer.Serialize(new{context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation"),summary=await s.Client.GetFromJsonAsync<JsonElement>("/Admin?handler=QueueSummary")}));}
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await s.Post("ForceDelete",id,reason:" ")).StatusCode);
        using var nativeError=await s.Post("ForceDelete",id,reason:"<script>window.injected=true</script>",owner:"999",enhanced:false);
        Assert.Equal(HttpStatusCode.Conflict,nativeError.StatusCode);var errorHtml=await nativeError.Content.ReadAsStringAsync();Assert.Contains("data-write-locked=\"true\"",errorHtml);Assert.Contains("&lt;script&gt;",errorHtml);Assert.DoesNotContain("<script>window.injected",errorHtml);
        using var deleted=await s.Post("ForceDelete",id);var data=(await NotificationReceipt(deleted)).GetProperty("data");Assert.Equal("deleted",data.GetProperty("status").GetString());Assert.Equal(JsonValueKind.Null,data.GetProperty("approve").ValueKind);Assert.Null(await s.Stored(id));
        using var native=await s.Post("Decide",9007199254740993,baseline:false,enhanced:false);Assert.Equal(HttpStatusCode.Redirect,native.StatusCode);
        using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER approval_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-approval-canary'); END;");}
        using var failure=await s.Post("CancelDecide",9007199254740995);Assert.Equal(HttpStatusCode.InternalServerError,failure.StatusCode);Assert.DoesNotContain("private-approval-canary",await failure.Content.ReadAsStringAsync());
        Assert.Equal(LeaveRequestStatus.Cancelled,(await s.Stored(9007199254740995))!.Status);
    }
}
