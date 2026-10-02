namespace LeaveManager.Services;

public class NotificationTextFormatter(IConfiguration config)
{
    private const int DiscordMessageLimit = 2000;
    private const string DefaultPublicBaseUrl = "https://leave.example.com";

    public string BuildExternalContent(NotificationPayload payload)
    {
        return BuildExternalContent(payload.Title, payload.Message, payload.Link);
    }

    public string BuildExternalContent(string title, string message, string? link = null)
    {
        var normalizedTitle = string.IsNullOrWhiteSpace(title) ? "알림" : title.Trim();
        var normalizedMessage = message?.Trim() ?? string.Empty;
        var text = $"[연차관리 알림]\n**{normalizedTitle}**";

        if (!string.IsNullOrWhiteSpace(normalizedMessage))
            text += $"\n{normalizedMessage}";

        var absoluteLink = BuildAbsoluteLink(link);
        if (string.IsNullOrWhiteSpace(absoluteLink))
            return Truncate(text, DiscordMessageLimit);

        // 채널 웹훅과 개인 DM 모두 동일한 문구와 절대 URL을 사용합니다.
        // Discord가 URL을 자동 링크로 인식하도록 URL 원문을 별도 줄에 표시합니다.
        var linkText = $"\n\n**바로 확인하기**\n{absoluteLink}";
        var bodyLimit = Math.Max(0, DiscordMessageLimit - linkText.Length);
        return Truncate(text, bodyLimit) + linkText;
    }

    public string? BuildAbsoluteLink(string? link)
    {
        if (string.IsNullOrWhiteSpace(link)) return null;

        var trimmedLink = link.Trim();
        if (Uri.TryCreate(trimmedLink, UriKind.Absolute, out var absoluteUri)
            && (absoluteUri.Scheme == Uri.UriSchemeHttp || absoluteUri.Scheme == Uri.UriSchemeHttps))
        {
            return absoluteUri.AbsoluteUri;
        }

        var baseUrl = GetPublicBaseUrl().TrimEnd('/') + "/";
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri))
            baseUri = new Uri(DefaultPublicBaseUrl + "/");

        return new Uri(baseUri, trimmedLink.TrimStart('/')).AbsoluteUri;
    }

    public string GetPublicBaseUrl()
    {
        var baseUrl = (config["App:PublicBaseUrl"] ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl)
            || baseUrl.Contains("leave.example.com", StringComparison.OrdinalIgnoreCase)
            || baseUrl.Contains("company-domain", StringComparison.OrdinalIgnoreCase)
            || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            return DefaultPublicBaseUrl;
        }

        return baseUrl;
    }

    private static string Truncate(string text, int maxLength)
    {
        if (maxLength <= 0) return string.Empty;
        if (text.Length <= maxLength) return text;
        if (maxLength <= 3) return text[..maxLength];
        return text[..(maxLength - 3)] + "...";
    }
}
