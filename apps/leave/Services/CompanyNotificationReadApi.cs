using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LeaveManager.Data;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public static class CompanyNotificationReadApi
{
    private static readonly ConcurrentDictionary<string, long> UsedTokens = new();

    public static void MapCompanyNotificationReadApi(this WebApplication app)
    {
        app.MapGet("/api/internal/company-notifications", async (HttpContext context, IConfiguration configuration, AppDbContext db) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!TryReadSubject(context.Request.Headers.Authorization.ToString(), configuration["CompanyPortal:SsoSharedSecret"] ?? "", out var companyUserId))
                return Results.Unauthorized();
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
            var portalUrl = (configuration["CompanyPortal:BaseUrl"] ?? "https://company.example.com").Trim().TrimEnd('/');
            var employeeId = await db.Employees.AsNoTracking()
                .Where(employee => employee.CompanyUserId == companyUserId && !employee.IsSharedAccount)
                .Select(employee => (long?)employee.Id)
                .SingleOrDefaultAsync();
            if (employeeId is null) return context.Request.Query["format"] == "workspace-v2" ? Results.Ok(new { items = Array.Empty<object>(), unreadCount = 0 }) : Results.Ok(Array.Empty<object>());
            var query = db.AppNotifications.AsNoTracking()
                .Where(item => item.RecipientEmployeeId == employeeId.Value);
            if (hasAfterId) query = query.Where(item => item.Id > afterId);
            if (hasExactId) query = query.Where(item => item.Id == exactId);
            var rows = hasExactId
                ? await query.Take(1).ToListAsync()
                : latestOnly
                ? await query.OrderByDescending(item => item.Id).Take(1).ToListAsync()
                : hasAfterId
                    ? await query.OrderBy(item => item.Id).Take(take).ToListAsync()
                    : await query.OrderByDescending(item => item.CreatedAtUtc).Take(take).ToListAsync();
            var unreadCount = await db.AppNotifications.CountAsync(item => item.RecipientEmployeeId == employeeId.Value && !item.IsRead);
            var items = rows.Select(item => new
            {
                source = "leave",
                sourceLabel = "연차관리",
                sourceId = item.Id,
                type = item.Type,
                title = item.Title,
                message = item.Message,
                link = $"{portalUrl}/workspace/leave?returnUrl={Uri.EscapeDataString($"/Notifications?handler=Open&id={item.Id}")}",
                isRead = item.IsRead,
                createdAtUtc = item.CreatedAtUtc
            }).ToArray();
            return context.Request.Query["format"] == "workspace-v2" ? Results.Ok(new { unreadCount, items }) : Results.Ok(items);
        });
        app.MapPost("/api/internal/company-notifications/read", async (HttpContext context, IConfiguration configuration, AppDbContext db) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!TryReadSubject(context.Request.Headers.Authorization.ToString(), configuration["CompanyPortal:SsoSharedSecret"] ?? "", out var companyUserId)) return Results.Unauthorized();
            var employeeId = await db.Employees.Where(e => e.CompanyUserId == companyUserId && !e.IsSharedAccount).Select(e => (long?)e.Id).SingleOrDefaultAsync();
            if (employeeId is null) return Results.NoContent();
            var query = db.AppNotifications.Where(n => n.RecipientEmployeeId == employeeId.Value);
            if (context.Request.Query.ContainsKey("id"))
            {
                if(!long.TryParse(context.Request.Query["id"], out var id) || id<=0) return Results.BadRequest();
                query = query.Where(n => n.Id == id);
            }
            await query.ExecuteUpdateAsync(set => set.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAtUtc, DateTime.UtcNow));
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
