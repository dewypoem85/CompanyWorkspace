using Microsoft.EntityFrameworkCore;

namespace Schedule;
public class Maintenance(IServiceScopeFactory scopes, IConfiguration config, ILogger<Maintenance> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
                var cutoff = DateTime.UtcNow.AddHours(-24);
                var expired = await db.Attachments.Where(x => x.TaskId == null && x.FeedbackId == null && x.CreatedAt < cutoff).ToListAsync(stoppingToken);
                foreach (var image in expired)
                {
                    var path = Path.Combine(config["DataPath"]!, "images", image.Id);
                    if (File.Exists(path)) File.Delete(path);
                    db.Attachments.Remove(image);
                }
                await db.ConsumedTokens.Where(x => x.ExpiresAt < DateTime.UtcNow).ExecuteDeleteAsync(stoppingToken);
                await db.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex) { logger.LogError(ex, "Temporary image cleanup failed"); }
        }
    }
}
