using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Schedule;
using Xunit;

public class WorkPlanningTests
{
    private static TaskInput Task(long? goalId = null) => new("목표 연결 업무", "상세 설명", 2, 10,
        new(2026, 9, 14), new(2026, 9, 18), "planned", 0, [], Goal: new(goalId));

    private static async Task<JsonElement> Value(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("saved", body.GetProperty("outcome").GetString());
        return body.GetProperty("data").GetProperty("value");
    }

    [Fact]
    public async Task EmployeesCanGroupTasksCloseGoalsAndReadPlanningWithTheBoard()
    {
        await using var factory = new ScheduleFactory();
        factory.Memberships.Add(new() { EmployeeId = 2, ProjectId = 10 });
        using var owner = await factory.Login(2);

        var goal = await Value(await owner.PostAsJsonAsync("/api/work-goals",
            new WorkGoalInput("프로토타입 완성", "9월 목표", 10)));
        var goalId = goal.GetProperty("id").GetInt64();
        var updatedGoal = await Value(await owner.PutAsJsonAsync($"/api/work-goals/{goalId}",
            new WorkGoalInput("프로토타입 완성 수정", "수정된 9월 목표", 10, 1)));
        Assert.Equal("프로토타입 완성 수정", updatedGoal.GetProperty("title").GetString());
        Assert.Equal("수정된 9월 목표", updatedGoal.GetProperty("description").GetString());
        Assert.Equal(2, updatedGoal.GetProperty("version").GetInt32());
        var taskResponse = await owner.PostAsJsonAsync("/api/tasks", Task(goalId));
        taskResponse.EnsureSuccessStatusCode();
        var task = (await taskResponse.Content.ReadFromJsonAsync<WorkItem>())!;
        Assert.Equal(goalId, task.GoalId);

        var grouped = await owner.GetFromJsonAsync<JsonElement>($"/api/tasks?goalId={goalId}&take=200");
        Assert.Contains(grouped.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetInt64() == task.Id);
        Assert.All(grouped.GetProperty("items").EnumerateArray(), item => Assert.Equal(goalId, item.GetProperty("goalId").GetInt64()));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync("/api/tasks?goalId=invalid")).StatusCode);

        var schedule = await Value(await owner.PostAsJsonAsync($"/api/tasks/{task.Id}/schedule-items",
            new TaskScheduleItemInput("플레이 테스트", new(2026, 9, 16), new(2026, 9, 18))));
        Assert.Equal("2026-09-18", schedule.GetProperty("endDate").GetString());
        var scheduleId = schedule.GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PostAsJsonAsync($"/api/tasks/{task.Id}/schedule-items",
            new TaskScheduleItemInput("역전된 기간", new(2026, 9, 20), new(2026, 9, 19)))).StatusCode);
        var updatedSchedule = await Value(await owner.PutAsJsonAsync($"/api/tasks/{task.Id}/schedule-items/{scheduleId}",
            new TaskScheduleItemInput("플레이 테스트 수정", new(2026, 9, 17), new(2026, 9, 20), 1)));
        Assert.Equal("플레이 테스트 수정", updatedSchedule.GetProperty("title").GetString());
        Assert.Equal("2026-09-20", updatedSchedule.GetProperty("endDate").GetString());

        var todo = await Value(await owner.PostAsJsonAsync($"/api/tasks/{task.Id}/shared-todos",
            new SharedTaskTodoInput("QA 체크리스트 확인")));
        var todoId = todo.GetProperty("id").GetInt64();
        var updatedTodo = await Value(await owner.PutAsJsonAsync($"/api/tasks/{task.Id}/shared-todos/{todoId}",
            new SharedTaskTodoInput("QA 체크리스트 수정", 1)));
        Assert.Equal("QA 체크리스트 수정", updatedTodo.GetProperty("title").GetString());

        var board = await owner.GetFromJsonAsync<JsonElement>(
            "/api/tasks?from=2026-09-14&to=2026-09-20&includePlanning=true");
        Assert.Single(board.GetProperty("scheduleItems").EnumerateArray());
        Assert.Single(board.GetProperty("sharedTodos").EnumerateArray());

        var closed = await Value(await owner.PatchAsJsonAsync($"/api/work-goals/{goalId}/closed",
            new WorkGoalCloseInput(true, 2)));
        Assert.Equal(JsonValueKind.String, closed.GetProperty("closedAt").ValueKind);
        var boot = await owner.GetFromJsonAsync<JsonElement>("/api/bootstrap");
        Assert.Contains(boot.GetProperty("goals").EnumerateArray(), item => item.GetProperty("id").GetInt64() == goalId && item.GetProperty("title").GetString() == "프로토타입 완성 수정");
    }

    [Fact]
    public async Task SharedTodosAreVisibleAndCompletableByCoworkersWhileDetailedSchedulesKeepTaskEditRules()
    {
        await using var factory = new ScheduleFactory();
        using var owner = await factory.Login(2);
        using var coworker = await factory.Login(3);
        var taskResponse = await owner.PostAsJsonAsync("/api/tasks", Task());
        var task = (await taskResponse.Content.ReadFromJsonAsync<WorkItem>())!;

        Assert.Equal(HttpStatusCode.Forbidden, (await coworker.PostAsJsonAsync(
            $"/api/tasks/{task.Id}/schedule-items", new TaskScheduleItemInput("권한 없음", new(2026, 9, 16)))).StatusCode);

        var todo = await Value(await coworker.PostAsJsonAsync($"/api/tasks/{task.Id}/shared-todos",
            new SharedTaskTodoInput("공동 확인")));
        var todoId = todo.GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.Forbidden, (await owner.PutAsJsonAsync(
            $"/api/tasks/{task.Id}/shared-todos/{todoId}", new SharedTaskTodoInput("타인 내용 수정", 1))).StatusCode);
        var completed = await Value(await owner.PatchAsJsonAsync(
            $"/api/tasks/{task.Id}/shared-todos/{todoId}/completion", new SharedTaskTodoCompletionInput(true, 1)));
        Assert.Equal(2, completed.GetProperty("completedBy").GetInt64());
        Assert.Equal(JsonValueKind.String, completed.GetProperty("completedAt").ValueKind);

        var detail = await coworker.GetFromJsonAsync<JsonElement>($"/api/tasks/{task.Id}");
        Assert.Equal(3, detail.GetProperty("sharedTodos")[0].GetProperty("createdBy").GetInt64());
        Assert.Equal(2, detail.GetProperty("sharedTodos")[0].GetProperty("completedBy").GetInt64());
        Assert.Contains(detail.GetProperty("history").EnumerateArray(), row =>
            row.GetProperty("action").GetString() == "공용 TODO 완료");
    }
}
