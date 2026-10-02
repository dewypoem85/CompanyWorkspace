using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class PersonalTodoTests
{
    [Fact]
    public async Task CommonWritesBindActorBaselinesAndReturnCompleteAcknowledgements()
    {
        await using var factory = new ScheduleFactory();
        using var owner = await factory.Login(2);
        var editing = await owner.GetFromJsonAsync<JsonElement>("/api/personal-todos/editing?archived=false");
        var state = editing.GetProperty("stateToken").GetString()!;
        Assert.Equal("2", editing.GetProperty("actorId").GetString());
        Assert.Empty(editing.GetProperty("todos").EnumerateArray());

        var created = (await Envelope(await Send(owner, HttpMethod.Post, "/api/personal-todos",
            new PersonalTodoInput("공통 저장 TODO"), state), HttpStatusCode.OK, "saved")).GetProperty("data");
        var todo = created.GetProperty("todo"); var id = todo.GetProperty("id").GetInt64();
        Assert.Equal("add", created.GetProperty("operation").GetString());
        Assert.Equal(state, created.GetProperty("previousStateToken").GetString());
        Assert.Equal("공통 저장 TODO", todo.GetProperty("title").GetString());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("todos").ValueKind);
        Assert.False(created.GetProperty("deleted").GetBoolean());

        editing = await owner.GetFromJsonAsync<JsonElement>($"/api/personal-todos/editing?archived=false&id={id}");
        var rowState = editing.GetProperty("stateToken").GetString()!;
        Assert.Equal(created.GetProperty("stateToken").GetString(), rowState);
        await Envelope(await Send(owner, HttpMethod.Put, $"/api/personal-todos/{id}",
            new PersonalTodoInput("오래된 기준", 1), state), HttpStatusCode.Conflict, "conflict");
        var saved = (await Envelope(await Send(owner, HttpMethod.Put, $"/api/personal-todos/{id}",
            new PersonalTodoInput("수정한 TODO", 1), rowState), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("save", saved.GetProperty("operation").GetString());
        Assert.Equal(2, saved.GetProperty("todo").GetProperty("version").GetInt32());

        rowState = saved.GetProperty("stateToken").GetString()!;
        var completed = (await Envelope(await Send(owner, HttpMethod.Patch, $"/api/personal-todos/{id}/completion",
            new PersonalTodoCompletionInput(true, 2), rowState), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("complete", completed.GetProperty("operation").GetString());
        Assert.NotEqual(JsonValueKind.Null, completed.GetProperty("todo").GetProperty("completedAt").ValueKind);

        editing = await owner.GetFromJsonAsync<JsonElement>($"/api/personal-todos/editing?archived=false&id={id}");
        rowState = editing.GetProperty("stateToken").GetString()!;
        await Envelope(await Send(owner, HttpMethod.Delete, $"/api/personal-todos/{id}?version=3",
            new { version = 999 }, rowState), HttpStatusCode.UnprocessableEntity, "invalid");
        var deleted = (await Envelope(await Send(owner, HttpMethod.Delete, $"/api/personal-todos/{id}?version=3",
            new { version = 3 }, rowState), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("delete", deleted.GetProperty("operation").GetString());
        Assert.True(deleted.GetProperty("deleted").GetBoolean());
        Assert.Equal(id, deleted.GetProperty("todo").GetProperty("id").GetInt64());
        Assert.Empty(deleted.GetProperty("todos").EnumerateArray());
        Assert.Empty((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);
    }

    [Fact]
    public async Task CommonOrderAcknowledgesStoredRowsAndRejectsChangedActorOrList()
    {
        await using var factory = new ScheduleFactory(); using var owner = await factory.Login(2);
        var first = await Create(owner, "첫 TODO"); var second = await Create(owner, "둘째 TODO");
        var editing = await owner.GetFromJsonAsync<JsonElement>("/api/personal-todos/editing?archived=false");
        var state = editing.GetProperty("stateToken").GetString()!;
        await Envelope(await Send(owner, HttpMethod.Put, "/api/personal-todos/order",
            new PersonalTodoOrderInput([second.Id, first.Id], false), state, actor: "1"), HttpStatusCode.Conflict, "conflict");
        var ordered = (await Envelope(await Send(owner, HttpMethod.Put, "/api/personal-todos/order",
            new PersonalTodoOrderInput([second.Id, first.Id], false), state), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal([second.Id, first.Id], ordered.GetProperty("todos").EnumerateArray().Select(x => x.GetProperty("id").GetInt64()));
        Assert.Equal([1L, 2L], ordered.GetProperty("todos").EnumerateArray().Select(x => x.GetProperty("sortOrder").GetInt64()));
        await Envelope(await Send(owner, HttpMethod.Put, "/api/personal-todos/order",
            new PersonalTodoOrderInput([first.Id, second.Id], false), state), HttpStatusCode.Conflict, "conflict");
    }

    [Fact]
    public async Task TodoMutationsRejectStaleVersionsForeignIdsAndRevokedAccess()
    {
        await using var factory = new ScheduleFactory();
        using var owner = await factory.Login(2);
        using var admin = await factory.Login(1);
        var item = await Create(owner, "원문 9223372036854775807");
        var other = await Create(admin, "관리자의 개인 TODO");
        var response = await owner.PutAsJsonAsync($"/api/personal-todos/{item.Id}", new PersonalTodoInput("수정한 원문", item.Version));
        response.EnsureSuccessStatusCode();
        var saved = (await response.Content.ReadFromJsonAsync<PersonalTodo>())!;
        Assert.Equal(item.Id, saved.Id); Assert.Equal(item.OwnerId, saved.OwnerId); Assert.Equal(item.CreatedAt, saved.CreatedAt);
        Assert.Equal(item.Version + 1, saved.Version); Assert.Equal("수정한 원문", saved.Title);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.DeleteAsync($"/api/personal-todos/{item.Id}?version={item.Version}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PatchAsJsonAsync($"/api/personal-todos/{item.Id}/completion", new PersonalTodoCompletionInput(true, item.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync("/api/personal-todos/order", new PersonalTodoOrderInput([other.Id], false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync("/api/personal-todos/order", new PersonalTodoOrderInput([item.Id, item.Id], false))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/personal-todos/{item.Id}?version={saved.Version}")).StatusCode);
        Assert.Single((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);
        factory.People.Single(person => person.Id == 2).Access = false;
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.DeleteAsync($"/api/personal-todos/{item.Id}?version={saved.Version}")).StatusCode);
        factory.People.Single(person => person.Id == 2).Access = true;
        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/personal-todos/{item.Id}?version={saved.Version}")).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);
        Assert.Single((await admin.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);
    }

    [Fact]
    public async Task TodosAreAccountOnlyEditableSortableAndAutomaticallyArchived()
    {
        await using var factory = new ScheduleFactory();
        using var owner = await factory.Login(2);
        using var coworker = await factory.Login(3);
        using var admin = await factory.Login(1);

        var first = await Create(owner, "첫 번째 개인 할 일");
        var second = await Create(owner, "두 번째 개인 할 일");
        Assert.Equal(2, first.OwnerId);
        Assert.Equal(2, (await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!.Length);
        Assert.Empty((await coworker.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);
        Assert.Empty((await admin.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!);

        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"/api/personal-todos/{first.Id}", new PersonalTodoInput("관리자 수정", first.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PatchAsJsonAsync($"/api/personal-todos/{first.Id}/completion", new PersonalTodoCompletionInput(true, first.Version))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.DeleteAsync($"/api/personal-todos/{first.Id}?version={first.Version}")).StatusCode);

        (await owner.PutAsJsonAsync("/api/personal-todos/order", new PersonalTodoOrderInput([second.Id, first.Id], false))).EnsureSuccessStatusCode();
        Assert.Equal([second.Id, first.Id], (await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!.Select(x => x.Id));
        var renamedResponse = await owner.PutAsJsonAsync($"/api/personal-todos/{first.Id}", new PersonalTodoInput("수정한 개인 할 일", first.Version));
        renamedResponse.EnsureSuccessStatusCode(); var renamed = (await renamedResponse.Content.ReadFromJsonAsync<PersonalTodo>())!;

        var before = DateTime.UtcNow;
        var completeResponse = await owner.PatchAsJsonAsync($"/api/personal-todos/{first.Id}/completion", new PersonalTodoCompletionInput(true, renamed.Version));
        completeResponse.EnsureSuccessStatusCode(); var completed = (await completeResponse.Content.ReadFromJsonAsync<PersonalTodo>())!;
        Assert.NotNull(completed.CompletedAt); Assert.InRange(completed.CompletedAt!.Value, before, DateTime.UtcNow);
        Assert.Contains((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!, x => x.Id == first.Id);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            var stored = await db.PersonalTodos.SingleAsync(x => x.Id == first.Id);
            stored.CompletedAt = DateTime.UtcNow.AddDays(-3).AddSeconds(-1);
            await db.SaveChangesAsync();
        }

        Assert.DoesNotContain((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!, x => x.Id == first.Id);
        var archive = (await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos?archived=true"))!;
        Assert.Single(archive); Assert.Equal(first.Id, archive[0].Id);
        Assert.Empty((await admin.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos?archived=true"))!);

        var archiveEdit = await owner.PutAsJsonAsync($"/api/personal-todos/{first.Id}", new PersonalTodoInput("보관함에서도 수정", completed.Version));
        archiveEdit.EnsureSuccessStatusCode(); var edited = (await archiveEdit.Content.ReadFromJsonAsync<PersonalTodo>())!;
        (await owner.PatchAsJsonAsync($"/api/personal-todos/{first.Id}/completion", new PersonalTodoCompletionInput(false, edited.Version))).EnsureSuccessStatusCode();
        Assert.Empty((await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos?archived=true"))!);
        Assert.Equal(2, (await owner.GetFromJsonAsync<PersonalTodo[]>("/api/personal-todos"))!.Length);
    }

    private static async Task<PersonalTodo> Create(HttpClient client, string title)
    {
        var response = await client.PostAsJsonAsync("/api/personal-todos", new PersonalTodoInput(title));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PersonalTodo>())!;
    }

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path,
        object input, string state, string actor = "2")
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(input) };
        request.Headers.TryAddWithoutValidation("Accept", TaskWriteProtocol.MediaType);
        request.Headers.Add(TaskWriteProtocol.ActorHeader, actor);
        request.Headers.Add(PersonalTodoWriteProtocol.StateHeader, state);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> Envelope(HttpResponseMessage response, HttpStatusCode status, string outcome)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(TaskWriteProtocol.MediaType, response.Content.Headers.ContentType?.MediaType);
        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("workspace-form-v1", json.GetProperty("protocol").GetString());
        Assert.Equal(outcome, json.GetProperty("outcome").GetString());
        Assert.False(string.IsNullOrWhiteSpace(json.GetProperty("message").GetString()));
        return json;
    }
}
