using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CompanyPortal.Models;

namespace CompanyPortal.Services;

public sealed record SsoLaunch(string CallbackUrl, string Token);

public class SsoTokenService(IConfiguration configuration, IHttpContextAccessor accessor)
{
    public SsoLaunch Create(CompanyUser user, string system, string? returnUrl = null)
    {
        var definition = CompanySystemCatalog.Find(system)
            ?? throw new InvalidOperationException("지원하지 않는 사내 시스템입니다.");
        var baseUrl = configuration[definition.BaseUrlConfigurationKey] ?? "";

        if (!PermissionCatalog.Has(user, definition.AccessPermission))
            throw new UnauthorizedAccessException("해당 시스템 접근 권한이 없습니다.");

        var secret = (configuration["Sso:SharedSecret"] ?? "").Trim();
        if (secret.Length < 32)
            throw new InvalidOperationException("Sso:SharedSecret에 32자 이상의 공유 키가 필요합니다.");

        if (!TryNormalizeBaseUrl(baseUrl, out var normalizedBaseUrl))
            throw new InvalidOperationException($"{definition.BaseUrlConfigurationKey} 설정이 올바르지 않습니다.");

        var now = DateTimeOffset.UtcNow;
        var safeReturnUrl = NormalizeReturnUrl(returnUrl);
        var payload = new Dictionary<string, object?>
        {
            ["iss"] = (configuration["Sso:Issuer"] ?? "company-portal").Trim(),
            ["aud"] = definition.Audience,
            ["sub"] = user.Id.ToString(),
            ["sid"] = accessor.HttpContext?.User.FindFirst(WorkspaceApi.SessionClaim)?.Value,
            ["name"] = user.Name,
            ["email"] = user.Email,
            ["department"] = user.Department,
            ["hireDate"] = user.HireDate.ToString("yyyy-MM-dd"),
            ["accountType"] = PermissionCatalog.AccountType(user),
            ["isPrivate"] = user.IsPrivate,
            ["role"] = PermissionCatalog.CompanyRole(user),
            ["permissions"] = PermissionCatalog.Effective(user),
            ["iat"] = now.ToUnixTimeSeconds(),
            ["exp"] = now.AddMinutes(1).ToUnixTimeSeconds(),
            ["jti"] = Guid.NewGuid().ToString("N")
        };
        if (safeReturnUrl is not null)
            payload["returnUrl"] = safeReturnUrl;
        // 생일은 연차 달력의 제한된 표시에만 필요하며 다른 서비스 토큰에는 싣지 않는다.
        if (definition.Key == "leave")
            payload["birthDate"] = user.BirthDate?.ToString("MM-dd", System.Globalization.CultureInfo.InvariantCulture);

        var payloadPart = Base64UrlEncode(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signaturePart = Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadPart)));
        return new SsoLaunch(
            new Uri(new Uri(normalizedBaseUrl + "/"), "auth/sso/callback").ToString(),
            $"{payloadPart}.{signaturePart}");
    }

    private static string? NormalizeReturnUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > 2048 || !trimmed.StartsWith('/') || trimmed.StartsWith("//")) return null;
        return trimmed;
    }

    private static bool TryNormalizeBaseUrl(string? value, out string normalized)
    {
        normalized = "";
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Host is not "localhost" and not "127.0.0.1") return false;
        normalized = uri.ToString().TrimEnd('/');
        return true;
    }

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
