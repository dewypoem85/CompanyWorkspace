using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class CommentWriteProtocolTests
{
    private static TaskInput TaskInput() => new("댓글 계약 업무", "본문", 2, 10, null, null, "planned", 0, []);

    private static async Task<long> CreateTask(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/tasks", TaskInput()); response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<WorkItem>())!.Id;
    }

    private static async Task<JsonElement> Detail(HttpClient client, long id) =>
        await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path,
        CommentInput input, string? actor, string? state)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(input) };
        request.Headers.TryAddWithoutValidation("Accept", TaskWriteProtocol.MediaType);
        if (actor is not null) request.Headers.Add(TaskWriteProtocol.ActorHeader, actor);
        if (state is not null) request.Headers.Add(CommentWriteProtocol.TargetStateHeader, state);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> Envelope(HttpResponseMessage response, HttpStatusCode status, string outcome)
    {
        Assert.Equal(status, response.StatusCode);Assert.Equal(TaskWriteProtocol.MediaType, response.Content.Headers.ContentType?.MediaType);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("workspace-form-v1", json.GetProperty("protocol").GetString());
        Assert.Equal(outcome, json.GetProperty("outcome").GetString());Assert.False(string.IsNullOrWhiteSpace(json.GetProperty("message").GetString()));return json;
    }

    private static string State(JsonElement detail, long? commentId = null)
    {
        var editing = detail.GetProperty("commentEditing");
        if (!commentId.HasValue) return editing.GetProperty("createStateToken").GetString()!;
        return editing.GetProperty("comments").EnumerateArray().Single(x => x.GetProperty("id").GetInt64() == commentId).GetProperty("stateToken").GetString()!;
    }

    private static async Task<string> Upload(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=")), "file", "댓글.png");
        var response = await client.PostAsync("/api/images", form);response.EnsureSuccessStatusCode();return (await response.Content.ReadFromJsonAsync<Attachment>())!.Id;
    }

    [Fact] public async Task CreateReplyAndUpdateReturnFullCheckedReceipts()
    {
        await using var f = new ScheduleFactory();using var client = await f.Login(2);var taskId = await CreateTask(client);
        var detail = await Detail(client, taskId);Assert.Equal("2", detail.GetProperty("commentEditing").GetProperty("actorId").GetString());
        var root = State(detail);var created = (await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("  첫 댓글 9007199254740993  ",null,0,[]),"2",root),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("create",created.GetProperty("operation").GetString());Assert.Equal("2",created.GetProperty("actorId").GetString());Assert.Equal(root,created.GetProperty("previousStateToken").GetString());
        var comment = created.GetProperty("comment");var id = comment.GetProperty("id").GetInt64();Assert.Equal("첫 댓글 9007199254740993",comment.GetProperty("body").GetString());Assert.Equal(1,comment.GetProperty("version").GetInt32());Assert.Empty(created.GetProperty("attachments").EnumerateArray());
        detail = await Detail(client,taskId);Assert.Equal(created.GetProperty("stateToken").GetString(),State(detail,id));Assert.NotEqual(root,State(detail));
        await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("오래된 생성",null,0,[]),"2",root),HttpStatusCode.Conflict,"conflict");
        var replyState=State(detail,id);var reply=(await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("답글",id,0,[]),"2",replyState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("reply",reply.GetProperty("operation").GetString());Assert.Equal(id,reply.GetProperty("comment").GetProperty("parentId").GetInt64());
        await Envelope(await Send(client,HttpMethod.Put,$"/api/comments/{id}",new("오래된 수정",null,1,[]),"2",replyState),HttpStatusCode.Conflict,"conflict");
        detail=await Detail(client,taskId);var updateState=State(detail,id);Assert.NotEqual(replyState,updateState);
        var updated=(await Envelope(await Send(client,HttpMethod.Put,$"/api/comments/{id}",new("수정 댓글",null,1,[]),"2",updateState),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("update",updated.GetProperty("operation").GetString());Assert.Equal(2,updated.GetProperty("comment").GetProperty("version").GetInt32());Assert.Equal("수정 댓글",updated.GetProperty("comment").GetProperty("body").GetString());Assert.NotEqual(replyState,updated.GetProperty("stateToken").GetString());
    }

    [Fact] public async Task LegacyClientsKeepBareCommentResponses()
    {
        await using var f = new ScheduleFactory();using var client = await f.Login(2);var taskId=await CreateTask(client);
        var response=await client.PostAsJsonAsync($"/api/tasks/{taskId}/comments",new CommentInput("기존",null,0,[]));response.EnsureSuccessStatusCode();
        Assert.Equal("application/json",response.Content.Headers.ContentType?.MediaType);var comment=(await response.Content.ReadFromJsonAsync<Comment>())!;
        response=await client.PutAsJsonAsync($"/api/comments/{comment.Id}",new CommentInput("기존 수정",null,1,[]));response.EnsureSuccessStatusCode();Assert.Equal(2,(await response.Content.ReadFromJsonAsync<Comment>())!.Version);
    }

    [Fact] public async Task ActorStateVersionAndAttachmentBaselinesAreRequired()
    {
        await using var f = new ScheduleFactory();using var client=await f.Login(2);var taskId=await CreateTask(client);var detail=await Detail(client,taskId);var root=State(detail);
        foreach(var actor in new string?[]{null,"1","02"})await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("댓글",null,0,[]),actor,root),HttpStatusCode.Conflict,"conflict");
        foreach(var state in new string?[]{null,"bad"})await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("댓글",null,0,[]),"2",state),HttpStatusCode.Conflict,"conflict");
        await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("댓글",null,1,[]),"2",root),HttpStatusCode.Conflict,"conflict");
        var image=await Upload(client);var created=(await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("첨부",null,0,[image]),"2",root),HttpStatusCode.OK,"saved")).GetProperty("data");
        var attachment=Assert.Single(created.GetProperty("attachments").EnumerateArray());Assert.Equal(image,attachment.GetProperty("id").GetString());Assert.Equal(taskId,attachment.GetProperty("taskId").GetInt64());Assert.Equal(created.GetProperty("comment").GetProperty("id").GetInt64(),attachment.GetProperty("commentId").GetInt64());Assert.Equal(2,attachment.GetProperty("ownerId").GetInt64());Assert.Equal("image/png",attachment.GetProperty("contentType").GetString());
        using(var scope=f.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<ScheduleDb>();(await db.Attachments.SingleAsync(x=>x.Id==image)).Name="다른 이름.png";await db.SaveChangesAsync();}
        var id=created.GetProperty("comment").GetProperty("id").GetInt64();await Envelope(await Send(client,HttpMethod.Put,$"/api/comments/{id}",new("수정",null,1,[image]),"2",created.GetProperty("stateToken").GetString()),HttpStatusCode.Conflict,"conflict");
    }

    [Fact] public async Task PreWriteRejectionAndPostWriteUncertaintyStayDistinct()
    {
        await using var f = new ScheduleFactory();using var client=await f.Login(2);var taskId=await CreateTask(client);var root=State(await Detail(client,taskId));
        await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new(" ",null,0,[]),"2",root),HttpStatusCode.UnprocessableEntity,"invalid");
        var failed=await Envelope(await Send(client,HttpMethod.Post,$"/api/tasks/{taskId}/comments",new("첨부 실패",null,0,["missing"]),"2",root),HttpStatusCode.InternalServerError,"unknown");Assert.DoesNotContain("다시 시도",failed.GetProperty("message").GetString());
        using var scope=f.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<ScheduleDb>();Assert.Empty(await db.Comments.ToListAsync());
    }
}
