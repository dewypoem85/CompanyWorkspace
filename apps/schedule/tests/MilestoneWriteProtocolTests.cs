using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Schedule;
using Xunit;

public class MilestoneWriteProtocolTests
{
    private static MilestoneInput Input(int version=0,string title="검수 일정") => new(title,new(2026,9,18),10,version,"준비 사항 9007199254740993","review");
    private static async Task<JsonElement> Page(HttpClient client) => await client.GetFromJsonAsync<JsonElement>("/api/milestones?from=2026-09-01&to=2026-09-30&editing=true");
    private static string State(JsonElement page,long? id=null){var editing=page.GetProperty("editing");return id is null?editing.GetProperty("createStateToken").GetString()!:editing.GetProperty("milestones").EnumerateArray().Single(x=>x.GetProperty("id").GetInt64()==id).GetProperty("stateToken").GetString()!;}
    private static async Task<HttpResponseMessage> Send(HttpClient client,HttpMethod method,string path,object body,string? actor,string? state)
    {
        using var request=new HttpRequestMessage(method,path){Content=JsonContent.Create(body)};request.Headers.TryAddWithoutValidation("Accept",TaskWriteProtocol.MediaType);
        if(actor is not null)request.Headers.Add(TaskWriteProtocol.ActorHeader,actor);if(state is not null)request.Headers.Add(MilestoneWriteProtocol.StateHeader,state);return await client.SendAsync(request);
    }
    private static async Task<JsonElement> Envelope(HttpResponseMessage response,HttpStatusCode status,string outcome)
    {
        Assert.Equal(status,response.StatusCode);Assert.Equal(TaskWriteProtocol.MediaType,response.Content.Headers.ContentType?.MediaType);var json=await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("workspace-form-v1",json.GetProperty("protocol").GetString());Assert.Equal(outcome,json.GetProperty("outcome").GetString());return json;
    }

    [Fact] public async Task CreateUpdateDeleteReturnExactCheckedReceipts()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login();var page=await Page(client);Assert.Equal("1",page.GetProperty("editing").GetProperty("actorId").GetString());
        var createState=State(page);var created=(await Envelope(await Send(client,HttpMethod.Post,"/api/milestones",Input(title:"  검수 일정  "),"1",createState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("create",created.GetProperty("operation").GetString());Assert.Equal(createState,created.GetProperty("previousStateToken").GetString());var row=created.GetProperty("milestone");var id=row.GetProperty("id").GetInt64();Assert.Equal("검수 일정",row.GetProperty("title").GetString());Assert.False(created.GetProperty("deleted").GetBoolean());
        page=await Page(client);Assert.Equal(created.GetProperty("stateToken").GetString(),State(page,id));Assert.NotEqual(createState,State(page));
        var updateState=State(page,id);var updated=(await Envelope(await Send(client,HttpMethod.Put,$"/api/milestones/{id}",Input(1,"수정 일정"),"1",updateState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal(2,updated.GetProperty("milestone").GetProperty("version").GetInt32());Assert.Equal("수정 일정",updated.GetProperty("milestone").GetProperty("title").GetString());
        await Envelope(await Send(client,HttpMethod.Put,$"/api/milestones/{id}",Input(1,"오래된 수정"),"1",updateState),HttpStatusCode.Conflict,"conflict");
        page=await Page(client);var deleteState=State(page,id);var deleted=(await Envelope(await Send(client,HttpMethod.Delete,$"/api/milestones/{id}",new{version=2},"1",deleteState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("delete",deleted.GetProperty("operation").GetString());Assert.True(deleted.GetProperty("deleted").GetBoolean());Assert.Equal("수정 일정",deleted.GetProperty("milestone").GetProperty("title").GetString());Assert.Equal(deleted.GetProperty("stateToken").GetString(),State(await Page(client)));
    }

    [Fact] public async Task ActorStateAndPermissionFailuresAreClassifiedBeforeWrite()
    {
        await using var factory=new ScheduleFactory();using var admin=await factory.Login();var state=State(await Page(admin));
        foreach(var actor in new string?[]{null,"2","01"})await Envelope(await Send(admin,HttpMethod.Post,"/api/milestones",Input(),actor,state),HttpStatusCode.Conflict,"conflict");
        foreach(var baseline in new string?[]{null,"bad"})await Envelope(await Send(admin,HttpMethod.Post,"/api/milestones",Input(),"1",baseline),HttpStatusCode.Conflict,"conflict");
        await Envelope(await Send(admin,HttpMethod.Post,"/api/milestones",Input(title:" "),"1",state),HttpStatusCode.UnprocessableEntity,"invalid");
        using var employee=await factory.Login(2);var employeeState=State(await Page(employee));
        var saved=(await Envelope(await Send(employee,HttpMethod.Post,"/api/milestones",Input(title:"직원 등록"),"2",employeeState),HttpStatusCode.OK,"saved")).GetProperty("data").GetProperty("milestone");
        Assert.Equal(2,saved.GetProperty("createdBy").GetInt64());Assert.Equal(2,saved.GetProperty("updatedBy").GetInt64());
    }

    [Fact] public async Task LegacyMilestoneClientsKeepOriginalShapes()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login();var response=await client.PostAsJsonAsync("/api/milestones",Input());response.EnsureSuccessStatusCode();var row=(await response.Content.ReadFromJsonAsync<Milestone>())!;
        var list=await client.GetFromJsonAsync<Milestone[]>("/api/milestones?from=2026-09-01&to=2026-09-30");Assert.Single(list!);
        response=await client.PutAsJsonAsync($"/api/milestones/{row.Id}",Input(row.Version,"기존 수정"));response.EnsureSuccessStatusCode();row=(await response.Content.ReadFromJsonAsync<Milestone>())!;
        response=await client.DeleteAsync($"/api/milestones/{row.Id}?version={row.Version}");Assert.Equal(HttpStatusCode.NoContent,response.StatusCode);
    }
}
