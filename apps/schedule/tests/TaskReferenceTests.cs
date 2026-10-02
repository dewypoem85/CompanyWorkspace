using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class TaskReferenceTests
{
    [Fact] public async Task ReferenceReturnsOnlyVisibleMetadataIncludingArchivedTasks()
    {
        await using var factory = new ScheduleFactory();
        using var admin = await factory.Login(); using var employee = await factory.Login(2);
        long id;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            var task = new WorkItem { Title="참조할 업무", Body="미리보기에서 가져오지 않을 본문", AssigneeId=2, ProjectId=10, CreatedBy=1, Archived=true };
            db.Tasks.Add(task); await db.SaveChangesAsync(); id=task.Id;
        }
        var preview = await employee.GetFromJsonAsync<JsonElement>($"/api/tasks/{id}/reference");
        Assert.Equal("참조할 업무", preview.GetProperty("title").GetString());
        Assert.True(preview.GetProperty("archived").GetBoolean());
        Assert.Equal(4, preview.EnumerateObject().Count());
        Assert.False(preview.TryGetProperty("body", out _));
        factory.Projects[0].IsPrivate=true;
        Assert.Equal(HttpStatusCode.NotFound, (await employee.GetAsync($"/api/tasks/{id}/reference")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/tasks/{id}/reference")).StatusCode);
        factory.Projects[0].IsPrivate=false; factory.People[1].IsPrivate=true;
        Assert.Equal(HttpStatusCode.NotFound, (await employee.GetAsync($"/api/tasks/{id}/reference")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await employee.GetAsync("/api/tasks/999999/reference")).StatusCode);
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/tasks/{id}/reference")).StatusCode);
    }
}
