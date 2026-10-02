using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public static class ScheduleReadApi
{
    private static readonly ConcurrentDictionary<string, long> Used = new();
    public static void MapScheduleReadApi(this WebApplication app)
    {
        app.MapGet("/api/internal/schedule/absences", async (HttpContext ctx, IConfiguration config, AppDbContext db) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            if (!Verify(ctx.Request.Headers.Authorization.ToString(), config["CompanyPortal:SsoSharedSecret"] ?? "")) return Results.Unauthorized();
            if (!DateOnly.TryParse(ctx.Request.Query["from"], out var from) || !DateOnly.TryParse(ctx.Request.Query["to"], out var to) || from > to || to.DayNumber - from.DayNumber > 62) return Results.BadRequest(new { error = "조회 기간은 최대 62일입니다." });
            var rows = await db.LeaveRequestDates.AsNoTracking().Where(x => x.Date >= from && x.Date <= to
                && (x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested)
                && x.LeaveRequest.Employee.CompanyUserId != null && !x.LeaveRequest.Employee.IsSharedAccount && !x.LeaveRequest.Employee.IsCompanyMaster)
                .Select(x => new { employeeId = x.LeaveRequest.Employee.CompanyUserId!.Value, date = x.Date, portion = x.Portion }).ToListAsync();
            var items = rows.Select(x => new { x.employeeId, x.date, portion = x.portion switch { LeaveDayPortion.FullDay or LeaveDayPortion.Birthday => "full", LeaveDayPortion.Morning => "morning", LeaveDayPortion.Afternoon => "afternoon", _ => "other" } });
            if (ctx.Request.Query["format"] == "calendar-v2")
            {
                var holidays = await db.Holidays.AsNoTracking().Where(x => x.Date >= from && x.Date <= to)
                    .OrderBy(x => x.Date).Select(x => new { date = x.Date, name = x.Name }).ToArrayAsync();
                return Results.Ok(new { items, holidays });
            }
            return Results.Ok(items);
        });
        app.MapGet("/api/internal/schedule/holidays", async (HttpContext ctx, IConfiguration config, AppDbContext db) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            if (!Verify(ctx.Request.Headers.Authorization.ToString(), config["CompanyPortal:SsoSharedSecret"] ?? "")) return Results.Unauthorized();
            if (!DateOnly.TryParse(ctx.Request.Query["from"], out var from) || !DateOnly.TryParse(ctx.Request.Query["to"], out var to)
                || from > to || to.DayNumber - from.DayNumber > 73050)
                return Results.BadRequest(new { error = "공휴일 조회 기간이 올바르지 않습니다." });
            var holidays = await db.Holidays.AsNoTracking().Where(x => x.Date >= from && x.Date <= to)
                .OrderBy(x => x.Date).Select(x => new { date = x.Date, name = x.Name }).ToArrayAsync();
            return Results.Ok(new { holidays });
        });
    }
    public static bool Verify(string authorization, string secret)
    {
        try
        {
            if (secret.Length < 32 || !authorization.StartsWith("Bearer ") || authorization.Length > 16384) return false;
            var parts = authorization[7..].Split('.'); if (parts.Length != 2) return false;
            var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(parts[0]));
            if (!CryptographicOperations.FixedTimeEquals(signature, Decode(parts[1]))) return false;
            using var doc = JsonDocument.Parse(Decode(parts[0])); var p = doc.RootElement; var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var exp = p.GetProperty("exp").GetInt64(); var iat = p.GetProperty("iat").GetInt64(); var jti = p.GetProperty("jti").GetString();
            if (p.GetProperty("iss").GetString() != "company-schedule" || p.GetProperty("aud").GetString() != "schedule-absences" || p.GetProperty("sub").GetString() != "schedule" || exp <= now || exp <= iat || exp - iat > 90 || iat > now + 30 || string.IsNullOrWhiteSpace(jti)) return false;
            foreach (var entry in Used) if (entry.Value <= now) Used.TryRemove(entry.Key, out _);
            return Used.TryAdd(jti, exp);
        }
        catch { return false; }
    }
    private static byte[] Decode(string s) => Convert.FromBase64String(s.Replace('-', '+').Replace('_', '/') + new string('=', (4 - s.Length % 4) % 4));
}
