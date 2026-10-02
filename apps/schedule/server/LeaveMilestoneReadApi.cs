using System.Globalization;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

public static class LeaveMilestoneReadApi
{
    public static void MapLeaveMilestoneReadApi(this WebApplication app)
    {
        app.MapGet("/api/internal/leave/milestones", async (
            HttpContext context,
            IConfiguration configuration,
            ScheduleDb db,
            DirectoryService directory,
            DateOnly from,
            DateOnly to) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (from > to || to.DayNumber - from.DayNumber > 366)
                return Results.BadRequest(new { error = "주요일정 조회 기간을 확인해 주세요." });

            if (!TryReadActor(context.Request.Headers.Authorization.ToString(), configuration["Sso:SharedSecret"] ?? "", out var companyUserId))
                return Results.Unauthorized();

            await directory.Refresh(true);
            var actor = await db.Employees.AsNoTracking().SingleOrDefaultAsync(x =>
                x.Id == companyUserId && x.Active && x.Access && !x.Shared);
            if (actor is null) return Results.Unauthorized();

            var visibleProjects = await db.Projects.AsNoTracking()
                .Where(project => actor.IsAdmin || !project.IsPrivate)
                .ToDictionaryAsync(project => project.Id, project => project.Name);
            var visibleProjectIds = visibleProjects.Keys.ToArray();
            var milestones = await db.Milestones.AsNoTracking()
                .Where(item => item.ProjectId == null || visibleProjectIds.Contains(item.ProjectId.Value))
                .OrderBy(item => item.Date)
                .ThenBy(item => item.Id)
                .ToListAsync();

            var items = milestones
                .SelectMany(item => new[] { new MilestoneOccurrence(item.Type, item.Date, 0, item.DeadlineMemo) }
                    .Concat(item.AdditionalSchedules.Select((schedule, index) => new MilestoneOccurrence(schedule.Type, schedule.Date, index + 1, schedule.Memo)))
                    .Where(occurrence => occurrence.Date >= from && occurrence.Date <= to)
                    .Select(occurrence => new
                    {
                        milestoneId = item.Id.ToString(CultureInfo.InvariantCulture),
                        occurrenceIndex = occurrence.Index,
                        type = occurrence.Type,
                        title = string.IsNullOrWhiteSpace(occurrence.Memo) ? item.Title : occurrence.Memo,
                        date = occurrence.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        projectId = item.ProjectId?.ToString(CultureInfo.InvariantCulture),
                        projectName = item.ProjectId.HasValue ? visibleProjects[item.ProjectId.Value] : null
                    }))
                .OrderBy(item => item.date)
                .ThenBy(item => item.milestoneId, StringComparer.Ordinal)
                .ThenBy(item => item.occurrenceIndex)
                .ToArray();

            return Results.Ok(new { items });
        });
    }

    private static bool TryReadActor(string authorization, string secret, out long companyUserId)
    {
        companyUserId = 0;
        try
        {
            if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal)) return false;
            var payload = Tokens.Verify(authorization[7..], secret, "company-leave", "leave-milestones");
            return payload.TryGetProperty("sub", out var subject)
                && subject.ValueKind == System.Text.Json.JsonValueKind.String
                && long.TryParse(subject.GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out companyUserId)
                && companyUserId > 0;
        }
        catch (ApiError)
        {
            return false;
        }
    }

    private sealed record MilestoneOccurrence(string Type, DateOnly Date, int Index, string Memo);
}
