using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using LeaveManager.Models;

namespace LeaveManager.Services;

public record DiscordLinkedUser(string Id, string Username, string? GlobalName)
{
    public string DisplayName => string.IsNullOrWhiteSpace(GlobalName) ? Username : $"{GlobalName} ({Username})";
}

public class DiscordDirectMessageService(IHttpClientFactory clients, IConfiguration config, NotificationTextFormatter formatter)
{
    public string ClientId => config["Discord:ClientId"] ?? "";
    public string ClientSecret => config["Discord:ClientSecret"] ?? "";
    public string BotToken => config["Discord:BotToken"] ?? "";

    public string RedirectUri
    {
        get
        {
            var explicitUri = config["Discord:OAuthRedirectUri"];
            if (!string.IsNullOrWhiteSpace(explicitUri)) return explicitUri.Trim();
            var baseUrl = (config["App:PublicBaseUrl"] ?? "").TrimEnd('/');
            return string.IsNullOrWhiteSpace(baseUrl) ? "" : baseUrl + "/Auth/DiscordCallback";
        }
    }

    public bool IsOAuthConfigured => !string.IsNullOrWhiteSpace(ClientId)
        && !string.IsNullOrWhiteSpace(ClientSecret)
        && !string.IsNullOrWhiteSpace(RedirectUri);

    public bool IsBotConfigured => !string.IsNullOrWhiteSpace(BotToken);
    public bool IsConfigured => IsOAuthConfigured && IsBotConfigured;

    public string BuildAuthorizationUrl(string state)
    {
        if (!IsOAuthConfigured) throw new InvalidOperationException("Discord OAuth 설정이 없습니다.");
        return "https://discord.com/oauth2/authorize"
            + $"?client_id={Uri.EscapeDataString(ClientId)}"
            + "&response_type=code"
            + $"&redirect_uri={Uri.EscapeDataString(RedirectUri)}"
            + $"&scope={Uri.EscapeDataString("identify")}" 
            + $"&state={Uri.EscapeDataString(state)}";
    }

    public async Task<DiscordLinkedUser> ExchangeCodeForUserAsync(string code)
    {
        if (!IsOAuthConfigured) throw new InvalidOperationException("Discord OAuth 설정이 없습니다.");

        var http = clients.CreateClient();
        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, "https://discord.com/api/oauth2/token");
        tokenReq.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["client_secret"] = ClientSecret,
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = RedirectUri
        });

        using var tokenRes = await http.SendAsync(tokenReq);
        var tokenBody = await tokenRes.Content.ReadAsStringAsync();
        if (!tokenRes.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord 토큰 발급 실패: {(int)tokenRes.StatusCode} {tokenBody}");

        using var tokenDoc = JsonDocument.Parse(tokenBody);
        var accessToken = tokenDoc.RootElement.GetProperty("access_token").GetString();
        if (string.IsNullOrWhiteSpace(accessToken))
            throw new InvalidOperationException("Discord access token을 확인할 수 없습니다.");

        using var userReq = new HttpRequestMessage(HttpMethod.Get, "https://discord.com/api/users/@me");
        userReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var userRes = await http.SendAsync(userReq);
        var userBody = await userRes.Content.ReadAsStringAsync();
        if (!userRes.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord 사용자 정보 조회 실패: {(int)userRes.StatusCode} {userBody}");

        using var userDoc = JsonDocument.Parse(userBody);
        var root = userDoc.RootElement;
        var id = root.GetProperty("id").GetString() ?? "";
        var username = root.TryGetProperty("username", out var usernameElement) ? usernameElement.GetString() ?? "" : "";
        string? globalName = null;
        if (root.TryGetProperty("global_name", out var globalNameElement) && globalNameElement.ValueKind != JsonValueKind.Null)
            globalName = globalNameElement.GetString();

        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Discord 사용자 ID를 확인할 수 없습니다.");
        if (string.IsNullOrWhiteSpace(username)) username = id;
        return new DiscordLinkedUser(id, username, globalName);
    }

    public async Task<bool> SendIfEnabledAsync(Employee employee, NotificationPayload payload)
    {
        if (!IsBotConfigured) return false;
        if (!employee.DiscordDmEnabled) return false;
        if (string.IsNullOrWhiteSpace(employee.DiscordUserId)) return false;
        if (!DiscordDmNotificationCatalog.IsAllowed(payload.Type, employee.Role)) return false;

        var selected = DiscordDmNotificationCatalog.ParseSelected(employee.DiscordDmNotificationTypes);
        if (!selected.Contains(payload.Type)) return false;

        await SendDirectMessageAsync(employee.DiscordUserId, payload);
        return true;
    }

    public Task<bool> SendIfEnabledAsync(Employee employee, string type, string title, string message, string? link = null)
    {
        return SendIfEnabledAsync(employee, new NotificationPayload(type, title, message, link));
    }

    public async Task SendTestAsync(Employee employee)
    {
        if (!IsBotConfigured) throw new InvalidOperationException("Discord Bot Token이 설정되어 있지 않습니다.");
        if (string.IsNullOrWhiteSpace(employee.DiscordUserId)) throw new InvalidOperationException("Discord 계정이 연동되어 있지 않습니다.");

        var payload = new NotificationPayload(
            "DiscordDmTest",
            "디스코드 개인 알림 테스트",
            "이 메시지가 보이면 Discord 개인 DM 연동이 정상입니다.",
            "/Settings/Discord");

        await SendDirectMessageAsync(employee.DiscordUserId, payload);
    }

    public Task SendDirectMessageAsync(string discordUserId, string title, string message, string? link = null)
    {
        return SendDirectMessageAsync(discordUserId, new NotificationPayload("DirectMessage", title, message, link));
    }

    public async Task SendDirectMessageAsync(string discordUserId, NotificationPayload payload)
    {
        if (string.IsNullOrWhiteSpace(discordUserId)) throw new InvalidOperationException("Discord 사용자 ID가 없습니다.");
        if (!IsBotConfigured) throw new InvalidOperationException("Discord Bot Token이 설정되어 있지 않습니다.");

        var http = clients.CreateClient();
        var botToken = BotToken.Trim();
        if (botToken.StartsWith("Bot ", StringComparison.OrdinalIgnoreCase)) botToken = botToken[4..].Trim();
        using var channelReq = new HttpRequestMessage(HttpMethod.Post, "https://discord.com/api/v10/users/@me/channels");
        channelReq.Headers.Authorization = new AuthenticationHeaderValue("Bot", botToken);
        channelReq.Content = new StringContent(JsonSerializer.Serialize(new { recipient_id = discordUserId }), Encoding.UTF8, "application/json");

        using var channelRes = await http.SendAsync(channelReq);
        var channelBody = await channelRes.Content.ReadAsStringAsync();
        if (!channelRes.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord DM 채널 생성 실패: {(int)channelRes.StatusCode} {channelBody}");

        using var channelDoc = JsonDocument.Parse(channelBody);
        var channelId = channelDoc.RootElement.GetProperty("id").GetString();
        if (string.IsNullOrWhiteSpace(channelId)) throw new InvalidOperationException("Discord DM 채널 ID를 확인할 수 없습니다.");

        var content = formatter.BuildExternalContent(payload);
        using var messageReq = new HttpRequestMessage(HttpMethod.Post, $"https://discord.com/api/v10/channels/{Uri.EscapeDataString(channelId)}/messages");
        messageReq.Headers.Authorization = new AuthenticationHeaderValue("Bot", botToken);
        messageReq.Content = new StringContent(JsonSerializer.Serialize(new
        {
            content,
            allowed_mentions = new { parse = Array.Empty<string>() }
        }), Encoding.UTF8, "application/json");

        using var messageRes = await http.SendAsync(messageReq);
        var messageBody = await messageRes.Content.ReadAsStringAsync();
        if (!messageRes.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord DM 발송 실패: {(int)messageRes.StatusCode} {messageBody}");
    }
}
