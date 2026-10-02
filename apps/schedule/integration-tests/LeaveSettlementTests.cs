using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    const long SettlementGrantId = 9007199254740995L;
    static async Task SeedSettlement(ApplicationSetup s)
    {
        await SeedExternal(s);
        using var scope = s.Leave.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        db.LeaveGrants.Add(new() { Id = SettlementGrantId, EmployeeId = ExternalEmployeeId, GrantedDate = AppTime.Today.AddDays(-10), ExpiresDate = AppTime.Today.AddMonths(4), GrantType = LeaveGrantType.Manual, GrantedDays = 10.5m, Note = "정산 검증 발생분" });
        await db.SaveChangesAsync();
    }
    static async Task<string> SettlementBaseline(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        var balance = (await scope.ServiceProvider.GetRequiredService<LeaveCalculationService>().GetGrantBalancesAsync(ExternalEmployeeId, AppTime.Today)).Single(x => x.Grant.Id == SettlementGrantId);
        return await LeaveSettlementSnapshot.ComputeAsync(db, balance, AppTime.Today);
    }
    static async Task<List<LeaveSettlement>> SettlementsStored(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().LeaveSettlements.AsNoTracking().Where(x => x.SourceGrantId == SettlementGrantId).ToListAsync();
    }
    static async Task<HttpResponseMessage> SettlementPost(ApplicationSetup s, Dictionary<string,string>? changes = null,
        bool enhanced = true, bool baseline = true, bool csrf = true, string? duplicate = null)
    {
        var values = new Dictionary<string,string> { ["grantId"] = SettlementGrantId.ToString(), ["type"] = "CarryOver", ["days"] = "1.50", ["note"] = "  연말 정산  " };
        if (baseline) { values["expectedEmployeeId"] = s.Owner; values["expectedSnapshot"] = await SettlementBaseline(s); }
        if (changes is not null) foreach(var pair in changes) values[pair.Key] = pair.Value;
        if (csrf) {
            var html = await s.Client.GetStringAsync("/Leave");
            values["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        }
        var fields = values.ToList(); if(duplicate is not null)fields.Add(new(duplicate, values[duplicate]));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Admin/Settlements") { Content = new FormUrlEncodedContent(fields) };
        if (enhanced) request.Headers.Add("Accept", NotificationMedia);
        return await s.Client.SendAsync(request);
    }
    [Theory]
    [InlineData("Expiration")][InlineData("CarryOver")][InlineData("Compensation")]
    public async Task SettlementConfirmsActualRecordAndCarryOverTransaction(string type)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedSettlement(s);
        var baseline = await SettlementBaseline(s);
        using var response = await SettlementPost(s, new() { ["type"] = type });
        var data = (await NotificationReceipt(response)).GetProperty("data"); var stored = Assert.Single(await SettlementsStored(s));
        Assert.Equal("Settle", data.GetProperty("operation").GetString()); Assert.Equal(s.Owner, data.GetProperty("actorEmployeeId").GetString());
        Assert.Equal(ExternalEmployeeId.ToString(), data.GetProperty("employeeId").GetString()); Assert.Equal(SettlementGrantId.ToString(), data.GetProperty("grantId").GetString());
        Assert.Equal(stored.Id.ToString(), data.GetProperty("id").GetString()); Assert.Equal(baseline, data.GetProperty("previousSnapshot").GetString()); Assert.Equal(type, data.GetProperty("type").GetString());
        Assert.Equal("1.5", data.GetProperty("days").GetString()); Assert.Equal("연말 정산", data.GetProperty("note").GetString()); Assert.Equal(AppTime.Today.ToString("yyyy-MM-dd"), data.GetProperty("processedDate").GetString());
        Assert.Equal("/Admin/Settlements", data.GetProperty("navigateTo").GetString()); Assert.Equal(long.Parse(s.Owner), stored.ProcessedByEmployeeId);
        using var scope = s.Leave.Services.CreateScope();var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        if (type == "CarryOver") {
            var grant = await db.LeaveGrants.SingleAsync(x => x.Id == stored.CreatedGrantId);
            Assert.True(grant.Id > SettlementGrantId); Assert.Equal(grant.Id.ToString(), data.GetProperty("createdGrantId").GetString());
            Assert.Equal(SettlementGrantId, grant.SourceGrantId); Assert.Equal(ExternalEmployeeId, grant.EmployeeId); Assert.Equal(1.5m, grant.GrantedDays);
            Assert.Equal(LeaveGrantType.CarriedOver, grant.GrantType); Assert.Equal(AppTime.Today, grant.GrantedDate); Assert.Equal(AppTime.Today.AddYears(1).AddDays(-1), grant.ExpiresDate);
        } else { Assert.Null(stored.CreatedGrantId); Assert.Equal(JsonValueKind.Null, data.GetProperty("createdGrantId").ValueKind); }
        Assert.Contains(await db.AuditLogs.ToListAsync(), x => x.Action == "LeaveSettlement" + type && x.TargetId == SettlementGrantId.ToString() && x.Reason == "연말 정산");
        var balance = (await scope.ServiceProvider.GetRequiredService<LeaveCalculationService>().GetGrantBalancesAsync(ExternalEmployeeId, AppTime.Today)).Single(x => x.Grant.Id == SettlementGrantId);
        Assert.Equal(9m, balance.Available);
        Assert.Equal(HttpStatusCode.Conflict, (await SettlementPost(s, new() { ["expectedSnapshot"] = baseline })).StatusCode); Assert.Single(await SettlementsStored(s));
    }
    [Fact]
    public async Task SettlementRejectsInvalidFieldsIdentityCsrfAndNativeDuplicates()
    {
        await using var s = await ApplicationSetup.Create("admin");await SeedSettlement(s);
        Assert.Equal(HttpStatusCode.BadRequest, (await SettlementPost(s, csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SettlementPost(s, baseline:false)).StatusCode);
        foreach(var key in new[] { "expectedEmployeeId", "expectedSnapshot" }) {
            Assert.Equal(HttpStatusCode.Conflict, (await SettlementPost(s, new() { [key] = "wrong" })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await SettlementPost(s, duplicate:key)).StatusCode);
        }
        foreach(var changes in new Dictionary<string,string>[] { new() { ["grantId"] = "bad" },new() { ["grantId"] = "0" },new() { ["grantId"] = "9223372036854775808" },new() { ["type"] = "999" },new() { ["type"] = "AdvanceRepayment" },new() { ["type"] = "bad" },new() { ["days"] = "bad" },new() { ["days"] = "0" },new() { ["days"] = "-0.5" },new() { ["days"] = "0.1" },new() { ["days"] = "11" },new() { ["note"] = " " } })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await SettlementPost(s, changes)).StatusCode);
        foreach(var key in new[] { "grantId", "type", "days", "note" })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await SettlementPost(s, duplicate:key)).StatusCode);
        Assert.Empty(await SettlementsStored(s));
    }
    [Theory]
    [InlineData("employee")][InlineData("inactive")][InlineData("shared")][InlineData("master")][InlineData("private")]
    public async Task SettlementPreservesActualAdminAndTargetEligibility(string kind)
    {
        await using var s = await ApplicationSetup.Create(kind == "employee" ? "employee" : "admin");await SeedSettlement(s);
        using(var scope=s.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var e=await db.Employees.SingleAsync(x=>x.Id==ExternalEmployeeId);
            e.IsActive=kind!="inactive";e.IsSharedAccount=kind=="shared";e.IsCompanyMaster=kind=="master";e.IsPrivate=kind=="private";await db.SaveChangesAsync();
        }
        using var response=await SettlementPost(s);
        if(kind=="private"){response.EnsureSuccessStatusCode();Assert.Single(await SettlementsStored(s));}
        else { Assert.False(response.IsSuccessStatusCode);Assert.Empty(await SettlementsStored(s)); }
        if(kind=="employee") {
            using var scope=s.Leave.Services.CreateScope();
            await Assert.ThrowsAsync<UnauthorizedAccessException>(()=>scope.ServiceProvider.GetRequiredService<LeaveSettlementService>().SettleAsync(SettlementGrantId,long.Parse(s.Owner),LeaveSettlementType.Expiration,1,"정산"));
        }
    }
    [Fact]
    public async Task SettlementDetectsAllocationAndGrantChangesAndExpiredBaseline()
    {
        await using var s = await ApplicationSetup.Create("admin");await SeedSettlement(s);var baseline=await SettlementBaseline(s);
        using(var scope=s.Leave.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var request=new LeaveRequest { EmployeeId=ExternalEmployeeId,Status=LeaveRequestStatus.Pending,Reason="배정",WorkPlan="검증",CalculatedDays=.5m };
            db.LeaveRequests.Add(request);await db.SaveChangesAsync();db.LeaveAllocations.Add(new() { LeaveRequestId=request.Id,LeaveGrantId=SettlementGrantId,Days=.5m });await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict,(await SettlementPost(s,new(){["expectedSnapshot"]=baseline})).StatusCode);
        baseline=await SettlementBaseline(s);
        using(var scope=s.Leave.Services.CreateScope()) {var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();(await db.LeaveGrants.SingleAsync(x=>x.Id==SettlementGrantId)).Note="변경";await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.Conflict,(await SettlementPost(s,new(){["expectedSnapshot"]=baseline})).StatusCode);
        using(var scope=s.Leave.Services.CreateScope()) {var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();(await db.LeaveGrants.SingleAsync(x=>x.Id==SettlementGrantId)).ExpiresDate=AppTime.Today.AddDays(-1);await db.SaveChangesAsync();}
        Assert.Equal(HttpStatusCode.Conflict,(await SettlementPost(s,baseline:false,enhanced:false)).StatusCode);Assert.Empty(await SettlementsStored(s));
    }
    [Fact]
    public async Task SettlementUnknownAfterCommitPreservesRecordAndEncodedNativeDraft()
    {
        await using var s=await ApplicationSetup.Create("admin");await SeedSettlement(s);
        using(var scope=s.Leave.Services.CreateScope()) {var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER settlement_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-settlement-canary'); END;");}
        using var response=await SettlementPost(s);Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);var body=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("private-settlement-canary",body);Assert.Equal("unknown",JsonDocument.Parse(body).RootElement.GetProperty("outcome").GetString());Assert.NotNull(Assert.Single(await SettlementsStored(s)).CreatedGrantId);
        using var native=await SettlementPost(s,new(){["expectedEmployeeId"]="wrong",["note"]="<script>window.injected=true</script>",["unlistedSecret"]="must-not-echo"},enhanced:false);
        Assert.Equal(HttpStatusCode.Conflict,native.StatusCode);var html=await native.Content.ReadAsStringAsync();Assert.Contains("data-locked=\"true\"",html);Assert.DoesNotContain("<script>window.injected=true",html);Assert.DoesNotContain("must-not-echo",html);
        var raw=WebUtility.HtmlDecode(Regex.Match(html,"<pre class=\"settlement-raw-draft\">(.*?)</pre>",RegexOptions.Singleline).Groups[1].Value);
        Assert.DoesNotContain("__RequestVerificationToken",raw);Assert.Equal("<script>window.injected=true</script>",JsonDocument.Parse(raw).RootElement.GetProperty("note")[0].GetString());
    }
    [Fact]
    public async Task SettlementNativeAndOptionalReasonPolicyRemainAvailable()
    {
        await using var s=await ApplicationSetup.Create("admin");await SeedSettlement(s);
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"]="false";
        using var response=await SettlementPost(s,new(){["note"]=" "},enhanced:false,baseline:false);Assert.Equal(HttpStatusCode.Redirect,response.StatusCode);Assert.Equal("사유 미입력",Assert.Single(await SettlementsStored(s)).Note);
    }
    [Fact]
    public async Task SettlementRazorUsesCommonControlsAndExportsIsolatedFixture()
    {
        await using var s=await ApplicationSetup.Create("admin");await SeedSettlement(s);
        using(var scope=s.Leave.Services.CreateScope()) {var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();db.LeaveSettlements.Add(new(){EmployeeId=ExternalEmployeeId,SourceGrantId=SettlementGrantId,ProcessedByEmployeeId=long.Parse(s.Owner),ProcessedDate=AppTime.Today,Type=LeaveSettlementType.Compensation,Days=.5m,Note="기존 정산 검증"});await db.SaveChangesAsync();}
        using var response=await s.Client.GetAsync("/Admin/Settlements");response.EnsureSuccessStatusCode();Assert.True(response.Headers.CacheControl?.NoStore);var html=await response.Content.ReadAsStringAsync();
        Assert.Contains("leave-settlements.js",html);Assert.Contains("data-company-picker=\"employee\"",html);Assert.Contains("data-company-local-employee=\""+ExternalEmployeeId+"\"",html);Assert.Contains("cw-data-table",html);Assert.Contains("__RequestVerificationToken",html);Assert.Contains(await SettlementBaseline(s),html);
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"]="false";var optional=await s.Client.GetStringAsync("/Admin/Settlements");Assert.DoesNotContain("required=",Regex.Match(optional,"<textarea[^>]*name=\"note\"[^>]*>").Value);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(string.IsNullOrEmpty(output))return;Directory.CreateDirectory(output);
        await File.WriteAllTextAsync(Path.Combine(output,"leave.settlements.html"),html);await File.WriteAllTextAsync(Path.Combine(output,"leave.settlements.optional.html"),optional);
        await File.WriteAllTextAsync(Path.Combine(output,"leave.settlements.json"),JsonSerializer.Serialize(new{today=AppTime.Today.ToString("yyyy-MM-dd"),actor=s.Owner,employee=ExternalEmployeeId.ToString(),grant=SettlementGrantId.ToString(),context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation")}));
    }
}
