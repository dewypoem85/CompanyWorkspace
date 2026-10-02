using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class WorkPlanningRoutes
{
    public static void MapWorkPlanning(this WebApplication app)
    {
        app.MapPost("/api/work-goals", async (HttpRequest request, WorkGoalInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me);
            await access.RequireProject(me, input.ProjectId);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var goal = new WorkGoal { Title = Access.Text(input.Title, 200, true), Description = Access.Text(input.Description ?? "", 2000), ProjectId = input.ProjectId, CreatedBy = me.Id };
            db.WorkGoals.Add(goal); PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            access.Log(me, null, "업무 목표 등록", new { goal.Id, goal.Title, goal.ProjectId }); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("goal-create", goal);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPut("/api/work-goals/{id:long}", async (HttpRequest request, long id, WorkGoalInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); var goal = await Goal(id, me, db, access);
            Access.Version(goal.Version, input.Version); await access.RequireProject(me, input.ProjectId);
            await using var transaction = await db.Database.BeginTransactionAsync();
            goal.Title = Access.Text(input.Title, 200, true); goal.Description = Access.Text(input.Description ?? "", 2000); goal.ProjectId = input.ProjectId; goal.Version++; goal.UpdatedAt = DateTime.UtcNow;
            PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, null, "업무 목표 수정", new { goal.Id, goal.Title, goal.ProjectId, goal.Version }); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("goal-update", goal);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPatch("/api/work-goals/{id:long}/closed", async (HttpRequest request, long id, WorkGoalCloseInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); var goal = await Goal(id, me, db, access); Access.Version(goal.Version, input.Version);
            await using var transaction = await db.Database.BeginTransactionAsync();
            goal.ClosedAt = input.Closed ? goal.ClosedAt ?? DateTime.UtcNow : null; goal.ClosedBy = input.Closed ? me.Id : null; goal.Version++; goal.UpdatedAt = DateTime.UtcNow;
            PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, null, input.Closed ? "업무 목표 종료" : "업무 목표 재개", new { goal.Id, goal.Title, goal.Version }); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("goal-close", goal);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPost("/api/tasks/{taskId:long}/schedule-items", async (HttpRequest request, long taskId, TaskScheduleItemInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await EditableTask(taskId, me, db, access); var endDate = ValidateTaskDates(input.Date, input.EndDate);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = new TaskScheduleItem { TaskId = taskId, Title = Access.Text(input.Title, 300, true), Date = input.Date, EndDate = endDate, CreatedBy = me.Id };
            db.TaskScheduleItems.Add(item); PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "상세 일정 등록", item); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("schedule-create", item);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPut("/api/tasks/{taskId:long}/schedule-items/{id:long}", async (HttpRequest request, long taskId, long id, TaskScheduleItemInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await EditableTask(taskId, me, db, access); var endDate = ValidateTaskDates(input.Date, input.EndDate);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await db.TaskScheduleItems.SingleOrDefaultAsync(x => x.Id == id && x.TaskId == taskId) ?? throw new ApiError(404, "상세 일정을 찾을 수 없습니다."); Access.Version(item.Version, input.Version);
            item.Title = Access.Text(input.Title, 300, true); item.Date = input.Date; item.EndDate = endDate; item.Version++; item.UpdatedAt = DateTime.UtcNow;
            PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "상세 일정 수정", item); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("schedule-update", item);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapDelete("/api/tasks/{taskId:long}/schedule-items/{id:long}", async (HttpRequest request, long taskId, long id, int version, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await EditableTask(taskId, me, db, access);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await db.TaskScheduleItems.SingleOrDefaultAsync(x => x.Id == id && x.TaskId == taskId) ?? throw new ApiError(404, "상세 일정을 찾을 수 없습니다."); Access.Version(item.Version, version);
            var snapshot = new { item.Id, item.Title, item.Date, item.EndDate }; db.TaskScheduleItems.Remove(item); PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "상세 일정 삭제", snapshot); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("schedule-delete", snapshot);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPost("/api/tasks/{taskId:long}/shared-todos", async (HttpRequest request, long taskId, SharedTaskTodoInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await VisibleTask(taskId, me, db, access);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = new SharedTaskTodo { TaskId = taskId, Title = Access.Text(input.Title, 500, true), CreatedBy = me.Id };
            db.SharedTaskTodos.Add(item); PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "공용 TODO 등록", item); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("todo-create", item);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPut("/api/tasks/{taskId:long}/shared-todos/{id:long}", async (HttpRequest request, long taskId, long id, SharedTaskTodoInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await VisibleTask(taskId, me, db, access);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await db.SharedTaskTodos.SingleOrDefaultAsync(x => x.Id == id && x.TaskId == taskId) ?? throw new ApiError(404, "TODO를 찾을 수 없습니다.");
            if (item.CreatedBy != me.Id && !me.IsAdmin) throw new ApiError(403, "등록자 또는 관리자만 TODO 내용을 수정할 수 있습니다."); Access.Version(item.Version, input.Version);
            item.Title = Access.Text(input.Title, 500, true); item.Version++; item.UpdatedAt = DateTime.UtcNow;
            PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "공용 TODO 수정", item); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("todo-update", item);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapPatch("/api/tasks/{taskId:long}/shared-todos/{id:long}/completion", async (HttpRequest request, long taskId, long id, SharedTaskTodoCompletionInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await VisibleTask(taskId, me, db, access);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await db.SharedTaskTodos.SingleOrDefaultAsync(x => x.Id == id && x.TaskId == taskId) ?? throw new ApiError(404, "TODO를 찾을 수 없습니다."); Access.Version(item.Version, input.Version);
            item.CompletedAt = input.Completed ? item.CompletedAt ?? DateTime.UtcNow : null; item.CompletedBy = input.Completed ? me.Id : null; item.Version++; item.UpdatedAt = DateTime.UtcNow;
            PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, input.Completed ? "공용 TODO 완료" : "공용 TODO 완료 취소", item); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("todo-complete", item);
        }).AddEndpointFilter<PlanningWriteProtocol>();

        app.MapDelete("/api/tasks/{taskId:long}/shared-todos/{id:long}", async (HttpRequest request, long taskId, long id, int version, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); await VisibleTask(taskId, me, db, access);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await db.SharedTaskTodos.SingleOrDefaultAsync(x => x.Id == id && x.TaskId == taskId) ?? throw new ApiError(404, "TODO를 찾을 수 없습니다.");
            if (item.CreatedBy != me.Id && !me.IsAdmin) throw new ApiError(403, "등록자 또는 관리자만 TODO를 삭제할 수 있습니다."); Access.Version(item.Version, version);
            var snapshot = new { item.Id, item.Title }; db.SharedTaskTodos.Remove(item); PlanningWriteProtocol.StartingWrite(request); await db.SaveChangesAsync(); access.Log(me, taskId, "공용 TODO 삭제", snapshot); await db.SaveChangesAsync(); await transaction.CommitAsync();
            return PlanningWriteProtocol.Saved("todo-delete", snapshot);
        }).AddEndpointFilter<PlanningWriteProtocol>();
    }

    private static async Task<WorkGoal> Goal(long id, Employee me, ScheduleDb db, Access access)
    {
        var goal = await db.WorkGoals.SingleOrDefaultAsync(x => x.Id == id) ?? throw new ApiError(404, "업무 목표를 찾을 수 없습니다.");
        await access.RequireProject(me, goal.ProjectId); return goal;
    }
    private static async Task<WorkItem> VisibleTask(long id, Employee me, ScheduleDb db, Access access) =>
        await access.VisibleTasks(me).SingleOrDefaultAsync(x => x.Id == id) ?? throw new ApiError(404, "업무를 찾을 수 없습니다.");
    private static async Task<WorkItem> EditableTask(long id, Employee me, ScheduleDb db, Access access)
    {
        var task = await VisibleTask(id, me, db, access); if (task.Archived) throw new ApiError(409, "보관된 업무는 수정할 수 없습니다."); await access.RequireEdit(me, task.AssigneeId); return task;
    }
    private static DateOnly ValidateTaskDates(DateOnly startDate, DateOnly? requestedEndDate)
    {
        var endDate = requestedEndDate ?? startDate;
        if (startDate == default || endDate == default || startDate.Year is < 2000 or > 2200 || endDate.Year is < 2000 or > 2200)
            throw new ApiError(400, "상세 일정 날짜를 확인해 주세요.");
        if (endDate < startDate) throw new ApiError(400, "상세 일정 종료일은 시작일보다 빠를 수 없습니다.");
        return endDate;
    }
}
