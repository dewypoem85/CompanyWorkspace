using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Schedule;
using Xunit;

public class ReleaseWriteProtocolTests
{
    private static ReleaseInput Input(int version=0,string notes="패치 9223372036854775807") =>
        new(10, 880, 0, new(2026, 9, 12), notes, "stable", "", null, version);

    private static async Task<JsonElement> Editing(HttpClient client,long? id=null)
    {
        var path="/api/releases/editing?projectId=10"+(id.HasValue?$"&id={id}":"");
        return await client.GetFromJsonAsync<JsonElement>(path);
    }

    private static async Task<HttpResponseMessage> Send(HttpClient client,HttpMethod method,string path,object body,string? actor,string? state)
    {
        using var request=new HttpRequestMessage(method,path){Content=JsonContent.Create(body)};
        request.Headers.TryAddWithoutValidation("Accept",TaskWriteProtocol.MediaType);
        if(actor is not null)request.Headers.Add(TaskWriteProtocol.ActorHeader,actor);
        if(state is not null)request.Headers.Add(ReleaseWriteProtocol.StateHeader,state);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> Envelope(HttpResponseMessage response,HttpStatusCode status,string outcome)
    {
        Assert.Equal(status,response.StatusCode);Assert.Equal(TaskWriteProtocol.MediaType,response.Content.Headers.ContentType?.MediaType);
        var json=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("workspace-form-v1",json.GetProperty("protocol").GetString());
        Assert.Equal(outcome,json.GetProperty("outcome").GetString());return json;
    }

    [Fact] public async Task CreateAndUpdateReturnCompleteCheckedReceipts()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login();
        var editing=await Editing(client);Assert.Equal("1",editing.GetProperty("actorId").GetString());Assert.Equal(JsonValueKind.Null,editing.GetProperty("record").ValueKind);
        var createState=editing.GetProperty("stateToken").GetString()!;
        var created=(await Envelope(await Send(client,HttpMethod.Post,"/api/releases",Input(notes:"  신규 패치 9223372036854775807  "),"1",createState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("create",created.GetProperty("operation").GetString());Assert.Equal("1",created.GetProperty("actorId").GetString());Assert.Equal(createState,created.GetProperty("previousStateToken").GetString());
        var row=created.GetProperty("release");var id=row.GetProperty("id").GetInt64();Assert.Equal("신규 패치 9223372036854775807",row.GetProperty("notes").GetString());Assert.Equal(1,row.GetProperty("version").GetInt32());
        editing=await Editing(client,id);Assert.Equal(created.GetProperty("stateToken").GetString(),editing.GetProperty("stateToken").GetString());Assert.Equal(id,editing.GetProperty("record").GetProperty("id").GetInt64());
        var updateState=editing.GetProperty("stateToken").GetString()!;
        var updated=(await Envelope(await Send(client,HttpMethod.Put,$"/api/releases/{id}",Input(1,"수정 패치"),"1",updateState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("update",updated.GetProperty("operation").GetString());Assert.Equal(updateState,updated.GetProperty("previousStateToken").GetString());Assert.Equal(2,updated.GetProperty("release").GetProperty("version").GetInt32());Assert.Equal("수정 패치",updated.GetProperty("release").GetProperty("notes").GetString());
        await Envelope(await Send(client,HttpMethod.Put,$"/api/releases/{id}",Input(1,"오래된 수정"),"1",updateState),HttpStatusCode.Conflict,"conflict");
        editing=await Editing(client,id);var deleteState=editing.GetProperty("stateToken").GetString()!;
        var deleted=(await Envelope(await Send(client,HttpMethod.Delete,$"/api/releases/{id}",new {version=2},"1",deleteState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("delete",deleted.GetProperty("operation").GetString());Assert.True(deleted.GetProperty("deleted").GetBoolean());Assert.Equal(id,deleted.GetProperty("release").GetProperty("id").GetInt64());Assert.Equal(2,deleted.GetProperty("release").GetProperty("version").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/releases/{id}")).StatusCode);
    }

    [Fact] public async Task ActorAndStateValidationFailBeforeWriteWhileEmployeesCanEdit()
    {
        await using var factory=new ScheduleFactory();using var admin=await factory.Login();var state=(await Editing(admin)).GetProperty("stateToken").GetString()!;
        foreach(var actor in new string?[]{null,"2","01"})await Envelope(await Send(admin,HttpMethod.Post,"/api/releases",Input(),actor,state),HttpStatusCode.Conflict,"conflict");
        foreach(var baseline in new string?[]{null,"bad"})await Envelope(await Send(admin,HttpMethod.Post,"/api/releases",Input(),"1",baseline),HttpStatusCode.Conflict,"conflict");
        await Envelope(await Send(admin,HttpMethod.Post,"/api/releases",Input(notes:" "),"1",state),HttpStatusCode.UnprocessableEntity,"invalid");
        using var employee=await factory.Login(2);var employeeState=(await Editing(employee)).GetProperty("stateToken").GetString()!;
        await Envelope(await Send(employee,HttpMethod.Post,"/api/releases",Input(),"2",employeeState),HttpStatusCode.OK,"saved");
    }

    [Fact] public async Task LegacyReleaseClientsKeepBareRecordResponses()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login();var response=await client.PostAsJsonAsync("/api/releases",Input());response.EnsureSuccessStatusCode();
        var row=(await response.Content.ReadFromJsonAsync<ReleaseRecord>())!;Assert.Equal(1,row.Version);Assert.Equal("패치 9223372036854775807",row.Notes);
        response=await client.PutAsJsonAsync($"/api/releases/{row.Id}",Input(row.Version,"기존 수정"));response.EnsureSuccessStatusCode();row=(await response.Content.ReadFromJsonAsync<ReleaseRecord>())!;Assert.Equal(2,row.Version);
        response=await client.DeleteAsync($"/api/releases/{row.Id}?version={row.Version}");Assert.Equal(HttpStatusCode.NoContent,response.StatusCode);
    }
}
