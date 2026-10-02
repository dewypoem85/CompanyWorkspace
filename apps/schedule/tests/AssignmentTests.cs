using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Schedule;
using Xunit;

public class AssignmentTests
{
    [Fact]
    public async Task CoworkerCanCreateAndNotifyWithoutGainingEditPermission()
    {
        await using var f = new ScheduleFactory();
        using var author = await f.Login(2); using var assignee = await f.Login(3);
        var input = new TaskInput("검수 요청", "@[아티스트](3) 확인 부탁드립니다", 3, 10, new(2026, 9, 8), new(2026, 9, 9), "planned", 0, []);
        var response = await author.PostAsJsonAsync("/api/tasks", input); response.EnsureSuccessStatusCode();
        var task = (await response.Content.ReadFromJsonAsync<WorkItem>())!;
        Assert.Equal(2, task.CreatedBy); Assert.Equal(3, task.AssigneeId);
        var notices = await assignee.GetFromJsonAsync<JsonElement>("/api/notifications");
        Assert.Equal(1, notices.GetProperty("unread").GetInt32());
        Assert.Contains("검수 요청", notices.ToString());
        Assert.Equal(0, (await author.GetFromJsonAsync<JsonElement>("/api/notifications")).GetProperty("unread").GetInt32());
        Assert.False((await author.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}")).GetProperty("canEdit").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await author.PutAsJsonAsync($"/api/tasks/{task.Id}", input with { Version = task.Version })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await author.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("done", task.Version))).StatusCode);
        (await assignee.PatchAsJsonAsync($"/api/tasks/{task.Id}/status", new StatusInput("done", task.Version))).EnsureSuccessStatusCode();
        // Creating for another person must not open an indirect reassignment path through PUT.
        var own = await author.PostAsJsonAsync("/api/tasks", input with { AssigneeId = 2, Body = "" });
        var ownTask = (await own.Content.ReadFromJsonAsync<WorkItem>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await author.PutAsJsonAsync($"/api/tasks/{ownTask.Id}", input with { Version = ownTask.Version })).StatusCode);
        foreach (var state in new[] { "private", "shared", "inactive", "noaccess", "master" })
        {
            var person = f.People.Single(p => p.Id == 4);
            person.IsPrivate = state == "private"; person.Shared = state == "shared"; person.Active = state != "inactive"; person.Access = state != "noaccess"; person.Role = state == "master" ? "master" : "employee";
            Assert.Equal(HttpStatusCode.BadRequest, (await author.PostAsJsonAsync("/api/tasks", input with { AssigneeId = 4 })).StatusCode);
        }
    }
}
