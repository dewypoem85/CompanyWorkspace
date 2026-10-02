using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class TaskActionWriteProtocolTests
{
    private static TaskInput Input(int version = 0) => new("작업 대상", "본문", 2, null, null, null, "planned", version, []);

    private static async Task<WorkItem> Create(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/tasks", Input());
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<WorkItem>())!;
    }

    private static async Task<JsonElement> Detail(HttpClient client, long id) =>
        await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object body,
        string actor, string state, bool comment = false)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Accept", TaskWriteProtocol.MediaType);
        request.Headers.Add(TaskWriteProtocol.ActorHeader, actor);
        request.Headers.Add(comment ? CommentWriteProtocol.TargetStateHeader : TaskWriteProtocol.StateHeader, state);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> Envelope(HttpResponseMessage response, HttpStatusCode status, string outcome)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(TaskWriteProtocol.MediaType, response.Content.Headers.ContentType?.MediaType);
        var root = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("workspace-form-v1", root.GetProperty("protocol").GetString());
        Assert.Equal(outcome, root.GetProperty("outcome").GetString());
        return root;
    }

    [Fact] public async Task ArchiveAndRestoreReturnFullCheckedTaskReceipts()
    {
        await using var f = new ScheduleFactory();
        using var employee = await f.Login(2);
        using var admin = await f.Login();
        var task = await Create(employee);
        var employeeDetail = await Detail(employee, task.Id);
        var archiveState = employeeDetail.GetProperty("editing").GetProperty("stateToken").GetString()!;
        var archive = (await Envelope(await Send(employee, HttpMethod.Post, $"/api/tasks/{task.Id}/archive",
            new VersionInput(1), "2", archiveState), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("archive", archive.GetProperty("operation").GetString());
        Assert.Equal("2", archive.GetProperty("actorId").GetString());
        Assert.Equal(archiveState, archive.GetProperty("previousStateToken").GetString());
        Assert.NotEqual(archiveState, archive.GetProperty("stateToken").GetString());
        Assert.True(archive.GetProperty("task").GetProperty("archived").GetBoolean());
        Assert.Equal(2, archive.GetProperty("task").GetProperty("version").GetInt32());
        Assert.Empty(archive.GetProperty("attachments").EnumerateArray());
        Assert.Equal($"/tasks/{task.Id}", archive.GetProperty("navigateTo").GetString());

        var adminDetail = await Detail(admin, task.Id);
        var restoreState = adminDetail.GetProperty("editing").GetProperty("stateToken").GetString()!;
        var restore = (await Envelope(await Send(admin, HttpMethod.Post, $"/api/tasks/{task.Id}/restore",
            new VersionInput(2), "1", restoreState), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("restore", restore.GetProperty("operation").GetString());
        Assert.Equal("1", restore.GetProperty("actorId").GetString());
        Assert.False(restore.GetProperty("task").GetProperty("archived").GetBoolean());
        Assert.Equal(3, restore.GetProperty("task").GetProperty("version").GetInt32());
    }

    [Fact] public async Task CommentDeleteReturnsDeletedRowAndDetachedAttachmentWhileLegacyStaysNoContent()
    {
        await using var f = new ScheduleFactory();
        using var employee = await f.Login(2);
        var task = await Create(employee);
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=")), "file", "comment.png");
        var image = (await (await employee.PostAsync("/api/images", form)).Content.ReadFromJsonAsync<Attachment>())!;
        var createdResponse = await employee.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("삭제 원문", null, 0, [image.Id]));
        createdResponse.EnsureSuccessStatusCode();
        var comment = (await createdResponse.Content.ReadFromJsonAsync<Comment>())!;
        var detail = await Detail(employee, task.Id);
        var state = detail.GetProperty("commentEditing").GetProperty("comments").EnumerateArray()
            .Single(x => x.GetProperty("id").GetInt64() == comment.Id).GetProperty("stateToken").GetString()!;
        var deleted = (await Envelope(await Send(employee, HttpMethod.Delete,
            $"/api/comments/{comment.Id}?version=1", new VersionInput(1), "2", state, true),
            HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("delete-comment", deleted.GetProperty("operation").GetString());
        Assert.Equal(state, deleted.GetProperty("previousStateToken").GetString());
        Assert.NotEqual(state, deleted.GetProperty("stateToken").GetString());
        Assert.True(deleted.GetProperty("comment").GetProperty("deleted").GetBoolean());
        Assert.Equal("", deleted.GetProperty("comment").GetProperty("body").GetString());
        Assert.Equal(2, deleted.GetProperty("comment").GetProperty("version").GetInt32());
        Assert.Empty(deleted.GetProperty("attachments").EnumerateArray());
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            var detached = await db.Attachments.SingleAsync(x => x.Id == image.Id);
            Assert.Null(detached.TaskId); Assert.Null(detached.CommentId);
        }

        var secondResponse = await employee.PostAsJsonAsync($"/api/tasks/{task.Id}/comments", new CommentInput("레거시", null, 0, []));
        var second = (await secondResponse.Content.ReadFromJsonAsync<Comment>())!;
        var legacy = await employee.DeleteAsync($"/api/comments/{second.Id}?version=1");
        Assert.Equal(HttpStatusCode.NoContent, legacy.StatusCode);
    }

    [Fact] public async Task ActorStateVersionAndPermissionsRejectBeforeWriting()
    {
        await using var f = new ScheduleFactory();
        using var employee = await f.Login(2);
        using var outsider = await f.Login(3);
        var task = await Create(employee);
        var detail = await Detail(employee, task.Id);
        var state = detail.GetProperty("editing").GetProperty("stateToken").GetString()!;
        foreach (var actor in new[] { "", "1", "02" })
            await Envelope(await Send(employee, HttpMethod.Post, $"/api/tasks/{task.Id}/archive",
                new VersionInput(1), actor, state), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(employee, HttpMethod.Post, $"/api/tasks/{task.Id}/archive",
            new VersionInput(1), "2", "bad"), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(employee, HttpMethod.Post, $"/api/tasks/{task.Id}/archive",
            new VersionInput(0), "2", state), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(outsider, HttpMethod.Post, $"/api/tasks/{task.Id}/archive",
            new VersionInput(1), "3", state), HttpStatusCode.Forbidden, "denied");
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        var unchanged = await db.Tasks.SingleAsync(x => x.Id == task.Id);
        Assert.False(unchanged.Archived); Assert.Equal(1, unchanged.Version);
    }
}
