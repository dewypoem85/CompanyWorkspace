using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public sealed class PushNotificationDispatchWorker(
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    ILogger<PushNotificationDispatchWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(Math.Clamp(configuration.GetValue<int?>("Push:PollSeconds") ?? 30, 10, 300));
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await DispatchAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogError(exception, "Push notification dispatch iteration failed"); }
            await Task.Delay(delay, stoppingToken);
        }
    }

    internal async Task DispatchAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var sourceClient = scope.ServiceProvider.GetRequiredService<PushNotificationSourceClient>();
        var deviceService = scope.ServiceProvider.GetRequiredService<PushDeviceService>();
        var sender = scope.ServiceProvider.GetRequiredService<FcmPushSender>();
        var devices = await db.WorkspacePushDevices
            .Where(device => device.Enabled && device.ProtectedToken != "")
            .ToListAsync(cancellationToken);
        var activeDevices = new List<WorkspacePushDevice>();
        foreach (var device in devices)
            if (await WorkspaceApi.ActiveAsync(db, device.SessionId, device.UserId)) activeDevices.Add(device);

        var users = await db.Users.AsNoTracking()
            .Where(user => user.IsActive && activeDevices.Select(device => device.UserId).Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, cancellationToken);
        foreach (var group in activeDevices.GroupBy(device => device.UserId))
        {
            if (!users.TryGetValue(group.Key, out var user)) continue;
            foreach (var source in new[] { "leave", "schedule" })
            {
                try
                {
                    if (!PermissionCatalog.Has(user, source + ".access")) continue;
                    var recipients = group.Where(device => source == "leave" ? device.LeaveEnabled : device.ScheduleEnabled).ToArray();
                    if (recipients.Length == 0) continue;
                    var cursor = await db.WorkspacePushSourceCursors.FindAsync([user.Id, source], cancellationToken);
                    if (cursor is null)
                    {
                        cursor = new WorkspacePushSourceCursor
                        {
                            UserId = user.Id,
                            Source = source,
                            LastSourceId = await sourceClient.LatestIdAsync(user.Id, source, cancellationToken),
                            UpdatedAtUtc = DateTime.UtcNow
                        };
                        db.WorkspacePushSourceCursors.Add(cursor);
                        await db.SaveChangesAsync(cancellationToken);
                        continue;
                    }

                    var items = await sourceClient.ReadAfterAsync(user.Id, source, cursor.LastSourceId, 200, cancellationToken);
                    foreach (var item in items)
                    {
                        if (SafePortalLink(item.Link))
                        {
                            foreach (var device in recipients)
                            {
                                var exists = await db.WorkspacePushDeliveries.AnyAsync(
                                    delivery => delivery.DeviceId == device.Id && delivery.Source == source && delivery.SourceId == item.SourceId,
                                    cancellationToken);
                                if (!exists) db.WorkspacePushDeliveries.Add(new WorkspacePushDelivery
                                {
                                    DeviceId = device.Id,
                                    Source = source,
                                    SourceId = item.SourceId,
                                    Title = item.Title.Length <= 200 ? item.Title : item.Title[..200],
                                    Link = item.Link,
                                    Status = "pending",
                                    NextAttemptAtUtc = DateTime.UtcNow,
                                    CreatedAtUtc = DateTime.UtcNow
                                });
                            }
                        }
                        else logger.LogWarning("Discarded unsafe push link for {Source} notification {SourceId}", source, item.SourceId);
                        cursor.LastSourceId = Math.Max(cursor.LastSourceId, item.SourceId);
                        cursor.UpdatedAtUtc = DateTime.UtcNow;
                    }
                    await db.SaveChangesAsync(cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                catch (Exception exception) { logger.LogWarning(exception, "Unable to collect {Source} push notifications for user {UserId}", source, user.Id); }
            }
        }

        var due = await db.WorkspacePushDeliveries
            .Where(delivery => (delivery.Status == "pending" || delivery.Status == "retry") && delivery.NextAttemptAtUtc <= DateTime.UtcNow)
            .OrderBy(delivery => delivery.Id)
            .Take(100)
            .ToListAsync(cancellationToken);
        var deviceMap = activeDevices.ToDictionary(device => device.Id);
        foreach (var delivery in due)
        {
            if (!deviceMap.TryGetValue(delivery.DeviceId, out var device)) continue;
            string token;
            try { token = deviceService.Unprotect(device.ProtectedToken); }
            catch
            {
                DisableDevice(device);
                delivery.Status = "invalid";
                delivery.LastErrorCode = "TOKEN_UNPROTECT_FAILED";
                continue;
            }
            var item = new WorkspaceNotification(
                delivery.Source,
                delivery.Source == "leave" ? "연차관리" : "팀 일정",
                delivery.SourceId,
                "push",
                delivery.Title,
                "",
                delivery.Link,
                false,
                delivery.CreatedAtUtc);
            var result = await sender.SendAsync(token, item, cancellationToken);
            delivery.AttemptCount++;
            delivery.LastErrorCode = result.ErrorCode;
            if (result.Outcome == PushSendOutcome.Delivered)
            {
                delivery.Status = "delivered";
                delivery.DeliveredAtUtc = DateTime.UtcNow;
            }
            else if (result.Outcome == PushSendOutcome.InvalidToken)
            {
                delivery.Status = "invalid";
                DisableDevice(device);
            }
            else if (result.Outcome == PushSendOutcome.Retry)
            {
                delivery.Status = "retry";
                var minutes = Math.Min(360, Math.Pow(2, Math.Min(8, delivery.AttemptCount)));
                delivery.NextAttemptAtUtc = DateTime.UtcNow.AddMinutes(minutes);
            }
            else delivery.Status = "failed";
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    private static void DisableDevice(WorkspacePushDevice device)
    {
        device.Enabled = false;
        device.ProtectedToken = "";
        device.TokenHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"invalid:{device.Id}:{Guid.NewGuid():N}"))).ToLowerInvariant();
        device.DisabledAtUtc = DateTime.UtcNow;
        device.UpdatedAtUtc = DateTime.UtcNow;
    }

    private static bool SafePortalLink(string value)
        => Uri.TryCreate(value, UriKind.Absolute, out var uri)
           && uri.Scheme == Uri.UriSchemeHttps
           && uri.Host.Equals("company.example.com", StringComparison.OrdinalIgnoreCase)
           && (uri.AbsolutePath.StartsWith("/workspace/", StringComparison.Ordinal) || uri.AbsolutePath.StartsWith("/notifications", StringComparison.OrdinalIgnoreCase));
}
