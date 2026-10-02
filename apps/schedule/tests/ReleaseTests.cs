using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Schedule;
using Xunit;

public class ReleaseTests
{
    private static ReleaseInput Input(int number=770, int minor=0) => new(10, number, minor, new(2026, 7, 20), "주요 업데이트\n패치 내역", "stable", "", null, 0);
    private static async Task<ReleaseRecord> Create(HttpClient client, ReleaseInput input) {
        var response=await client.PostAsJsonAsync("/api/releases", input); response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<ReleaseRecord>())!;
    }
    [Fact]
    public async Task BaseVersionsGroupMinorsAndKeepIssueResolutionAndRevisions()
    {
        await using var f=new ScheduleFactory(); using var admin=await f.Login(); using var employee=await f.Login(2);
        (await employee.PostAsJsonAsync("/api/releases",Input(769))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/releases",Input(770,1))).StatusCode);
        var initial=await Create(admin,Input()); var issue=await Create(admin,Input(770,1) with { Status="unstable", Issue="실행 오류" });
        var fixedMinor=await Create(admin,Input(770,2)); var tenth=await Create(admin,Input(770,10));
        var series=await employee.GetFromJsonAsync<JsonElement>("/api/release-series?projectId=10");
        var row=Assert.Single(series.GetProperty("items").EnumerateArray(),item=>item.GetProperty("baseVersion").GetInt32()==770);
        Assert.Equal(770,row.GetProperty("baseVersion").GetInt32()); Assert.Equal(10,row.GetProperty("latest").GetProperty("minor").GetInt32()); Assert.Equal(initial.ReleasedOn.ToString("yyyy-MM-dd"),row.GetProperty("first").GetProperty("releasedOn").GetString());
        var resolved=await admin.PutAsJsonAsync($"/api/releases/{issue.Id}",Input(770,1) with { Version=1, Status="unstable", Issue="실행 오류, 마이너 2에서 해결", ResolvedInId=fixedMinor.Id }); resolved.EnsureSuccessStatusCode();
        var history=await employee.GetFromJsonAsync<JsonElement>($"/api/releases/{issue.Id}/history"); Assert.Equal(2,history.GetProperty("total").GetInt32()); var snapshot = JsonDocument.Parse(history.GetProperty("items")[0].GetProperty("snapshot").GetString()!).RootElement; Assert.Contains("실행 오류", snapshot.GetProperty("issue").GetString()); Assert.Equal(fixedMinor.Id, snapshot.GetProperty("resolvedInId").GetInt64());
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PutAsJsonAsync($"/api/releases/{issue.Id}",Input(770,1) with {Version=1})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PostAsJsonAsync("/api/releases",Input())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PutAsJsonAsync($"/api/releases/{issue.Id}",Input(770,3) with {Version=2})).StatusCode);
        var skipped=await Create(admin,Input(771) with {Status="skipped",Issue="치명적 문제로 전체 버전 건너뜀"});
        var rollback=await Create(admin,Input(772) with {Status="rolled_back",Issue="실행 불가",RollbackTargetId=tenth.Id});
        Assert.Equal("skipped",skipped.Status); Assert.Equal(tenth.Id,rollback.RollbackTargetId);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/releases",Input(773) with {Status="unstable"})).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/releases",Input(773) with {Status="rolled_back",Issue="실패"})).StatusCode);
    }
    [Fact]
    public async Task EditAcknowledgesNormalizedContentAndReadsNeverChangeTheReviewBaseline()
    {
        await using var f=new ScheduleFactory(); using var admin=await f.Login(); using var employee=await f.Login(2);
        var record=await Create(admin,Input() with { Notes="  원문 9223372036854775807  " });
        Assert.Equal(1,record.Version);Assert.Equal(1,record.CreatedBy);Assert.Equal("원문 9223372036854775807",record.Notes);
        var before=await admin.GetFromJsonAsync<ReleaseRecord>($"/api/releases/{record.Id}");
        var historyBefore=await admin.GetFromJsonAsync<JsonElement>($"/api/releases/{record.Id}/history");
        var input=Input() with { Version=record.Version,Notes="  수정 9223372036854775807  ",Issue=" 서버 메모 " };
        var response=await admin.PutAsJsonAsync($"/api/releases/{record.Id}",input);response.EnsureSuccessStatusCode();
        var saved=(await response.Content.ReadFromJsonAsync<ReleaseRecord>())!;
        Assert.Equal(record.Id,saved.Id);Assert.Equal(record.ProjectId,saved.ProjectId);Assert.Equal(record.BaseVersion,saved.BaseVersion);Assert.Equal(record.Minor,saved.Minor);
        Assert.Equal(record.CreatedBy,saved.CreatedBy);Assert.Equal(2,saved.Version);Assert.Equal("수정 9223372036854775807",saved.Notes);Assert.Equal("서버 메모",saved.Issue);Assert.Equal(record.SourceReference,saved.SourceReference);
        Assert.Equal(HttpStatusCode.Conflict,(await admin.PutAsJsonAsync($"/api/releases/{record.Id}",input)).StatusCode);
        var employeeEdit=await employee.PutAsJsonAsync($"/api/releases/{record.Id}",input with {Version=2,Notes="직원 수정"});employeeEdit.EnsureSuccessStatusCode();
        var read=await employee.GetFromJsonAsync<ReleaseRecord>($"/api/releases/{record.Id}");
        var historyAfter=await admin.GetFromJsonAsync<JsonElement>($"/api/releases/{record.Id}/history");
        Assert.Equal(1,before!.Version);Assert.Equal("원문 9223372036854775807",before.Notes);Assert.Equal(3,read!.Version);Assert.Equal("직원 수정",read.Notes);
        Assert.Equal(historyBefore.GetProperty("total").GetInt32()+2,historyAfter.GetProperty("total").GetInt32());
        var snapshot=JsonSerializer.Deserialize<ReleaseRecord>(historyAfter.GetProperty("items")[0].GetProperty("snapshot").GetString()!,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal("직원 수정",snapshot.Notes);Assert.Equal(3,snapshot.Version);
        f.People[0].Access=false;Assert.Equal(HttpStatusCode.Forbidden,(await admin.PutAsJsonAsync($"/api/releases/{record.Id}",input with {Version=3})).StatusCode);
    }
    [Fact]
    public async Task EmployeeEditingAndProjectPrivacyApplyToEveryReleaseEndpoint()
    {
        await using var f=new ScheduleFactory(); using var admin=await f.Login(); using var employee=await f.Login(2);
        var record=await Create(admin,Input()); f.Leads.Add(new(1,2));
        (await employee.PutAsJsonAsync($"/api/releases/{record.Id}",Input() with { Version=1 })).EnsureSuccessStatusCode();
        f.Leads.Clear(); (await employee.PutAsJsonAsync($"/api/releases/{record.Id}",Input() with { Version=2 })).EnsureSuccessStatusCode();
        f.Projects[0].IsPrivate=true;
        foreach (var url in new[]{"/api/releases?projectId=10","/api/release-series?projectId=10",$"/api/releases/{record.Id}",$"/api/releases/{record.Id}/history"}) Assert.Equal(HttpStatusCode.NotFound,(await employee.GetAsync(url)).StatusCode);
        f.Projects[0].Archived=true;
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsJsonAsync("/api/releases",Input(771))).StatusCode);
        (await admin.PutAsJsonAsync($"/api/releases/{record.Id}",Input() with {Version=3,Status="skipped",Issue="이전 기록 정리"})).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task DeleteSupportsBaseAndMinorRecordsWithoutBreakingSeriesOrReferences()
    {
        await using var f=new ScheduleFactory(); using var admin=await f.Login();
        var initial=await Create(admin,Input());
        var issue=await Create(admin,Input(770,1) with {Status="unstable",Issue="수정 전 오류"});
        var fixedMinor=await Create(admin,Input(770,2));
        var linked=(await (await admin.PutAsJsonAsync($"/api/releases/{issue.Id}",Input(770,1) with {Version=1,Status="unstable",Issue="770.2에서 해결",ResolvedInId=fixedMinor.Id})).Content.ReadFromJsonAsync<ReleaseRecord>())!;
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.DeleteAsync($"/api/releases/{initial.Id}?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.DeleteAsync($"/api/releases/{fixedMinor.Id}?version=1")).StatusCode);
        linked=(await (await admin.PutAsJsonAsync($"/api/releases/{issue.Id}",Input(770,1) with {Version=linked.Version,Status="unstable",Issue="연결 해제",ResolvedInId=null})).Content.ReadFromJsonAsync<ReleaseRecord>())!;
        Assert.Equal(HttpStatusCode.Conflict,(await admin.DeleteAsync($"/api/releases/{issue.Id}?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await admin.DeleteAsync($"/api/releases/{fixedMinor.Id}?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await admin.DeleteAsync($"/api/releases/{issue.Id}?version={linked.Version}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await admin.DeleteAsync($"/api/releases/{initial.Id}?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await admin.GetAsync($"/api/releases/{initial.Id}")).StatusCode);
        var series=await admin.GetFromJsonAsync<JsonElement>("/api/release-series?projectId=10");Assert.Equal(0,series.GetProperty("total").GetInt32());
    }
}
