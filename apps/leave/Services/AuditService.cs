using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;

namespace LeaveManager.Services;

public class AuditService(AppDbContext db, IHttpContextAccessor accessor)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public async Task WriteAsync(
        long? actorId,
        string action,
        string targetType,
        object? targetId,
        object? detail = null,
        object? before = null,
        object? after = null,
        string? reason = null)
    {
        var http = accessor.HttpContext;
        var remoteAddress = http?.Connection.RemoteIpAddress;
        if (remoteAddress?.IsIPv4MappedToIPv6 == true)
            remoteAddress = remoteAddress.MapToIPv4();

        var ip = remoteAddress?.ToString();
        var ua = http?.Request.Headers.UserAgent.ToString();

        db.AuditLogs.Add(new AuditLog
        {
            ActorEmployeeId = actorId,
            Action = action,
            TargetType = targetType,
            TargetId = targetId?.ToString(),
            DetailJson = detail is null ? null : JsonSerializer.Serialize(detail, JsonOptions),
            BeforeJson = before is null ? null : JsonSerializer.Serialize(before, JsonOptions),
            AfterJson = after is null ? null : JsonSerializer.Serialize(after, JsonOptions),
            Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
            IpAddress = string.IsNullOrWhiteSpace(ip) ? null : ip,
            UserAgent = string.IsNullOrWhiteSpace(ua) ? null : ua
        });
        await db.SaveChangesAsync();
    }
}
