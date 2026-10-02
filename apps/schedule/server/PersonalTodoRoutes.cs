using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class PersonalTodoRoutes
{
    private static readonly TimeSpan ArchiveAfter = TimeSpan.FromDays(3);

    public static void MapPersonalTodos(this WebApplication app)
    {
        app.MapGet("/api/personal-todos", async (bool? archived, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var cutoff = DateTime.UtcNow - ArchiveAfter;
            var query = db.PersonalTodos.AsNoTracking().Where(x => x.OwnerId == me.Id);
            query = archived == true
                ? query.Where(x => x.CompletedAt != null && x.CompletedAt <= cutoff)
                : query.Where(x => x.CompletedAt == null || x.CompletedAt > cutoff);
            return Results.Ok(await query.OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToArrayAsync());
        });

        app.MapGet("/api/personal-todos/editing", async (bool? archived, long? id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            var rows = await PersonalTodoWriteProtocol.Rows(db, me.Id, archived == true);
            PersonalTodo? target = null;
            if (id.HasValue)
                target = rows.SingleOrDefault(x => x.Id == id.Value)
                    ?? throw new ApiError(404, "현재 TODO 목록에서 대상을 찾을 수 없습니다.");
            return Results.Ok(PersonalTodoWriteProtocol.Editing(me, target, rows));
        });

        app.MapPost("/api/personal-todos", async (HttpRequest request, PersonalTodoInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me();
            PersonalTodoWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var rows = await PersonalTodoWriteProtocol.Rows(db, me.Id, false);
            var previousStateToken = PersonalTodoWriteProtocol.RequireState(request, me, null, rows);
            var last = await Active(db, me.Id).MaxAsync(x => (long?)x.SortOrder) ?? 0;
            var item = new PersonalTodo { OwnerId = me.Id, Title = Access.Text(input.Title, 500, true), SortOrder = last + 1 };
            db.PersonalTodos.Add(item); PersonalTodoWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await PersonalTodoWriteProtocol.Saved(request, db, me, item, "add", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<PersonalTodoWriteProtocol>();

        app.MapPut("/api/personal-todos/{id:long}", async (HttpRequest request, long id, PersonalTodoInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); PersonalTodoWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await Own(db, me.Id, id);
            var previousStateToken = PersonalTodoWriteProtocol.RequireState(request, me, item, [item]);
            Access.Version(item.Version, input.Version);
            item.Title = Access.Text(input.Title, 500, true); item.Version++; item.UpdatedAt = DateTime.UtcNow;
            PersonalTodoWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await PersonalTodoWriteProtocol.Saved(request, db, me, item, "save", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<PersonalTodoWriteProtocol>();

        app.MapPatch("/api/personal-todos/{id:long}/completion", async (HttpRequest request, long id, PersonalTodoCompletionInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); PersonalTodoWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await Own(db, me.Id, id);
            var previousStateToken = PersonalTodoWriteProtocol.RequireState(request, me, item, [item]);
            Access.Version(item.Version, input.Version);
            item.CompletedAt = input.Completed ? item.CompletedAt ?? DateTime.UtcNow : null;
            if (!input.Completed)
                item.SortOrder = (await Active(db, me.Id).Where(x => x.Id != id).MaxAsync(x => (long?)x.SortOrder) ?? 0) + 1;
            item.Version++; item.UpdatedAt = DateTime.UtcNow;
            PersonalTodoWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await PersonalTodoWriteProtocol.Saved(request, db, me, item, "complete", previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<PersonalTodoWriteProtocol>();

        app.MapPut("/api/personal-todos/order", async (HttpRequest request, PersonalTodoOrderInput input, ScheduleDb db, Access access) =>
        {
            if (input.Ids.Length != input.Ids.Distinct().Count()) throw new ApiError(400, "TODO 순서를 다시 확인해 주세요.");
            var me = await access.Me(); PersonalTodoWriteProtocol.RequireActor(request, me);
            await using var transaction = await db.Database.BeginTransactionAsync();
            var query = input.Archived ? Archived(db, me.Id) : Active(db, me.Id);
            var items = await query.ToListAsync();
            var previousStateToken = PersonalTodoWriteProtocol.RequireState(request, me, null, items);
            if (items.Count != input.Ids.Length || items.Any(x => !input.Ids.Contains(x.Id))) throw new ApiError(409, "TODO 목록이 변경되었습니다. 새로고침 후 다시 정렬해 주세요.");
            var order = input.Ids.Select((id, index) => (id, index)).ToDictionary(x => x.id, x => x.index + 1L);
            foreach (var item in items) { item.SortOrder = order[item.Id]; item.UpdatedAt = DateTime.UtcNow; }
            PersonalTodoWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await PersonalTodoWriteProtocol.Ordered(request, db, me, input.Archived, previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<PersonalTodoWriteProtocol>();

        app.MapDelete("/api/personal-todos/{id:long}", async (HttpRequest request, long id, int version, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); PersonalTodoWriteProtocol.RequireActor(request, me);
            if (TaskWriteProtocol.Requested(request))
            {
                var submitted = await request.ReadFromJsonAsync<VersionInput>() ?? throw new ApiError(400, "TODO 버전을 확인해 주세요.");
                if (submitted.Version != version) throw new ApiError(400, "TODO 삭제 기준이 일치하지 않습니다.");
            }
            await using var transaction = await db.Database.BeginTransactionAsync();
            var item = await Own(db, me.Id, id);
            var previousStateToken = PersonalTodoWriteProtocol.RequireState(request, me, item, [item]);
            Access.Version(item.Version, version);
            var archived = item.CompletedAt != null && item.CompletedAt <= DateTime.UtcNow - ArchiveAfter;
            var snapshot = new PersonalTodo { Id = item.Id, OwnerId = item.OwnerId, Title = item.Title, SortOrder = item.SortOrder,
                Version = item.Version, CompletedAt = item.CompletedAt, CreatedAt = item.CreatedAt, UpdatedAt = item.UpdatedAt };
            db.PersonalTodos.Remove(item); PersonalTodoWriteProtocol.StartingWrite(request); await db.SaveChangesAsync();
            var result = await PersonalTodoWriteProtocol.Deleted(request, db, me, snapshot, archived, previousStateToken);
            await transaction.CommitAsync(); return result;
        }).AddEndpointFilter<PersonalTodoWriteProtocol>();
    }

    private static IQueryable<PersonalTodo> Active(ScheduleDb db, long ownerId)
    {
        var cutoff = DateTime.UtcNow - ArchiveAfter;
        return db.PersonalTodos.Where(x => x.OwnerId == ownerId && (x.CompletedAt == null || x.CompletedAt > cutoff));
    }

    private static IQueryable<PersonalTodo> Archived(ScheduleDb db, long ownerId)
    {
        var cutoff = DateTime.UtcNow - ArchiveAfter;
        return db.PersonalTodos.Where(x => x.OwnerId == ownerId && x.CompletedAt != null && x.CompletedAt <= cutoff);
    }

    private static async Task<PersonalTodo> Own(ScheduleDb db, long ownerId, long id)
    {
        return await db.PersonalTodos.SingleOrDefaultAsync(x => x.Id == id && x.OwnerId == ownerId)
            ?? throw new ApiError(404, "TODO를 찾을 수 없습니다.");
    }
}
