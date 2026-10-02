using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public static class ScheduleReadApi
{
    private static readonly ConcurrentDictionary<string, long> Used = new();
    public static void MapScheduleReadApi(this WebApplication app)
    {
        app.MapGet("/api/internal/schedule/directory", async (HttpContext ctx, IConfiguration config, AppDbContext db) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            if (!Verify(ctx.Request.Headers.Authorization.ToString(), config["Sso:SharedSecret"] ?? "")) return Results.Unauthorized();
            await using var tx = await db.Database.BeginTransactionAsync();
            var users = await db.Users.AsNoTracking().ToListAsync();
            var departments = await db.Departments.AsNoTracking().ToListAsync();
            var projects = await db.Projects.AsNoTracking().ToListAsync();
            var memberships = await db.ProjectMemberships.AsNoTracking().ToListAsync();
            var leads = await db.DepartmentLeads.AsNoTracking().ToListAsync();
            var result = new {
                schemaVersion = 1,
                employees = users.Select(u => new { id = u.Id, name = u.Name, departmentId = u.DepartmentId, department = u.Department ?? "", role = PermissionCatalog.CompanyRole(u), active = u.IsActive, shared = u.IsSharedAccount, isPrivate = u.IsPrivate, access = !u.IsSharedAccount && PermissionCatalog.Has(u, "schedule.access") }),
                departments = departments.Select(d => new { d.Id, d.Name, d.Archived, d.Version, d.HandlesScheduleFeedback }), projects,
                memberships = memberships.Where(m => users.Any(u => u.Id == m.EmployeeId && !u.IsSharedAccount && !u.IsMaster )),
                leads = leads.Where(l => users.Any(u => u.Id == l.EmployeeId && u.DepartmentId == l.DepartmentId && OrganizationService.EligibleLead(u)) && departments.Any(d => d.Id == l.DepartmentId && !d.Archived))
            };
            // Materialize the response while the snapshot transaction is still open.
            var json = System.Text.Json.JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
            await tx.CommitAsync();
            return Results.Content(json, "application/json");
        });
        app.MapGet("/api/internal/schedule/employees", async (HttpContext ctx, IConfiguration config, AppDbContext db) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            if (!Verify(ctx.Request.Headers.Authorization.ToString(), config["Sso:SharedSecret"] ?? "")) return Results.Unauthorized();
            var users = await db.Users.AsNoTracking().ToListAsync();
            return Results.Ok(users.Select(u => new { id = u.Id, name = u.Name, department = u.Department?.Trim() ?? "", role = PermissionCatalog.CompanyRole(u), active = u.IsActive, shared = u.IsSharedAccount, isPrivate = u.IsPrivate, access = !u.IsSharedAccount && PermissionCatalog.Has(u, "schedule.access") }));
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
            if (p.GetProperty("iss").GetString() != "company-schedule" || p.GetProperty("aud").GetString() != "schedule-directory" || p.GetProperty("sub").GetString() != "schedule" || exp <= now || exp <= iat || exp - iat > 90 || iat > now + 30 || string.IsNullOrWhiteSpace(jti)) return false;
            foreach (var entry in Used) if (entry.Value <= now) Used.TryRemove(entry.Key, out _);
            return Used.TryAdd(jti, exp);
        }
        catch { return false; }
    }
    private static byte[] Decode(string s) => Convert.FromBase64String(s.Replace('-', '+').Replace('_', '/') + new string('=', (4 - s.Length % 4) % 4));
}
