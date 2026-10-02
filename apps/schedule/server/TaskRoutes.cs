using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class TaskRoutes
{
    public static void MapTasks(this WebApplication app)
    {
        app.MapGet("/api/tasks/{id:long}/reference", async (long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var task = await access.VisibleTasks(me).AsNoTracking().Where(t => t.Id == id)
                .Select(t => new { t.Id, t.Title, t.ProjectId, t.Archived }).SingleOrDefaultAsync();
            return task is null ? Results.NotFound(new { error = "업무를 찾을 수 없습니다." }) : Results.Ok(task);
        });
        app.MapGet("/api/tasks", async (HttpRequest req, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var q = access.VisibleTasks(me).AsNoTracking();
            var archived = req.Query["archived"] == "true";
            if (archived) Access.Admin(me);
            q = q.Where(x => x.Archived == archived);
            var assigneeFilter=req.Query["assigneeId"].ToString();
            if (assigneeFilter == "me") q = q.Where(x => x.AssigneeId == me.Id);
            else if (assigneeFilter.Length > 0)
            {
                if (!long.TryParse(assigneeFilter, out var person) || person <= 0) throw new ApiError(400, "담당자를 확인해 주세요.");
                q = q.Where(x => x.AssigneeId == person);
            }
            var projectFilter=req.Query["projectId"].ToString();
            if (projectFilter == "mine") q = q.Where(x => x.ProjectId.HasValue && db.Memberships.Any(m => m.EmployeeId == me.Id && m.ProjectId == x.ProjectId.Value));
            else if (projectFilter.Length > 0)
            {
                if (!long.TryParse(projectFilter, out var project) || project <= 0) throw new ApiError(400, "프로젝트를 확인해 주세요.");
                q = q.Where(x => x.ProjectId == project);
            }
            if (req.Query.ContainsKey("goalId"))
            {
                if (!long.TryParse(req.Query["goalId"], out var goalId) || goalId <= 0) throw new ApiError(400, "업무 목표를 확인해 주세요.");
                q = q.Where(x => x.GoalId == goalId);
            }
            if (long.TryParse(req.Query["departmentId"], out var departmentId)) q = q.Where(x => db.Employees.Any(e => e.Id == x.AssigneeId && e.DepartmentId == departmentId));
            var department = req.Query["department"].ToString();
            if (department.Length > 0) q = q.Where(x => db.Employees.Any(e => e.Id == x.AssigneeId && e.Department == department));
            var status = req.Query["status"].ToString();
            if (status.Length > 0) { Access.Status(status); q = q.Where(x => x.Status == status); }
            if (req.Query["scheduled"] == "true") q = q.Where(x => x.StartDate != null && x.EndDate != null);
            if (req.Query["unscheduled"] == "true") q = q.Where(x => x.StartDate == null);
            if (req.Query.ContainsKey("from") || req.Query.ContainsKey("to"))
            {
                if (!DateOnly.TryParse(req.Query["from"], out var from) || !DateOnly.TryParse(req.Query["to"], out var to) || from > to || to.DayNumber - from.DayNumber > 366) throw new ApiError(400, "조회 기간을 확인해 주세요.");
                q = q.Where(x => x.StartDate <= to && x.EndDate >= from);
            }
            var take = Math.Clamp(int.TryParse(req.Query["take"], out var n) ? n : 100, 1, 200);
            var skip = Math.Max(0, int.TryParse(req.Query["skip"], out var s) ? s : 0);
            var total = await q.CountAsync();
            var tasks = await q.OrderByDescending(x => x.UpdatedAt).ThenByDescending(x => x.Id).Skip(skip).Take(take).ToArrayAsync();
            var ids = tasks.Select(x => x.Id).ToArray();
            var counts = await db.Comments.Where(x => ids.Contains(x.TaskId) && !x.Deleted).GroupBy(x => x.TaskId).Select(g => new { taskId = g.Key, count = g.Count() }).ToListAsync();
            var attachments = await db.Attachments.Where(x => x.TaskId.HasValue && ids.Contains(x.TaskId.Value)).GroupBy(x => x.TaskId).Select(g => new { taskId = g.Key, count = g.Count() }).ToListAsync();
            var includePlanning = req.Query["includePlanning"] == "true";
            var scheduleItems = includePlanning ? await db.TaskScheduleItems.AsNoTracking().Where(x => ids.Contains(x.TaskId)).OrderBy(x => x.Date).ThenBy(x => x.Id).ToListAsync() : [];
            var sharedTodos = includePlanning ? await db.SharedTaskTodos.AsNoTracking().Where(x => ids.Contains(x.TaskId)).OrderBy(x => x.CompletedAt != null).ThenBy(x => x.Id).ToListAsync() : [];
            var editableAssignees = await access.EditableAssignees(me, tasks.Select(x => x.AssigneeId));
            var editable = tasks.Where(t => !t.Archived && editableAssignees.Contains(t.AssigneeId)).Select(t => t.Id).ToArray();
            return Results.Ok(new { items = tasks, total, commentCounts = counts, attachmentCounts = attachments, editableIds = editable, scheduleItems, sharedTodos });
        });
        app.MapGet("/api/tasks/{id:long}", async (long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var task = await Find(db, id, me);
            var comments = await db.Comments.AsNoTracking().Where(x => x.TaskId == id).OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).ToListAsync();
            var attachments = await db.Attachments.AsNoTracking().Where(x => x.TaskId == id).ToListAsync();
            return Results.Ok(new { task, canEdit = !task.Archived && await access.CanEdit(me, task.AssigneeId), comments,
                attachments, editing = new { actorId = me.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), stateToken = TaskWriteProtocol.StateToken(task, attachments) },
                commentEditing = CommentWriteProtocol.Editing(me, task, comments, attachments),
                scheduleItems = await db.TaskScheduleItems.AsNoTracking().Where(x => x.TaskId == id).OrderBy(x => x.Date).ThenBy(x => x.Id).ToListAsync(),
                sharedTodos = await db.SharedTaskTodos.AsNoTracking().Where(x => x.TaskId == id).OrderBy(x => x.CompletedAt != null).ThenBy(x => x.Id).ToListAsync(),
                history = await db.Changes.AsNoTracking().Where(x => x.TaskId == id).OrderByDescending(x => x.Id).Take(100).ToListAsync() });
        });
        app.MapPost("/api/tasks", async (HttpRequest request, TaskInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            TaskWriteProtocol.RequireActor(request, me);
            if (TaskWriteProtocol.Requested(request) && (input.Version != 0 || request.Headers.ContainsKey(TaskWriteProtocol.StateHeader)))
                throw new ApiError(409, "신규 업무의 작성 기준을 확인해 주세요.");
            await Validate(input, me, db, access, creating: true);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = new WorkItem { CreatedBy = me.Id };
            Apply(task, input);
            db.Tasks.Add(task);
            TaskWriteProtocol.StartingWrite(request);
            await db.SaveChangesAsync();
            await access.Attach(me, task, null, input.AttachmentIds);
            access.Log(me, task.Id, "업무 등록", input);
            await access.Notify(me, task, null, $"{me.Name}님이 업무를 등록했습니다: {task.Title}", Access.Mentions(task.Body).Append(task.AssigneeId));
            await db.SaveChangesAsync();
            var result = await TaskWriteProtocol.Saved(request, db, me, task, "create", null);
            await transaction.CommitAsync();
            return result;
        }).AddEndpointFilter<TaskWriteProtocol>();
        app.MapPut("/api/tasks/{id:long}", async (HttpRequest request, long id, TaskInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            TaskWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = await Editable(db, access, me, id);
            Access.Version(task.Version, input.Version);
            var previousStateToken = await TaskWriteProtocol.RequireState(request, db, task);
            await Validate(input, me, db, access, task.ProjectId, task.GoalId);
            var old = new { task.Title, task.Body, task.AssigneeId, task.ProjectId, task.GoalId, task.StartDate, task.EndDate, task.Status };
            var recipients = Access.Mentions(input.Body ?? "").Except(Access.Mentions(task.Body)).ToList();
            if (task.AssigneeId != input.AssigneeId) recipients.Add(input.AssigneeId);
            Apply(task, input); task.Version++;
            await access.Attach(me, task, null, input.AttachmentIds);
            access.Log(me, id, "업무 수정", new { before = old, after = input });
            await access.Notify(me, task, null, $"{me.Name}님이 업무에서 회원님을 지정했습니다: {task.Title}", recipients);
            TaskWriteProtocol.StartingWrite(request);
            await db.SaveChangesAsync();
            var result = await TaskWriteProtocol.Saved(request, db, me, task, "update", previousStateToken);
            await transaction.CommitAsync();
            return result;
        }).AddEndpointFilter<TaskWriteProtocol>();
        app.MapPatch("/api/tasks/{id:long}/status", async (HttpRequest request, long id, StatusInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            TaskWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = await Editable(db, access, me, id);
            Access.Version(task.Version, input.Version); Access.Status(input.Status);
            var previousStateToken = await TaskWriteProtocol.RequireState(request, db, task);
            access.Log(me, id, "상태 변경", new { before = task.Status, after = input.Status });
            task.Status = input.Status; task.Version++; task.UpdatedAt = DateTime.UtcNow;
            TaskWriteProtocol.StartingWrite(request);
            await db.SaveChangesAsync();
            var result = await TaskWriteProtocol.Saved(request, db, me, task, "status", previousStateToken);
            await transaction.CommitAsync();
            return result;
        }).AddEndpointFilter<TaskWriteProtocol>();
        app.MapPost("/api/tasks/{id:long}/archive", async (HttpRequest request, long id, VersionInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = await Editable(db, access, me, id);
            var previousStateToken = await TaskWriteProtocol.RequireState(request, db, task);
            Access.Version(task.Version, input.Version); task.Archived = true; task.Version++; task.UpdatedAt = DateTime.UtcNow;
            access.Log(me, id, "업무 보관"); TaskWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await TaskWriteProtocol.Saved(request, db, me, task, "archive", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<TaskWriteProtocol>();
        app.MapPost("/api/tasks/{id:long}/restore", async (HttpRequest request, long id, VersionInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); TaskWriteProtocol.RequireActor(request, me); Access.Admin(me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var task = await Find(db, id, me);
            var previousStateToken = await TaskWriteProtocol.RequireState(request, db, task);
            Access.Version(task.Version, input.Version); task.Archived = false; task.Version++; task.UpdatedAt = DateTime.UtcNow;
            access.Log(me, id, "업무 복원"); TaskWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await TaskWriteProtocol.Saved(request, db, me, task, "restore", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<TaskWriteProtocol>();
    }
    public static async Task<WorkItem> Find(ScheduleDb db, long id, Employee me) => await new Access(db, null!).VisibleTasks(me).SingleOrDefaultAsync(t => t.Id == id) ?? throw new ApiError(404, "업무를 찾을 수 없습니다.");
    public static async Task<WorkItem> Editable(ScheduleDb db, Access access, Employee me, long id)
    {
        var task = await Find(db, id, me);
        if (task.Archived) throw new ApiError(409, "보관된 업무는 읽기 전용입니다.");
        await access.RequireEdit(me, task.AssigneeId); return task;
    }
    private static async Task Validate(TaskInput input, Employee me, ScheduleDb db, Access access, long? existingProjectId = null, long? existingGoalId = null, bool creating = false)
    {
        await access.RequireProject(me, input.ProjectId);
        Access.Text(input.Title, 200, true); Access.Text(input.Body, 20000); Access.Status(input.Status); Access.Dates(input.StartDate, input.EndDate);
        if (!await db.Employees.AnyAsync(x => x.Id == input.AssigneeId && x.Active && x.Access && !x.Shared && x.Role != "master" && (me.IsAdmin || !x.IsPrivate))) throw new ApiError(400, "활성 직원을 담당자로 선택해 주세요.");
        if (!creating) await access.RequireEdit(me, input.AssigneeId);
        if (input.ProjectId.HasValue && !await db.Projects.AnyAsync(x => x.Id == input.ProjectId && (!x.Archived || x.Id == existingProjectId))) throw new ApiError(400, "프로젝트를 확인해 주세요.");
        if (input.Goal is { Id: { } goalId })
        {
            var goal = await db.WorkGoals.AsNoTracking().SingleOrDefaultAsync(x => x.Id == goalId) ?? throw new ApiError(400, "업무 목표를 확인해 주세요.");
            await access.RequireProject(me, goal.ProjectId);
            if (goal.ClosedAt != null && goal.Id != existingGoalId) throw new ApiError(400, "종료되지 않은 업무 목표를 선택해 주세요.");
            if (goal.ProjectId.HasValue && input.ProjectId != goal.ProjectId) throw new ApiError(400, "업무 목표와 같은 프로젝트를 선택해 주세요.");
        }
    }
    private static void Apply(WorkItem task, TaskInput input)
    {
        task.Title = Access.Text(input.Title, 200, true); task.Body = Access.Text(input.Body, 20000); task.AssigneeId = input.AssigneeId; task.ProjectId = input.ProjectId;
        if (input.Goal is not null) task.GoalId = input.Goal.Id;
        task.StartDate = input.StartDate; task.EndDate = input.EndDate; task.Status = input.Status; task.UpdatedAt = DateTime.UtcNow;
    }
}
