using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    static async Task SeedSelfActions(ApplicationSetup s) {
        using var scope=s.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var owner=long.Parse(s.Owner,CultureInfo.InvariantCulture);
        foreach(var (id,status) in new[]{(9007199254740993L,LeaveRequestStatus.Pending),(9007199254740995L,LeaveRequestStatus.Approved),(9007199254740997L,LeaveRequestStatus.CancelRequested)})
            db.LeaveRequests.Add(new(){Id=id,EmployeeId=owner,Status=status,Reason="검증 사유",WorkPlan="검증 인수인계",CalculatedDays=1m,Dates=[new(){Date=s.Start,Portion=LeaveDayPortion.FullDay},new(){Date=s.Start.AddMonths(1),Portion=LeaveDayPortion.FullDay}]});
        await db.SaveChangesAsync();
    }
    static async Task<HttpResponseMessage> SelfPost(ApplicationSetup s,string operation,long id,Dictionary<string,string>? changes=null,bool enhanced=true,bool baseline=true,bool csrf=true) {
        var target=(await s.Stored()).SingleOrDefault(x=>x.Id==id);var fields=new Dictionary<string,string>{{"id",id.ToString(CultureInfo.InvariantCulture)},{"Year",s.Start.Year.ToString()},{"Month",s.Start.Month.ToString()},{"CalendarView","month"},{"SelfOnly","false"},{"ShowOthers","false"},{"RequestLimit","10"},{"RequestPage","1"}};
        if(baseline){fields["expectedEmployeeId"]=s.Owner;fields["expectedSnapshot"]=target is null?"missing":LeaveRequestSnapshot.Compute(target);}
        if(changes!=null)foreach(var pair in changes)fields[pair.Key]=pair.Value;
        if(csrf){var html=await s.Client.GetStringAsync("/Leave");fields["__RequestVerificationToken"]=WebUtility.HtmlDecode(Regex.Match(html,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);}
        using var request=new HttpRequestMessage(HttpMethod.Post,"/Leave?handler="+operation){Content=new FormUrlEncodedContent(fields)};if(enhanced)request.Headers.Add("Accept",NotificationMedia);return await s.Client.SendAsync(request);
    }
    [Theory]
    [InlineData("Cancel",9007199254740993L,LeaveRequestStatus.Cancelled)]
    [InlineData("Cancel",9007199254740995L,LeaveRequestStatus.CancelRequested)]
    [InlineData("WithdrawCancel",9007199254740997L,LeaveRequestStatus.Approved)]
    public async Task SelfActionsConfirmExactTransitionAndOldBaselineIsRejected(string operation,long id,LeaveRequestStatus expected){
        await using var s=await ApplicationSetup.Create();await SeedSelfActions(s);var previous=(await s.Stored()).Single(x=>x.Id==id);var snapshot=LeaveRequestSnapshot.Compute(previous);
        using var response=await SelfPost(s,operation,id);var data=(await NotificationReceipt(response)).GetProperty("data");Assert.Equal(operation,data.GetProperty("operation").GetString());Assert.Equal(s.Owner,data.GetProperty("employeeId").GetString());Assert.Equal(id.ToString(CultureInfo.InvariantCulture),data.GetProperty("id").GetString());Assert.Equal(snapshot,data.GetProperty("previousSnapshot").GetString());Assert.Equal(previous.Status.ToString(),data.GetProperty("previousStatus").GetString());Assert.Equal(expected.ToString(),data.GetProperty("status").GetString());Assert.Equal(expected,(await s.Stored()).Single(x=>x.Id==id).Status);
        using var stale=await SelfPost(s,operation,id,new(){{"expectedSnapshot",snapshot}});Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
    }
    [Fact]
    public async Task SelfActionsEnforceOwnershipCsrfSnapshotAndPastDatePolicy(){
        await using var s=await ApplicationSetup.Create("admin");await SeedSelfActions(s);
        Assert.Equal(HttpStatusCode.BadRequest,(await SelfPost(s,"Cancel",9007199254740993,csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await SelfPost(s,"Cancel",9007199254740993,baseline:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await SelfPost(s,"Cancel",9007199254740993,new(){{"expectedEmployeeId","999"}})).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await SelfPost(s,"Cancel",9007199254740993,new(){{"ViewEmployeeId","999"}})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await SelfPost(s,"Cancel",1)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await SelfPost(s,"WithdrawCancel",9007199254740993)).StatusCode);
        using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var other=new Employee{Name="다른 직원",Email="other-self@example.test",HireDate=new(2025,1,1)};db.Employees.Add(other);await db.SaveChangesAsync();(await db.LeaveRequests.FindAsync(9007199254740993L))!.EmployeeId=other.Id;(await db.LeaveRequestDates.FirstAsync(x=>x.LeaveRequestId==9007199254740995L)).Date=AppTime.Today.AddDays(-1);await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.Conflict,(await SelfPost(s,"Cancel",9007199254740993)).StatusCode);Assert.Equal(HttpStatusCode.UnprocessableEntity,(await SelfPost(s,"Cancel",9007199254740995)).StatusCode);
        Assert.Equal(LeaveRequestStatus.Pending,(await s.Stored()).Single(x=>x.Id==9007199254740993L).Status);
    }
    [Fact]
    public async Task SelfActionsNativeCompatibilityAndPostCommitFailureRemainDistinct(){
        await using var s=await ApplicationSetup.Create();await SeedSelfActions(s);
        using var native=await SelfPost(s,"Cancel",9007199254740993,enhanced:false,baseline:false);Assert.Equal(HttpStatusCode.Redirect,native.StatusCode);
        using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER self_action_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-self-action-canary'); END;");}
        using var failed=await SelfPost(s,"WithdrawCancel",9007199254740997);Assert.Equal(HttpStatusCode.InternalServerError,failed.StatusCode);var json=await failed.Content.ReadAsStringAsync();Assert.DoesNotContain("private-self-action-canary",json);Assert.Equal("unknown",JsonDocument.Parse(json).RootElement.GetProperty("outcome").GetString());Assert.Equal(LeaveRequestStatus.Approved,(await s.Stored()).Single(x=>x.Id==9007199254740997L).Status);
        using var htmlFailure=await SelfPost(s,"Cancel",9007199254740995,new(){{"expectedEmployeeId","999"}},enhanced:false);Assert.Equal(HttpStatusCode.Conflict,htmlFailure.StatusCode);Assert.Contains("data-self-locked=\"true\"",await htmlFailure.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task SelfActionRazorUsesSameSnapshotInCalendarAndListAcrossDateRange(){
        await using var s=await ApplicationSetup.Create();await SeedSelfActions(s);
        using(var completeScope=s.Leave.Services.CreateScope()){var completeDb=completeScope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();completeDb.LeaveRequests.Add(new(){Id=9007199254740999L,EmployeeId=long.Parse(s.Owner,CultureInfo.InvariantCulture),Status=LeaveRequestStatus.Approved,Reason="완료 검증",WorkPlan="완료 업무",CalculatedDays=0.5m,RequestedAtUtc=new(2026,9,3,0,0,0,DateTimeKind.Utc),Dates=[new(){Date=AppTime.Today.AddDays(-1),Portion=LeaveDayPortion.Morning}]});await completeDb.SaveChangesAsync();}
        var html=await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}");
        Assert.Contains("data-leave-self-action",html);Assert.Contains("request-complete-label cw-state-pill\" data-tone=\"neutral\">사용 완료",html);Assert.DoesNotContain("onsubmit=\"return confirm",html);var target=(await s.Stored()).Single(x=>x.Id==9007199254740993L);var snapshot=LeaveRequestSnapshot.Compute(target);Assert.Contains("data-request-snapshot=\""+snapshot+"\"",html);Assert.Contains("name=\"expectedSnapshot\" value=\""+snapshot+"\"",html);Assert.Equal(snapshot,LeaveManager.Pages.Admin.IndexModel.Snapshot(target));
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(string.IsNullOrEmpty(output))return;Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,"leave.self-actions.html"),html);await File.WriteAllTextAsync(Path.Combine(output,"leave.self-actions.json"),JsonSerializer.Serialize(new{start=s.Start.ToString("yyyy-MM-dd"),context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation")}));
    }
}
