using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace Schedule;
public static class ReleaseRoutes
{
    public static void MapReleases(this WebApplication app)
    {
        app.MapGet("/api/legacy-releases", async (long projectId, int? skip, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await access.RequireProject(me, projectId);
            var query = db.LegacyReleases.AsNoTracking().Where(r => r.ProjectId == projectId);
            return Results.Ok(new { items = await query.OrderBy(r => r.Id).Skip(Math.Max(0, skip ?? 0)).Take(100).ToListAsync(), total = await query.CountAsync() });
        });
        app.MapGet("/api/release-series", async (long projectId, int? skip, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await access.RequireProject(me, projectId);
            var query = db.Releases.AsNoTracking().Where(r => r.ProjectId == projectId && r.Minor == 0);
            var bases = await query.OrderByDescending(r => r.BaseVersion).Skip(Math.Max(0, skip ?? 0)).Take(50).ToListAsync();
            var numbers = bases.Select(r => r.BaseVersion).ToArray();
            var latest = await db.Releases.AsNoTracking().Where(r => r.ProjectId == projectId && numbers.Contains(r.BaseVersion) && !db.Releases.Any(other => other.ProjectId == projectId && other.BaseVersion == r.BaseVersion && other.Minor > r.Minor)).ToListAsync();
            return Results.Ok(new { items = bases.Select(first => new { baseVersion = first.BaseVersion, first, latest = latest.Single(r => r.BaseVersion == first.BaseVersion) }), total = await query.CountAsync() });
        });
        app.MapGet("/api/releases/{id:long}", async (long id, ScheduleDb db, Access access) => Results.Ok(await Find(id, db, access, await access.Me())));
        app.MapGet("/api/releases", async (long projectId, int? baseVersion, int? skip, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await access.RequireProject(me, projectId);
            var query = db.Releases.AsNoTracking().Where(r => r.ProjectId == projectId);
            if (baseVersion.HasValue) query = query.Where(r => r.BaseVersion == baseVersion.Value);
            var items = await query.OrderByDescending(r => r.BaseVersion).ThenByDescending(r => r.Minor).Skip(Math.Max(0, skip ?? 0)).Take(50).ToListAsync();
            return Results.Ok(new { items, total = await query.CountAsync() });
        });
        app.MapGet("/api/releases/{id:long}/history", async (long id, int? skip, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); var record = await Find(id, db, access, me);
            var query = db.ReleaseRevisions.AsNoTracking().Where(r => r.ReleaseId == record.Id);
            return Results.Ok(new { items = await query.OrderByDescending(r => r.Id).Skip(Math.Max(0, skip ?? 0)).Take(50).ToListAsync(), total = await query.CountAsync() });
        });
        app.MapGet("/api/releases/editing", async (long projectId, long? id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); await access.RequireProject(me, projectId);
            var rows = await ReleaseWriteProtocol.ProjectRows(db, projectId);
            var target = id.HasValue ? rows.SingleOrDefault(x => x.Id == id.Value) ?? throw new ApiError(404, "업데이트 버전을 찾을 수 없습니다.") : null;
            return Results.Ok(ReleaseWriteProtocol.Editing(me, target, rows));
        });
        app.MapPost("/api/releases", async (HttpRequest request, ReleaseInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); ReleaseWriteProtocol.RequireActor(request, me);
            await using var tx = await db.Database.BeginTransactionAsync();
            var rows = await ReleaseWriteProtocol.ProjectRows(db, input.ProjectId);
            var previousStateToken = ReleaseWriteProtocol.RequireState(request, me, null, rows);
            await Validate(input, null, db, access, me);
            var record = new ReleaseRecord { CreatedBy = me.Id }; Apply(record, input); db.Releases.Add(record);
            ReleaseWriteProtocol.StartingWrite(request); await Save(db); RecordRevision(record, me, db); access.Log(me, null, "출시 버전 등록", record);
            await Save(db); var result = await ReleaseWriteProtocol.Saved(request, db, me, record, "create", previousStateToken);
            await tx.CommitAsync(); return result;
        }).AddEndpointFilter<ReleaseWriteProtocol>();
        app.MapPut("/api/releases/{id:long}", async (HttpRequest request, long id, ReleaseInput input, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); ReleaseWriteProtocol.RequireActor(request, me);
            await using var tx = await db.Database.BeginTransactionAsync();
            var record = await Find(id, db, access, me); var rows = await ReleaseWriteProtocol.ProjectRows(db, record.ProjectId);
            var previousStateToken = ReleaseWriteProtocol.RequireState(request, me, record, rows);
            Access.Version(record.Version, input.Version);
            // Identifiers are permanent so rollback links and historical references remain meaningful.
            if (record.ProjectId != input.ProjectId || record.BaseVersion != input.BaseVersion || record.Minor != input.Minor)
                throw new ApiError(400, "등록된 프로젝트와 버전 번호는 변경할 수 없습니다. 새 버전을 등록해 주세요.");
            await Validate(input, record, db, access, me);
            Apply(record, input); record.Version++; RecordRevision(record, me, db); access.Log(me, null, "출시 버전 수정", record);
            ReleaseWriteProtocol.StartingWrite(request); await Save(db);
            var result = await ReleaseWriteProtocol.Saved(request, db, me, record, "update", previousStateToken);
            await tx.CommitAsync(); return result;
        }).AddEndpointFilter<ReleaseWriteProtocol>();
        app.MapDelete("/api/releases/{id:long}", async (HttpRequest request, long id, ScheduleDb db, Access access) =>
        {
            var me = await access.Me(); ReleaseWriteProtocol.RequireActor(request, me); await access.RequireManager(me);
            var version = int.TryParse(request.Query["version"], out var queryVersion) ? queryVersion :
                TaskWriteProtocol.Requested(request) ? (await request.ReadFromJsonAsync<VersionInput>())?.Version ?? 0 : 0;
            await using var tx = await db.Database.BeginTransactionAsync();
            var record = await Find(id, db, access, me); var rows = await ReleaseWriteProtocol.ProjectRows(db, record.ProjectId);
            var previousStateToken = ReleaseWriteProtocol.RequireState(request, me, record, rows); Access.Version(record.Version, version);
            if (record.Minor == 0 && await db.Releases.AnyAsync(r => r.ProjectId == record.ProjectId && r.BaseVersion == record.BaseVersion && r.Minor > 0))
                throw new ApiError(400, "마이너 기록을 먼저 삭제한 뒤 기본 버전을 삭제해 주세요.");
            if (await db.Releases.AnyAsync(r => r.Id != record.Id && (r.RollbackTargetId == record.Id || r.ResolvedInId == record.Id)))
                throw new ApiError(400, "다른 버전의 복귀·해결 대상으로 사용 중입니다. 연결을 먼저 수정해 주세요.");
            var revisions = await db.ReleaseRevisions.Where(r => r.ReleaseId == record.Id).ToListAsync();
            db.ReleaseRevisions.RemoveRange(revisions); db.Releases.Remove(record); access.Log(me, null, "출시 버전 삭제", record);
            ReleaseWriteProtocol.StartingWrite(request); await Save(db);
            var result = await ReleaseWriteProtocol.Deleted(request, db, me, record, previousStateToken);
            await tx.CommitAsync(); return result;
        }).AddEndpointFilter<ReleaseWriteProtocol>();
    }
    private static async Task<ReleaseRecord> Find(long id, ScheduleDb db, Access access, Employee me)
    {
        var record = await db.Releases.FindAsync(id) ?? throw new ApiError(404, "업데이트 버전을 찾을 수 없습니다.");
        await access.RequireProject(me, record.ProjectId); return record;
    }
    private static async Task Validate(ReleaseInput input, ReleaseRecord? existing, ScheduleDb db, Access access, Employee me)
    {
        await access.RequireProject(me, input.ProjectId);
        if (existing is null && await db.Projects.AnyAsync(p => p.Id == input.ProjectId && p.Archived)) throw new ApiError(400, "사용 중인 프로젝트를 선택해 주세요.");
        if (new[] { input.BaseVersion, input.Minor }.Any(n => n < 0 || n > 99999) || input.ReleasedOn == default) throw new ApiError(400, "버전 번호와 출시일을 확인해 주세요.");
        Access.Text(input.Notes, 20000, true); Access.Text(input.Issue, 10000, input.Status is not ("stable" or "unrecorded"));
        if (input.Status is not ("stable" or "unstable" or "rolled_back" or "skipped" or "unrecorded")) throw new ApiError(400, "버전 상태를 확인해 주세요.");
        if (input.ReleasedOnUnknown == true && existing?.ReleasedOnUnknown != true) throw new ApiError(400, "출시일을 입력해 주세요.");
        if (input.Status == "rolled_back")
        {
            var target = await db.Releases.AsNoTracking().SingleOrDefaultAsync(r => r.Id == input.RollbackTargetId && r.ProjectId == input.ProjectId);
            if (target is null || target.Id == existing?.Id || target.BaseVersion > input.BaseVersion || (target.BaseVersion == input.BaseVersion && target.Minor >= input.Minor))
                throw new ApiError(400, "같은 프로젝트의 더 낮은 복귀 버전을 선택해 주세요.");
        }
        else if (input.RollbackTargetId is not null) throw new ApiError(400, "롤백 상태에서만 복귀 버전을 지정할 수 있습니다.");
        if (input.Status == "skipped" && input.Minor != 0) throw new ApiError(400, "버전 건너뜀은 기본 버전에서 표시해 주세요.");
        if (input.Minor > 0 && !await db.Releases.AnyAsync(r => r.ProjectId == input.ProjectId && r.BaseVersion == input.BaseVersion && r.Minor == 0)) throw new ApiError(400, "기본 버전을 먼저 등록해 주세요.");
        if (input.ResolvedInId.HasValue)
        {
            if (string.IsNullOrWhiteSpace(input.Issue) || !await db.Releases.AnyAsync(r => r.Id == input.ResolvedInId && r.ProjectId == input.ProjectId && r.BaseVersion == input.BaseVersion && r.Minor > input.Minor && r.Status == "stable"))
                throw new ApiError(400, "문제 내용과 같은 기본 버전의 더 높은 안정 마이너를 선택해 주세요.");
        }
        var existingId = existing?.Id ?? 0;
        if (await db.Releases.AnyAsync(r => r.ProjectId == input.ProjectId && r.BaseVersion == input.BaseVersion && r.Minor == input.Minor && r.Id != existingId))
            throw new ApiError(409, "이미 등록된 버전입니다. 기존 기록을 열어 수정해 주세요.");
    }
    private static void Apply(ReleaseRecord record, ReleaseInput input)
    {
        record.ProjectId = input.ProjectId; record.BaseVersion = input.BaseVersion; record.Minor = input.Minor;
        record.ReleasedOnUnknown = input.ReleasedOnUnknown ?? record.ReleasedOnUnknown;
        record.ReleasedOn = input.ReleasedOn; record.Notes = Access.Text(input.Notes, 20000, true); record.Status = input.Status;
        record.Issue = Access.Text(input.Issue, 10000); record.RollbackTargetId = input.RollbackTargetId; record.ResolvedInId = input.ResolvedInId; record.UpdatedAt = DateTime.UtcNow;
    }
    private static void RecordRevision(ReleaseRecord record, Employee actor, ScheduleDb db) => db.ReleaseRevisions.Add(new() { ReleaseId = record.Id, ActorId = actor.Id, Snapshot = JsonSerializer.Serialize(record, new JsonSerializerOptions(JsonSerializerDefaults.Web)) });
    private static async Task Save(ScheduleDb db)
    {
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteExtendedErrorCode: 2067 }) { throw new ApiError(409, "이미 등록된 버전입니다. 목록을 갱신해 주세요."); }
    }
}
