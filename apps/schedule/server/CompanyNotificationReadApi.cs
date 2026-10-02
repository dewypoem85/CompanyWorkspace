using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Schedule;

public static class CompanyNotificationReadApi
{
    private static readonly ConcurrentDictionary<string, long> UsedTokens = new();

    public static void MapCompanyNotificationReadApi(this WebApplication app)
    {
        app.MapGet("/api/internal/company-notifications", async (HttpContext context, IConfiguration configuration, ScheduleDb db, DirectoryService directory) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!TryReadSubject(context.Request.Headers.Authorization.ToString(), configuration["Sso:SharedSecret"] ?? "", out var companyUserId))
                return Results.Unauthorized();
            await directory.Refresh(true);
            var me = await db.Employees.FindAsync(companyUserId);
            if (me is null || !me.Active || !me.Access) return Results.Unauthorized();
            var visibleTasks = new Access(db, null!).VisibleTasks(me).Select(t => t.Id);
            var visibleFeedback = FeedbackRoutes.Visible(db, me).Select(t => -t.Id);
            var take = int.TryParse(context.Request.Query["take"], out var requested) ? Math.Clamp(requested, 1, 200) : 100;
            var hasAfterId = context.Request.Query.ContainsKey("afterId");
            var latestOnly = string.Equals(context.Request.Query["latestId"], "true", StringComparison.OrdinalIgnoreCase);
            var hasExactId = context.Request.Query.ContainsKey("id");
            var parsedAfterId = 0L;
            if (hasAfterId && (!long.TryParse(context.Request.Query["afterId"], out parsedAfterId) || parsedAfterId < 0))
                return Results.BadRequest(new { error = "afterId를 확인해 주세요." });
            var exactId = 0L;
            if (hasExactId && (!long.TryParse(context.Request.Query["id"], out exactId) || exactId <= 0))
                return Results.BadRequest(new { error = "id를 확인해 주세요." });
            if ((latestOnly ? 1 : 0) + (hasAfterId ? 1 : 0) + (hasExactId ? 1 : 0) > 1)
                return Results.BadRequest(new { error = "latestId, afterId, id는 함께 사용할 수 없습니다." });
            var afterId = hasAfterId ? parsedAfterId : 0;
            var portalUrl = (configuration["Portal:PublicUrl"] ?? "https://company.example.com").Trim().TrimEnd('/');
            var query = db.Notices.AsNoTracking()
                .Where(item => item.RecipientId == companyUserId && (visibleTasks.Contains(item.TaskId) || visibleFeedback.Contains(item.TaskId)));
            if (hasAfterId) query = query.Where(item => item.Id > afterId);
            if (hasExactId) query = query.Where(item => item.Id == exactId);
            var rows = hasExactId
                ? await query.Take(1).ToListAsync()
                : latestOnly
                ? await query.OrderByDescending(item => item.Id).Take(1).ToListAsync()
                : hasAfterId
                    ? await query.OrderBy(item => item.Id).Take(take).ToListAsync()
                    : await query.OrderByDescending(item => item.CreatedAt).Take(take).ToListAsync();
            var unreadCount = await db.Notices.CountAsync(item => item.RecipientId == companyUserId && !item.IsRead && (visibleTasks.Contains(item.TaskId) || visibleFeedback.Contains(item.TaskId)));
            var items = rows.Select(item => new
            {
                source = "schedule",
                sourceLabel = "팀 일정",
                sourceId = item.Id,
                type = item.TaskId < 0 ? (item.CommentId is null ? "제보 변경" : "제보 댓글") : (item.CommentId is null ? "업무 변경" : "새 댓글"),
                title = item.TaskId < 0 ? (item.CommentId is null ? "제보 처리 알림" : "제보에 새 댓글이 등록되었습니다.") : (item.CommentId is null ? "일정 알림" : "업무에 새 댓글이 등록되었습니다."),
                message = item.Message,
                link = item.TaskId < 0
                    ? $"{portalUrl}/workspace/schedule?returnUrl={Uri.EscapeDataString($"/feedback/{-item.TaskId}{(item.CommentId is null ? "" : $"#comment-{-item.CommentId}")}")}"
                    : $"{portalUrl}/workspace/schedule?returnUrl={Uri.EscapeDataString($"/tasks/{item.TaskId}{(item.CommentId is null ? "" : $"#comment-{item.CommentId}")}")}",
                isRead = item.IsRead,
                createdAtUtc = item.CreatedAt
            }).ToArray();
            return context.Request.Query["format"] == "workspace-v2" ? Results.Ok(new { unreadCount, items }) : Results.Ok(items);
        });
        app.MapPost("/api/internal/company-notifications/read", async (HttpContext context, IConfiguration configuration, ScheduleDb db, DirectoryService directory) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!TryReadSubject(context.Request.Headers.Authorization.ToString(), configuration["Sso:SharedSecret"] ?? "", out var companyUserId)) return Results.Unauthorized();

            var query = db.Notices.Where(n => n.RecipientId == companyUserId);
            if (context.Request.Query.ContainsKey("id"))
            {
                if(!long.TryParse(context.Request.Query["id"], out var id) || id<=0) return Results.BadRequest();
                query = query.Where(n => n.Id == id);
            }
            await query.ExecuteUpdateAsync(set => set.SetProperty(n => n.IsRead, true));
            return Results.NoContent();
        });
    }

    private static bool TryReadSubject(string authorization, string secret, out long subject)
    {
        subject = 0;
        try
        {
            if (secret.Length < 32 || !authorization.StartsWith("Bearer ", StringComparison.Ordinal) || authorization.Length > 16384) return false;
            var parts = authorization[7..].Split('.');
            if (parts.Length != 2) return false;
            var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(parts[0]));
            if (!CryptographicOperations.FixedTimeEquals(signature, Decode(parts[1]))) return false;
            using var document = JsonDocument.Parse(Decode(parts[0]));
            var payload = document.RootElement;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var issuedAt = payload.GetProperty("iat").GetInt64();
            var expiresAt = payload.GetProperty("exp").GetInt64();
            var jti = payload.GetProperty("jti").GetString();
            if (payload.GetProperty("iss").GetString() != "company-portal"
                || payload.GetProperty("aud").GetString() != "company-notifications"
                || !long.TryParse(payload.GetProperty("sub").GetString(), out subject)
                || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 90 || issuedAt > now + 30 || string.IsNullOrWhiteSpace(jti)) return false;
            foreach (var entry in UsedTokens) if (entry.Value <= now) UsedTokens.TryRemove(entry.Key, out _);
            return UsedTokens.TryAdd(jti, expiresAt);
        }
        catch { return false; }
    }

    private static byte[] Decode(string value)
        => Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
}
