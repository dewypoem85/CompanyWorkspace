using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class NotificationService(AppDbContext db, DiscordDirectMessageService discordDm, ILogger<NotificationService> logger)
{
    public async Task<int> GetUnreadCountAsync(long employeeId)
    {
        return await db.AppNotifications.CountAsync(x => x.RecipientEmployeeId == employeeId && !x.IsRead);
    }

    public async Task<IReadOnlyList<AppNotification>> GetRecentAsync(long employeeId, int take = 80)
    {
        return await db.AppNotifications
            .Where(x => x.RecipientEmployeeId == employeeId)
            .OrderByDescending(x => x.CreatedAtUtc)
            .Take(take)
            .ToListAsync();
    }

    public async Task<long> GetLatestIdAsync(long employeeId)
    {
        return await db.AppNotifications
            .Where(x => x.RecipientEmployeeId == employeeId)
            .OrderByDescending(x => x.Id)
            .Select(x => x.Id)
            .FirstOrDefaultAsync();
    }

    public async Task<IReadOnlyList<AppNotification>> GetUnreadAfterAsync(long employeeId, long afterId, int take = 10)
    {
        return await db.AppNotifications
            .Where(x => x.RecipientEmployeeId == employeeId && !x.IsRead && x.Id > afterId)
            .OrderBy(x => x.Id)
            .Take(take)
            .ToListAsync();
    }

    public async Task NotifyAsync(long recipientEmployeeId, NotificationPayload payload)
    {
        db.AppNotifications.Add(new AppNotification
        {
            RecipientEmployeeId = recipientEmployeeId,
            Type = payload.Type,
            Title = payload.Title,
            Message = payload.Message,
            Link = payload.Link,
            IsRead = false,
            CreatedAtUtc = AppTime.UtcNow
        });
        await db.SaveChangesAsync();
        await TrySendDiscordDmAsync(new[] { recipientEmployeeId }, payload);
    }

    public Task NotifyAsync(long recipientEmployeeId, string type, string title, string message, string? link = null)
    {
        return NotifyAsync(recipientEmployeeId, new NotificationPayload(type, title, message, link));
    }

    public async Task NotifyManyAsync(IEnumerable<long> recipientEmployeeIds, NotificationPayload payload)
    {
        var ids = recipientEmployeeIds.Distinct().ToList();
        if (ids.Count == 0) return;

        var now = AppTime.UtcNow;
        foreach (var id in ids)
        {
            db.AppNotifications.Add(new AppNotification
            {
                RecipientEmployeeId = id,
                Type = payload.Type,
                Title = payload.Title,
                Message = payload.Message,
                Link = payload.Link,
                IsRead = false,
                CreatedAtUtc = now
            });
        }

        await db.SaveChangesAsync();
        await TrySendDiscordDmAsync(ids, payload);
    }

    public Task NotifyManyAsync(IEnumerable<long> recipientEmployeeIds, string type, string title, string message, string? link = null)
    {
        return NotifyManyAsync(recipientEmployeeIds, new NotificationPayload(type, title, message, link));
    }

    public async Task NotifyAdminsAsync(NotificationPayload payload)
    {
        var ids = await db.Employees
            .Where(x => x.IsActive && (x.Role == EmployeeRole.Admin || x.Role == EmployeeRole.Master))
            .Select(x => x.Id)
            .ToListAsync();

        await NotifyManyAsync(ids, payload);
    }

    public Task NotifyAdminsAsync(string type, string title, string message, string? link = null)
    {
        return NotifyAdminsAsync(new NotificationPayload(type, title, message, link));
    }

    private async Task TrySendDiscordDmAsync(IEnumerable<long> employeeIds, NotificationPayload payload)
    {
        var ids = employeeIds.Distinct().ToList();
        if (ids.Count == 0 || !discordDm.IsBotConfigured) return;

        var employees = await db.Employees
            .Where(x => ids.Contains(x.Id) && x.IsActive)
            .ToListAsync();

        foreach (var employee in employees)
        {
            try
            {
                await discordDm.SendIfEnabledAsync(employee, payload);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Discord 개인 DM 발송 실패: EmployeeId={EmployeeId}, Type={Type}", employee.Id, payload.Type);
            }
        }
    }

    public async Task<bool> MarkReadAsync(long notificationId, long employeeId)
    {
        var n = await db.AppNotifications.SingleOrDefaultAsync(x => x.Id == notificationId && x.RecipientEmployeeId == employeeId);
        if (n is null) return false;
        if (!n.IsRead)
        {
            n.IsRead = true;
            n.ReadAtUtc = AppTime.UtcNow;
            await db.SaveChangesAsync();
        }
        return true;
    }

    public async Task MarkAllReadAsync(long employeeId)
    {
        var unread = await db.AppNotifications
            .Where(x => x.RecipientEmployeeId == employeeId && !x.IsRead)
            .ToListAsync();
        var now = AppTime.UtcNow;
        foreach (var n in unread)
        {
            n.IsRead = true;
            n.ReadAtUtc = now;
        }
        await db.SaveChangesAsync();
    }
}
