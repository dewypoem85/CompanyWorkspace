using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CompanyPortal.Services;

public sealed record WorkspaceNotification(
    string Source,
    string SourceLabel,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] long SourceId,
    string Type,
    string Title,
    string Message,
    string Link,
    bool IsRead,
    DateTime CreatedAtUtc);

public sealed record NotificationSourceStatus(string Source, bool Available, string? Error);
public sealed record WorkspaceNotificationFeed(
    IReadOnlyList<WorkspaceNotification> Items,
    IReadOnlyList<NotificationSourceStatus> Sources,
    int UnreadCount)
;
public sealed record WorkspaceNotificationLookup(bool Available, WorkspaceNotification? Item);

public sealed class NotificationAggregationService(
    IHttpClientFactory clients,
    InternalServiceToken tokens,
    IConfiguration configuration,
    ILogger<NotificationAggregationService> logger,
    CurrentUserService currentUser)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<WorkspaceNotificationFeed> GetAsync(long companyUserId, int take = 100, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 200);
        var user = await currentUser.GetRequiredAsync();
        var tasks = new[] { "leave", "schedule" }
            .Where(source => CompanyPortal.Models.PermissionCatalog.Has(user, source + ".access"))
            .Select(source => {
                var key = source == "leave" ? "Leave" : "Schedule";
                return ReadSourceAsync(source, source == "leave" ? "연차관리" : "팀 일정", configuration[$"Notifications:{key}:InternalUrl"], configuration[$"Notifications:{key}:Host"], companyUserId, take, cancellationToken);
            });
        var results = await Task.WhenAll(tasks);
        return new WorkspaceNotificationFeed(
            results.SelectMany(result => result.Items).OrderByDescending(item => item.CreatedAtUtc).Take(take).ToArray(),
            results.Select(result => result.Status).ToArray(), results.Sum(r => r.UnreadCount));
    }

    public async Task<WorkspaceNotificationLookup> GetOneAsync(long companyUserId, string source, long id, CancellationToken cancellationToken)
    {
        if (source is not ("leave" or "schedule") || id <= 0) return new(false, null);
        var user = await currentUser.GetRequiredAsync();
        if (user.Id != companyUserId || !CompanyPortal.Models.PermissionCatalog.Has(user, source + ".access")) return new(false, null);
        var key = source == "leave" ? "Leave" : "Schedule";
        var result = await ReadSourceAsync(source, source == "leave" ? "연차관리" : "팀 일정",
            configuration[$"Notifications:{key}:InternalUrl"], configuration[$"Notifications:{key}:Host"],
            companyUserId, 1, cancellationToken, id);
        return new(result.Status.Available, result.Items.SingleOrDefault(item => item.Source == source && item.SourceId == id));
    }

    private async Task<SourceResult> ReadSourceAsync(string source, string label, string? baseUrl, string? hostHeader, long companyUserId, int take, CancellationToken cancellationToken, long? exactId = null)
    {
        if (!Uri.TryCreate(baseUrl?.Trim().TrimEnd('/'), UriKind.Absolute, out var uri))
            return new([], new(source, false, "내부 주소가 설정되지 않았습니다."), 0);
        try
        {
            var path = $"/api/internal/company-notifications?take={take}&format=workspace-v2" + (exactId.HasValue ? $"&id={exactId.Value}" : "");
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(uri, path));
            if (!string.IsNullOrWhiteSpace(hostHeader)) request.Headers.Host = hostHeader.Trim();
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Create("company-notifications", companyUserId));
            using var response = await clients.CreateClient("NotificationSources").SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            var feed = await response.Content.ReadFromJsonAsync<SourceFeed>(Json, cancellationToken) ?? new([], 0);
            return new(feed.Items, new(source, true, null), feed.UnreadCount);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Notification source {Source} is unavailable", source);
            return new([], new(source, false, "현재 알림을 불러오지 못했습니다."), 0);
        }
    }

    public async Task<bool> MarkReadAsync(long userId, string source, long? id, CancellationToken ct)
    {
        if (source is not ("leave" or "schedule") || id is <= 0) return false;
        var user = await currentUser.GetRequiredAsync();
        if (user.Id != userId || !CompanyPortal.Models.PermissionCatalog.Has(user, source + ".access")) return false;
        return await MarkSourceReadAsync(userId, source, id, ct);
    }

    public async Task<bool> MarkAllReadAsync(CancellationToken ct)
    {
        var user = await currentUser.GetRequiredAsync();
        var results = await Task.WhenAll(new[] { "leave", "schedule" }
            .Where(source => CompanyPortal.Models.PermissionCatalog.Has(user, source + ".access"))
            .Select(source => MarkSourceReadAsync(user.Id, source, null, ct)));
        return results.All(x => x);
    }

    private async Task<bool> MarkSourceReadAsync(long userId, string source, long? id, CancellationToken ct)
    {
        try
        {
            var key = source == "leave" ? "Leave" : "Schedule";
            using var request = new HttpRequestMessage(HttpMethod.Post, configuration[$"Notifications:{key}:InternalUrl"] + "/api/internal/company-notifications/read" + (id.HasValue ? $"?id={id}" : ""));
            request.Headers.Host = configuration[$"Notifications:{key}:Host"];
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Create("company-notifications", userId));
            using var response = await clients.CreateClient("NotificationSources").SendAsync(request, ct);
            return response.IsSuccessStatusCode;
        }
        catch(Exception e) { logger.LogWarning(e, "Notification read failed for {Source}", source); return false; }
    }
    private sealed record SourceFeed(WorkspaceNotification[] Items, int UnreadCount);
    private sealed record SourceResult(IReadOnlyList<WorkspaceNotification> Items, NotificationSourceStatus Status, int UnreadCount);
}
