using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace CompanyPortal.Services;

public sealed class PushNotificationSourceClient(
    IHttpClientFactory clients,
    InternalServiceToken tokens,
    IConfiguration configuration)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<WorkspaceNotification>> ReadAfterAsync(
        long userId,
        string source,
        long afterId,
        int take,
        CancellationToken cancellationToken)
    {
        var (_, url, host) = Settings(source);
        if (!Uri.TryCreate(url?.Trim().TrimEnd('/'), UriKind.Absolute, out var baseUri))
            throw new InvalidOperationException($"{source} 알림 내부 주소가 설정되지 않았습니다.");

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            new Uri(baseUri, $"/api/internal/company-notifications?format=workspace-v2&take={Math.Clamp(take, 1, 200)}&afterId={afterId}"));
        if (!string.IsNullOrWhiteSpace(host)) request.Headers.Host = host.Trim();
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Create("company-notifications", userId));
        using var response = await clients.CreateClient("NotificationSources").SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var feed = await response.Content.ReadFromJsonAsync<SourceFeed>(Json, cancellationToken)
            ?? throw new InvalidDataException($"{source} 알림 응답이 비어 있습니다.");
        return (feed.Items ?? [])
            .Where(item => item.Source == source && item.SourceId > afterId)
            .Select(item => item with
            {
                Title = string.IsNullOrWhiteSpace(item.Title) ? "새 알림" : item.Title.Trim(),
                Link = item.Link ?? ""
            })
            .OrderBy(item => item.SourceId)
            .ToArray();
    }

    public async Task<long> LatestIdAsync(long userId, string source, CancellationToken cancellationToken)
    {
        var (_, url, host) = Settings(source);
        if (!Uri.TryCreate(url?.Trim().TrimEnd('/'), UriKind.Absolute, out var baseUri))
            throw new InvalidOperationException($"{source} 알림 내부 주소가 설정되지 않았습니다.");
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(baseUri, "/api/internal/company-notifications?format=workspace-v2&take=1&latestId=true"));
        if (!string.IsNullOrWhiteSpace(host)) request.Headers.Host = host.Trim();
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.Create("company-notifications", userId));
        using var response = await clients.CreateClient("NotificationSources").SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var feed = await response.Content.ReadFromJsonAsync<SourceFeed>(Json, cancellationToken);
        return (feed?.Items ?? []).Where(item => item.Source == source).Select(item => item.SourceId).DefaultIfEmpty().Max();
    }

    public async Task<IReadOnlyDictionary<string, long>> LatestIdsAsync(long userId, IEnumerable<string> sources, CancellationToken cancellationToken)
    {
        var tasks = sources.Distinct(StringComparer.Ordinal).ToDictionary(
            source => source,
            source => LatestIdAsync(userId, source, cancellationToken),
            StringComparer.Ordinal);
        await Task.WhenAll(tasks.Values);
        return tasks.ToDictionary(item => item.Key, item => item.Value.Result, StringComparer.Ordinal);
    }

    private (string Key, string? Url, string? Host) Settings(string source)
    {
        var key = source switch { "leave" => "Leave", "schedule" => "Schedule", _ => throw new ArgumentOutOfRangeException(nameof(source)) };
        return (key, configuration[$"Notifications:{key}:InternalUrl"], configuration[$"Notifications:{key}:Host"]);
    }

    private sealed record SourceFeed(WorkspaceNotification[] Items, int UnreadCount);
}
