using System.Net;
using System.Data.Common;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class TaskWriteProtocolTests
{
    [Fact] public void FingerprintCoversEveryTaskAndBodyAttachmentFieldAndIgnoresCommentAttachments()
    {
        var task = new WorkItem { Id = 7, Title = "업무", Body = "원문", AssigneeId = 2, CreatedBy = 1,
            ProjectId = 10, StartDate = new(2026, 1, 1), EndDate = new(2026, 1, 2) };
        var attachment = new Attachment { Id = "image-a", TaskId = 7, OwnerId = 2, ContentType = "image/png", Name = "사진", Size = 68 };
        var original = TaskWriteProtocol.StateToken(task, [attachment]);
        Assert.Matches("^[a-f0-9]{64}$", original);
        foreach (var property in typeof(WorkItem).GetProperties())
        {
            var changed = JsonSerializer.Deserialize<WorkItem>(JsonSerializer.Serialize(task))!;
            property.SetValue(changed, Different(property.GetValue(changed)));
            Assert.NotEqual(original, TaskWriteProtocol.StateToken(changed, [attachment]));
        }
        foreach (var property in typeof(Attachment).GetProperties().Where(x => x.Name is not nameof(Attachment.FeedbackId) and not nameof(Attachment.FeedbackCommentId)))
        {
            var changed = JsonSerializer.Deserialize<Attachment>(JsonSerializer.Serialize(attachment))!;
            property.SetValue(changed, Different(property.GetValue(changed)));
            Assert.NotEqual(original, TaskWriteProtocol.StateToken(task, [changed]));
        }
        attachment.FeedbackId = 42;
        attachment.FeedbackCommentId = 43;
        Assert.Equal(original, TaskWriteProtocol.StateToken(task, [attachment]));
        var commentImage = new Attachment { Id = "comment", TaskId = 7, CommentId = 99 };
        Assert.Equal(original, TaskWriteProtocol.StateToken(task, [attachment, commentImage]));
        var second = new Attachment { Id = "image-b", TaskId = 7 };
        Assert.Equal(TaskWriteProtocol.StateToken(task, [attachment, second]), TaskWriteProtocol.StateToken(task, [second, attachment]));
        task.CreatedAt = DateTime.SpecifyKind(task.CreatedAt, DateTimeKind.Unspecified);
        task.UpdatedAt = DateTime.SpecifyKind(task.UpdatedAt, DateTimeKind.Unspecified);
        attachment.CreatedAt = DateTime.SpecifyKind(attachment.CreatedAt, DateTimeKind.Unspecified);
        Assert.Equal(original, TaskWriteProtocol.StateToken(task, [attachment]));
    }

    private static object Different(object? value) => value switch
    {
        null => 1L, string text => text + "changed", long id => id + 1, int version => version + 1,
        bool boolean => !boolean, DateOnly date => date.AddDays(1), DateTime stamp => stamp.AddTicks(1),
        _ => throw new InvalidOperationException("Add fingerprint coverage for the new field type.")
    };

    private static TaskInput Input(int version = 0) => new("  저장 계약  ", "  JSON 원문 {\"n\":9223372036854775807}  ",
        2, 10, new(2026, 9, 7), new(2026, 9, 8), "planned", version, [], new GoalSelection(null));

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path,
        object input, string? actor = "2", string? state = null, string? accept = TaskWriteProtocol.MediaType)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(input) };
        if (accept != null) request.Headers.TryAddWithoutValidation("Accept", accept);
        if (actor != null) request.Headers.Add(TaskWriteProtocol.ActorHeader, actor);
        if (state != null) request.Headers.Add(TaskWriteProtocol.StateHeader, state);
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

    private static async Task<JsonElement> Create(HttpClient client, TaskInput? input = null) =>
        (await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", input ?? Input()), HttpStatusCode.OK, "saved")).GetProperty("data");

    private static async Task<string> Upload(HttpClient client)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=")), "file", "이미지.png");
        var response = await client.PostAsync("/api/images", form);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Attachment>())!.Id;
    }

    [Fact] public async Task CreateUpdateAndStatusConfirmFullTaskAttachmentsActorAndBaselines()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        var image = await Upload(client);
        var created = await Create(client, Input() with { AttachmentIds = [image, image] });
        var task = created.GetProperty("task"); var id = task.GetProperty("id").GetInt64();
        Assert.Equal("create", created.GetProperty("operation").GetString());
        Assert.Equal("2", created.GetProperty("actorId").GetString());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("previousStateToken").ValueKind);
        Assert.Equal($"/tasks/{id}", created.GetProperty("navigateTo").GetString());
        Assert.Equal("저장 계약", task.GetProperty("title").GetString());
        Assert.Equal("JSON 원문 {\"n\":9223372036854775807}", task.GetProperty("body").GetString());
        Assert.Equal(2, task.GetProperty("createdBy").GetInt64());
        Assert.Equal(10, task.GetProperty("projectId").GetInt64());
        Assert.Equal("2026-09-07", task.GetProperty("startDate").GetString());
        Assert.False(task.TryGetProperty("actualStartDate", out _));
        Assert.False(task.TryGetProperty("actualEndDate", out _));
        Assert.Equal(1, task.GetProperty("version").GetInt32());
        var attachment = Assert.Single(created.GetProperty("attachments").EnumerateArray());
        Assert.Equal(image, attachment.GetProperty("id").GetString());
        Assert.Equal(id, attachment.GetProperty("taskId").GetInt64());
        Assert.Equal(2, attachment.GetProperty("ownerId").GetInt64());
        Assert.Equal(JsonValueKind.Null, attachment.GetProperty("commentId").ValueKind);
        Assert.Equal("image/png", attachment.GetProperty("contentType").GetString());
        Assert.True(attachment.GetProperty("size").GetInt64() > 0);
        var before = created.GetProperty("stateToken").GetString()!;
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");
        Assert.Equal(before, detail.GetProperty("editing").GetProperty("stateToken").GetString());
        Assert.Equal("2", detail.GetProperty("editing").GetProperty("actorId").GetString());

        // Discussion is not part of the task-edit baseline and must not be overwritten.
        (await client.PostAsJsonAsync($"/api/tasks/{id}/comments", new CommentInput("댓글 유지", null, 0, []))).EnsureSuccessStatusCode();
        var replacement = await Upload(client);
        var updated = (await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}",
            Input(1) with { Title = "수정", AttachmentIds = [replacement] }, state: before), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("update", updated.GetProperty("operation").GetString());
        Assert.Equal(before, updated.GetProperty("previousStateToken").GetString());
        Assert.NotEqual(before, updated.GetProperty("stateToken").GetString());
        Assert.Equal(replacement, Assert.Single(updated.GetProperty("attachments").EnumerateArray()).GetProperty("id").GetString());
        Assert.False(updated.GetProperty("task").TryGetProperty("actualStartDate", out _));
        Assert.False(updated.GetProperty("task").TryGetProperty("actualEndDate", out _));
        var next = updated.GetProperty("stateToken").GetString()!;
        var changed = (await Envelope(await Send(client, HttpMethod.Patch, $"/api/tasks/{id}/status",
            new StatusInput("done", 2), state: next), HttpStatusCode.OK, "saved")).GetProperty("data");
        Assert.Equal("status", changed.GetProperty("operation").GetString());
        Assert.Equal(next, changed.GetProperty("previousStateToken").GetString());
        Assert.Equal("done", changed.GetProperty("task").GetProperty("status").GetString());
        Assert.Equal(3, changed.GetProperty("task").GetProperty("version").GetInt32());
        Assert.Equal(updated.GetProperty("attachments").GetRawText(), changed.GetProperty("attachments").GetRawText());
        foreach (var property in updated.GetProperty("task").EnumerateObject())
            if (property.Name is not ("status" or "version" or "updatedAt"))
                Assert.Equal(property.Value.GetRawText(), changed.GetProperty("task").GetProperty(property.Name).GetRawText());
        detail = await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");
        Assert.Equal(changed.GetProperty("stateToken").GetString(), detail.GetProperty("editing").GetProperty("stateToken").GetString());
        Assert.Single(detail.GetProperty("comments").EnumerateArray());
        Assert.Equal(4, detail.GetProperty("history").GetArrayLength());
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Null((await db.Attachments.SingleAsync(x => x.Id == image)).TaskId);
    }

    [Theory]
    [InlineData(TaskWriteProtocol.MediaType + ";charset=utf-8")]
    [InlineData("application/json, " + TaskWriteProtocol.MediaType + ";q=0.8")]
    public async Task ExplicitMediaTypeSupportsParametersAndMultipleAcceptValues(string accept)
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input(), accept: accept), HttpStatusCode.OK, "saved");
    }

    [Theory]
    [InlineData(null)] [InlineData("application/json")] [InlineData("*/*")]
    [InlineData(TaskWriteProtocol.MediaType + ";q=0, application/json")]
    public async Task LegacyClientsKeepUnwrappedTaskResponses(string? accept)
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        var response = await Send(client, HttpMethod.Post, "/api/tasks", Input(), actor: null, accept: accept);
        response.EnsureSuccessStatusCode();
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var task = (await response.Content.ReadFromJsonAsync<WorkItem>())!;
        response = await Send(client, HttpMethod.Put, $"/api/tasks/{task.Id}", Input(1), actor: null, accept: accept);
        response.EnsureSuccessStatusCode();
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<WorkItem>())!.Version);
        response = await Send(client, HttpMethod.Patch, $"/api/tasks/{task.Id}/status", new StatusInput("done", 2), actor: null, accept: accept);
        response.EnsureSuccessStatusCode();
        Assert.Equal("done", (await response.Content.ReadFromJsonAsync<WorkItem>())!.Status);
    }

    [Theory] [InlineData(null)] [InlineData("1")] [InlineData("02")]
    public async Task MissingOrChangedActorCannotCreateOrModify(string? actor)
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input(), actor), HttpStatusCode.Conflict, "conflict");
        var created = await Create(client); var id = created.GetProperty("task").GetProperty("id").GetInt64();
        var state = created.GetProperty("stateToken").GetString();
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(1), actor, state), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(client, HttpMethod.Patch, $"/api/tasks/{id}/status", new StatusInput("done", 1), actor, state), HttpStatusCode.Conflict, "conflict");
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Single(await db.Tasks.ToListAsync()); Assert.Equal(1, (await db.Tasks.SingleAsync()).Version);
    }

    [Fact] public async Task BaselineIncludesAttachmentsAndRejectsStaleVersionsAndOtherTasks()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        var image = await Upload(client); var created = await Create(client, Input() with { AttachmentIds = [image] });
        var other = await Create(client);
        var id = created.GetProperty("task").GetProperty("id").GetInt64(); var state = created.GetProperty("stateToken").GetString();
        foreach (var baseline in new[] { null, "bad", other.GetProperty("stateToken").GetString() })
            await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(1), state: baseline), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(0), state: state), HttpStatusCode.Conflict, "conflict");
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            (await db.Attachments.SingleAsync(x => x.Id == image)).Name = "별도 변경.png";
            await db.SaveChangesAsync();
        }
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(1), state: state), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(client, HttpMethod.Patch, $"/api/tasks/{id}/status", new StatusInput("done", 1), state: state), HttpStatusCode.Conflict, "conflict");
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");
        Assert.Equal(1, detail.GetProperty("task").GetProperty("version").GetInt32());
        Assert.NotEqual(state, detail.GetProperty("editing").GetProperty("stateToken").GetString());
    }

    [Fact] public async Task PreWriteValidationAndPermissionRemainDistinctFromUnconfirmedWrites()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2); using var outsider = await f.Login(3);
        await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input() with { Title = " " }), HttpStatusCode.UnprocessableEntity, "invalid");
        await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input(1)), HttpStatusCode.Conflict, "conflict");
        await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input(), state: "old"), HttpStatusCode.Conflict, "conflict");
        var created = await Create(client); var id = created.GetProperty("task").GetProperty("id").GetInt64();
        var state = created.GetProperty("stateToken").GetString();
        await Envelope(await Send(outsider, HttpMethod.Put, $"/api/tasks/{id}", Input(1), "3", state), HttpStatusCode.Forbidden, "denied");
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(1) with { AttachmentIds = ["missing"] }, state: state), HttpStatusCode.UnprocessableEntity, "invalid");
        // Create has to allocate an ID before binding images; its post-write failure is
        // conservative even though this particular SQLite transaction rolls back.
        var failed = await Envelope(await Send(client, HttpMethod.Post, "/api/tasks", Input() with { AttachmentIds = ["missing"] }), HttpStatusCode.InternalServerError, "unknown");
        Assert.DoesNotContain("다시 시도", failed.GetProperty("message").GetString());
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Single(await db.Tasks.ToListAsync()); Assert.Single(await db.Changes.ToListAsync());
        Assert.Equal(1, (await db.Tasks.SingleAsync()).Version);
    }

    [Fact] public async Task AuthenticationCsrfPrivacyAndArchivedRulesCannotBeBypassedByEnvelopeHeaders()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2); using var admin = await f.Login();
        using var anonymous = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(anonymous, HttpMethod.Post, "/api/tasks", Input())).StatusCode);
        var created = await Create(client); var id = created.GetProperty("task").GetProperty("id").GetInt64();
        var state = created.GetProperty("stateToken").GetString();
        (await client.PostAsJsonAsync($"/api/tasks/{id}/archive", new VersionInput(1))).EnsureSuccessStatusCode();
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(2), state: state), HttpStatusCode.Conflict, "conflict");
        f.Projects[0].IsPrivate = true;
        await Envelope(await Send(client, HttpMethod.Put, $"/api/tasks/{id}", Input(2), state: state), HttpStatusCode.NotFound, "unknown");
        admin.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(admin, HttpMethod.Post, "/api/tasks", Input(), "1")).StatusCode);
        f.People.Single(x => x.Id == 2).Active = false;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, "/api/tasks", Input())).StatusCode);
    }

    [Fact] public async Task ConcurrentWritersCannotBothUseTheSameBaseline()
    {
        await using var f = new ScheduleFactory(); using var a = await f.Login(2); using var b = await f.Login(2);
        var created = await Create(a); var id = created.GetProperty("task").GetProperty("id").GetInt64();
        var state = created.GetProperty("stateToken").GetString();
        var responses = await Task.WhenAll(Send(a, HttpMethod.Put, $"/api/tasks/{id}", Input(1), state: state),
            Send(b, HttpMethod.Patch, $"/api/tasks/{id}/status", new StatusInput("done", 1), state: state));
        await Envelope(Assert.Single(responses, x => x.StatusCode == HttpStatusCode.OK), HttpStatusCode.OK, "saved");
        await Envelope(Assert.Single(responses, x => x.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict, "conflict");
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Equal(2, (await db.Tasks.SingleAsync()).Version); Assert.Equal(2, await db.Changes.CountAsync());
    }

    [Fact] public async Task DatabaseFailureDoesNotReportSavedOrExposeInternalExceptions()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER task_ack_failure BEFORE INSERT ON Changes BEGIN SELECT RAISE(ABORT, 'private-database-marker'); END;");
        }
        var response = await Send(client, HttpMethod.Post, "/api/tasks", Input());
        await Envelope(response, HttpStatusCode.InternalServerError, "unknown");
        Assert.DoesNotContain("private-database-marker", await response.Content.ReadAsStringAsync());
        using var check = f.Services.CreateScope(); var saved = check.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Empty(await saved.Tasks.ToListAsync()); Assert.Empty(await saved.Changes.ToListAsync());
    }

    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task CommitFailureIsUnknownWhetherOrNotTheDatabaseAlreadyCommitted(bool afterCommit)
    {
        await using var f = new ScheduleFactory { TransactionInterceptor = new FailTaskCommit(afterCommit) };
        using var client = await f.Login(2);
        var response = await Send(client, HttpMethod.Post, "/api/tasks", Input());
        var result = await Envelope(response, HttpStatusCode.InternalServerError, "unknown");
        Assert.Equal(JsonValueKind.Null, result.GetProperty("data").ValueKind);
        Assert.DoesNotContain("private-commit-marker", await response.Content.ReadAsStringAsync());
        using var scope = f.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
        Assert.Equal(afterCommit ? 1 : 0, await db.Tasks.CountAsync());
        Assert.Equal(afterCommit ? 1 : 0, await db.Changes.CountAsync());
    }

    [Fact] public async Task AcknowledgementReadsStoredRowsRatherThanEchoingTheTrackedInput()
    {
        await using var f = new ScheduleFactory(); using var client = await f.Login(2);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER task_storage_value AFTER INSERT ON Tasks BEGIN UPDATE Tasks SET Title='DB 저장값' WHERE Id=NEW.Id; END;");
        }
        var created = await Create(client);
        Assert.Equal("DB 저장값", created.GetProperty("task").GetProperty("title").GetString());
        var id = created.GetProperty("task").GetProperty("id").GetInt64();
        var detail = await client.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}");
        Assert.Equal(detail.GetProperty("editing").GetProperty("stateToken").GetString(), created.GetProperty("stateToken").GetString());
        Assert.True(JsonElement.DeepEquals(detail.GetProperty("task"), created.GetProperty("task")));
    }

    private sealed class FailTaskCommit(bool afterCommit) : DbTransactionInterceptor
    {
        private bool failed;
        private void Fail(DbContext? context, bool after)
        {
            if (failed || after != afterCommit || context?.ChangeTracker.Entries<WorkItem>().Any() != true) return;
            failed = true;
            throw new InvalidOperationException("private-commit-marker");
        }
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction,
            TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            Fail(eventData.Context, false);
            return ValueTask.FromResult(result);
        }
        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            Fail(eventData.Context, true);
            return Task.CompletedTask;
        }
    }
}
