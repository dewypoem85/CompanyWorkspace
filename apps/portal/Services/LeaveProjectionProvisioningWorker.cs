using CompanyPortal.Data;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public sealed class LeaveProjectionProvisioningWorker(
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    LeaveProvisioningTokenService tokenService,
    ILogger<LeaveProjectionProvisioningWorker> logger) : BackgroundService
{
    private static readonly TimeSpan EmptyQueueDelay = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan ProcessedItemDelay = TimeSpan.FromMilliseconds(100);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await ProcessNextAsync(stoppingToken);
                await Task.Delay(processed ? ProcessedItemDelay : EmptyQueueDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Leave 직원 투영 outbox 처리 루프에서 오류가 발생했습니다.");
                await Task.Delay(EmptyQueueDelay, stoppingToken);
            }
        }
    }

    private async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTime.UtcNow;
        var item = await db.LeaveProjectionOutbox
            .AsNoTracking()
            .Where(x => x.NextAttemptAtUtc <= now)
            .OrderBy(x => x.NextAttemptAtUtc)
            .ThenBy(x => x.CompanyUserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (item is null) return false;

        var user = await db.Users
            .AsNoTracking()
            .SingleOrDefaultAsync(x => x.Id == item.CompanyUserId, cancellationToken);
        if (user is null)
        {
            await LeaveProjectionOutboxStore.DeleteIfVersionAsync(
                db,
                item.CompanyUserId,
                item.Version,
                cancellationToken);
            logger.LogWarning(
                "존재하지 않는 Portal 사용자 {CompanyUserId}의 Leave outbox 항목을 제거했습니다.",
                item.CompanyUserId);
            return true;
        }

        try
        {
            var endpoint = BuildProvisioningEndpoint(configuration["Systems:Leave:BaseUrl"]);
            var token = tokenService.Create(user);
            using var content = new FormUrlEncodedContent(
            [
                new KeyValuePair<string, string>("token", token)
            ]);
            var client = httpClientFactory.CreateClient("LeaveProvisioning");
            using var response = await client.PostAsync(endpoint, content, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                var body = (await response.Content.ReadAsStringAsync(cancellationToken)).Trim();
                if (body.Length > 500) body = body[..500];
                throw new HttpRequestException(
                    $"Leave 프로비저닝 응답 HTTP {(int)response.StatusCode} ({response.ReasonPhrase}): {body}");
            }

            var removed = await LeaveProjectionOutboxStore.DeleteIfVersionAsync(
                db,
                item.CompanyUserId,
                item.Version,
                cancellationToken);
            if (removed > 0)
            {
                logger.LogInformation(
                    "Portal 사용자 {CompanyUserId}의 최신 상태를 Leave에 반영했습니다.",
                    item.CompanyUserId);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var attemptCount = Math.Min(item.AttemptCount + 1, 30);
            var nextAttemptAtUtc = DateTime.UtcNow.Add(Backoff(attemptCount));
            var updated = await LeaveProjectionOutboxStore.RecordFailureIfVersionAsync(
                db,
                item.CompanyUserId,
                item.Version,
                attemptCount,
                nextAttemptAtUtc,
                ex.Message,
                cancellationToken);
            if (updated > 0)
            {
                logger.LogWarning(
                    ex,
                    "Portal 사용자 {CompanyUserId}의 Leave 반영에 실패했습니다. {NextAttemptAtUtc} 이후 재시도합니다.",
                    item.CompanyUserId,
                    nextAttemptAtUtc);
            }
        }

        return true;
    }

    private static Uri BuildProvisioningEndpoint(string? baseUrl)
    {
        if (!Uri.TryCreate(baseUrl?.Trim(), UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Host is not "localhost" and not "127.0.0.1"))
            throw new InvalidOperationException("Systems:Leave:BaseUrl 설정이 올바르지 않습니다.");

        return new Uri(new Uri(uri.ToString().TrimEnd('/') + "/"), "Sso/Provision");
    }

    private static TimeSpan Backoff(int attemptCount)
    {
        var exponent = Math.Min(Math.Max(attemptCount - 1, 0), 8);
        var seconds = Math.Min(900, 5 * (1 << exponent));
        return TimeSpan.FromSeconds(seconds);
    }
}
