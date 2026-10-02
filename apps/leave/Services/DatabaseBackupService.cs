using System.Data;
using LeaveManager.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class DatabaseBackupService(IServiceProvider serviceProvider, IConfiguration configuration, ILogger<DatabaseBackupService> logger) : BackgroundService
{
    private readonly TimeSpan _interval = TimeSpan.FromHours(Math.Max(1, int.TryParse(configuration["Backup:IntervalHours"], out var h) ? h : 24));
    private readonly bool _enabled = !bool.TryParse(configuration["Backup:Enabled"], out var enabled) || enabled;
    private readonly string _backupPath = configuration["Backup:Path"] ?? "data/backups";
    private readonly int _retentionDays = Math.Max(1, int.TryParse(configuration["Backup:RetentionDays"], out var d) ? d : 14);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled) return;
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken).ContinueWith(_ => { }, TaskScheduler.Default);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunBackupAsync(stoppingToken); }
            catch (Exception ex) { logger.LogError(ex, "DB 자동 백업 실패"); }
            await Task.Delay(_interval, stoppingToken);
        }
    }

    private async Task RunBackupAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(_backupPath);
        await using var scope = serviceProvider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var target = Path.Combine(_backupPath, $"leave-manager-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.db");

        var sourceConnection = (SqliteConnection)db.Database.GetDbConnection();
        var shouldCloseSource = sourceConnection.State != ConnectionState.Open;
        if (shouldCloseSource) await sourceConnection.OpenAsync(ct);

        try
        {
            var connectionStringBuilder = new SqliteConnectionStringBuilder
            {
                DataSource = target,
                Mode = SqliteOpenMode.ReadWriteCreate
            };
            await using var destinationConnection = new SqliteConnection(connectionStringBuilder.ToString());
            await destinationConnection.OpenAsync(ct);
            ct.ThrowIfCancellationRequested();
            sourceConnection.BackupDatabase(destinationConnection);
            ct.ThrowIfCancellationRequested();
        }
        finally
        {
            if (shouldCloseSource) await sourceConnection.CloseAsync();
        }

        var cutoff = DateTimeOffset.UtcNow.AddDays(-_retentionDays);
        foreach (var file in Directory.GetFiles(_backupPath, "leave-manager-*.db"))
        {
            try
            {
                var info = new FileInfo(file);
                if (info.CreationTimeUtc < cutoff.UtcDateTime) info.Delete();
            }
            catch (Exception ex) { logger.LogWarning(ex, "오래된 백업 삭제 실패: {File}", file); }
        }
        logger.LogInformation("DB 자동 백업 완료: {Target}", target);
    }
}
