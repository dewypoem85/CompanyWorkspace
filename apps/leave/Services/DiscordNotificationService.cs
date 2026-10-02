using System.Text;
using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class DiscordNotificationService(AppDbContext db, IHttpClientFactory clients, NotificationTextFormatter formatter, ILogger<DiscordNotificationService> logger)
{
    public IReadOnlyList<DiscordWebhook> Webhooks => GetWebhooks();
    public IReadOnlyList<string> WebhookUrls => Webhooks.Select(x => x.Url).ToList();
    public int WebhookCount => Webhooks.Count;
    public bool IsConfigured => WebhookCount > 0;

    public Task NotifyNewRequestAsync(LeaveRequest request)
    {
        return NotifyAsync(NotificationMessageFactory.LeaveRequestCreatedPublic(request));
    }

    public async Task NotifyAsync(NotificationPayload payload)
    {
        if (!IsConfigured) return;
        var text = formatter.BuildExternalContent(payload);

        try
        {
            await SendTextAsync(text);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "디스코드 알림 발송 실패");
        }
    }

    public Task SendTestAsync(Employee actor) => SendTestAsync(actor,Webhooks);

    public async Task SendTestAsync(Employee actor,IReadOnlyList<DiscordWebhook> webhooks)
    {
        var payload = new NotificationPayload(
            "DiscordWebhookTest",
            "디스코드 채널 알림 테스트",
            $"{actor.Name}님이 디스코드 연차 알림 테스트를 보냈습니다.",
            "/Admin/NotificationSettings");

        await SendTextAsync(formatter.BuildExternalContent(payload),webhooks);
    }

    public Task SendTextAsync(string text) => SendTextAsync(text,Webhooks);

    private async Task SendTextAsync(string text,IReadOnlyList<DiscordWebhook> webhooks)
    {
        if (webhooks.Count == 0)
            throw new InvalidOperationException("등록된 디스코드 웹훅이 없습니다. 관리자 페이지에서 웹훅을 추가하세요.");

        var failures = new List<string>();
        foreach (var webhook in webhooks)
        {
            try
            {
                await SendTextToWebhookAsync(webhook.Url, text);
            }
            catch (Exception ex)
            {
                var label = string.IsNullOrWhiteSpace(webhook.Memo) ? MaskWebhookUrl(webhook.Url) : webhook.Memo;
                failures.Add($"{label}: {ex.Message}");
                logger.LogWarning(ex, "디스코드 웹훅 발송 실패: {WebhookMemo} {WebhookUrl}", webhook.Memo, MaskWebhookUrl(webhook.Url));
            }
        }

        if (failures.Count > 0)
            throw new InvalidOperationException($"디스코드 웹훅 {failures.Count}개 발송 실패: {string.Join(" / ", failures)}");
    }

    private async Task SendTextToWebhookAsync(string webhookUrl, string text)
    {
        var payload = JsonSerializer.Serialize(new
        {
            username = "회사 연차관리",
            content = text,
            allowed_mentions = new { parse = Array.Empty<string>() }
        });

        using var req = new HttpRequestMessage(HttpMethod.Post, webhookUrl);
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        var res = await clients.CreateClient().SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"{MaskWebhookUrl(webhookUrl)}: {(int)res.StatusCode} {body}");
    }

    private IReadOnlyList<DiscordWebhook> GetWebhooks()
    {
        return db.DiscordWebhooks
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .ToList();
    }

    public static string MaskWebhookUrl(string webhookUrl)
    {
        if (!Uri.TryCreate(webhookUrl, UriKind.Absolute, out var uri)) return "Discord 웹훅 URL";
        return $"{uri.Scheme}://{uri.IdnHost.TrimEnd('.').ToLowerInvariant()}/api/webhooks/***";
    }
}
