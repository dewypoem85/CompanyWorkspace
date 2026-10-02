using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LeaveManager.Services;

public sealed record CompanySsoUser(
    long CompanyUserId,
    string Name,
    string Email,
    string? Department,
    DateOnly HireDate,
    string AccountType,
    string CompanyRole,
    IReadOnlySet<string> Permissions,
    bool Active,
    string Jti,
    long ExpiresAt,
    string? ReturnUrl,
    string? SessionId = null,
    bool IsPrivate = false,
    DateOnly? BirthDate = null,
    bool BirthDateSupplied = false);

public class CompanySsoService(IConfiguration configuration)
{
    public const string LeaveAccess = "leave.access";
    public const string LoginAudience = "leave";
    public const string ProvisionAudience = "leave-provision";
    private const string LegacyLeaveAdmin = "leave.admin";
    private const string LegacyLeaveMaster = "leave.master";

    private readonly ConcurrentDictionary<string, long> usedJtis = new(StringComparer.Ordinal);

    public CompanySsoUser VerifyAndConsume(string token)
    {
        var user = VerifyAndConsume(token, LoginAudience, requireActiveClaim: false);
        if (!user.Permissions.Contains(LeaveAccess))
            throw new UnauthorizedAccessException("연차관리 접근 권한이 없습니다.");
        return user;
    }

    public CompanySsoUser VerifyProvisionAndConsume(string token)
        => VerifyAndConsume(token, ProvisionAudience, requireActiveClaim: true);

    private CompanySsoUser VerifyAndConsume(string token, string expectedAudience, bool requireActiveClaim)
    {
        var secret = (configuration["CompanyPortal:SsoSharedSecret"] ?? "").Trim();
        if (secret.Length < 32)
            throw new InvalidOperationException("CompanyPortal:SsoSharedSecret에 32자 이상의 공유 키가 필요합니다.");

        var parts = token.Trim().Split('.');
        if (parts.Length != 2 || parts.Any(string.IsNullOrWhiteSpace))
            throw new UnauthorizedAccessException("SSO 토큰 형식이 올바르지 않습니다.");

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expectedSignature = hmac.ComputeHash(Encoding.UTF8.GetBytes(parts[0]));
        byte[] providedSignature;
        try { providedSignature = Base64UrlDecode(parts[1]); }
        catch { throw new UnauthorizedAccessException("SSO 토큰 서명을 읽을 수 없습니다."); }
        if (expectedSignature.Length != providedSignature.Length
            || !CryptographicOperations.FixedTimeEquals(expectedSignature, providedSignature))
            throw new UnauthorizedAccessException("SSO 토큰 서명이 올바르지 않습니다.");

        JsonElement root;
        try
        {
            using var document = JsonDocument.Parse(Base64UrlDecode(parts[0]));
            root = document.RootElement.Clone();
        }
        catch
        {
            throw new UnauthorizedAccessException("SSO 토큰 본문을 읽을 수 없습니다.");
        }

        var issuer = configuration["CompanyPortal:SsoIssuer"]?.Trim() ?? "company-portal";
        if (ReadString(root, "iss") != issuer || ReadString(root, "aud") != expectedAudience)
            throw new UnauthorizedAccessException("SSO 토큰 발급자 또는 대상이 올바르지 않습니다.");

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var exp = ReadInt64(root, "exp");
        var iat = ReadInt64(root, "iat");
        if (exp < now || iat > now + 60)
            throw new UnauthorizedAccessException("SSO 토큰이 만료되었거나 발급 시간이 올바르지 않습니다.");

        var sub = ReadString(root, "sub");
        var name = ReadString(root, "name").Trim();
        var email = ReadString(root, "email").Trim().ToLowerInvariant();
        var accountType = ReadOptionalString(root, "accountType")?.Trim().ToLowerInvariant() ?? "employee";
        var companyRole = ReadString(root, "role").Trim().ToLowerInvariant();
        var jti = ReadString(root, "jti");
        var hireDateText = ReadString(root, "hireDate");
        var birthDateSupplied = root.TryGetProperty("birthDate", out var birthDateValue);
        DateOnly? birthDate = null;
        if (birthDateSupplied && birthDateValue.ValueKind != JsonValueKind.Null)
        {
            if (birthDateValue.ValueKind != JsonValueKind.String
                || !TryParseBirthMonthDay(birthDateValue.GetString(), out var parsedBirthDate))
                throw new UnauthorizedAccessException("SSO 사용자 생일 정보가 올바르지 않습니다.");
            birthDate = parsedBirthDate;
        }
        var permissions = ReadPermissions(root);

        // 배포 순서 동안 구 Portal의 로그인 토큰만 한시적으로 수용한다.
        // 새 provision 계약과 role 값이 있는 토큰에는 이 호환 규칙을 적용하지 않는다.
        if (expectedAudience == LoginAudience && string.IsNullOrWhiteSpace(companyRole))
        {
            companyRole = permissions.Contains(LegacyLeaveMaster)
                ? "master"
                : permissions.Contains(LegacyLeaveAdmin)
                    ? "admin"
                    : "employee";
        }

        if (!long.TryParse(sub, out var companyUserId)
            || string.IsNullOrWhiteSpace(name)
            || string.IsNullOrWhiteSpace(email)
            || string.IsNullOrWhiteSpace(jti)
            || accountType is not ("employee" or "shared")
            || companyRole is not ("employee" or "admin" or "master")
            || !DateOnly.TryParse(hireDateText, out var hireDate))
            throw new UnauthorizedAccessException("SSO 사용자 정보가 올바르지 않습니다.");

        var active = requireActiveClaim ? ReadBoolean(root, "active") : true;

        CleanupUsedJtis(now);
        if (!usedJtis.TryAdd(jti, exp))
            throw new UnauthorizedAccessException("이미 사용된 SSO 토큰입니다. 회사 포털에서 다시 시도해 주세요.");

        return new CompanySsoUser(
            companyUserId,
            name,
            email,
            ReadOptionalString(root, "department"),
            hireDate,
            accountType,
            companyRole,
            permissions,
            active,
            jti,
            exp,
            ReadOptionalString(root, "returnUrl"), ReadOptionalString(root, "sid"), root.TryGetProperty("isPrivate", out var hidden) && hidden.ValueKind == JsonValueKind.True,
            birthDate, birthDateSupplied);
    }

    private static bool TryParseBirthMonthDay(string? value, out DateOnly result)
    {
        result = default;
        var text = value?.Trim();
        if (text?.Length == 5)
            return DateOnly.TryParseExact("2000-" + text, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out result);

        // Portal/Leave 순차 배포 중 기존 yyyy-MM-dd 서명 토큰도 월·일만 취해 수용한다.
        if (text?.Length == 10
            && DateOnly.TryParseExact(text, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var legacy))
        {
            result = new DateOnly(2000, legacy.Month, legacy.Day);
            return true;
        }
        return false;
    }

    private void CleanupUsedJtis(long now)
    {
        foreach (var pair in usedJtis)
            if (pair.Value < now) usedJtis.TryRemove(pair.Key, out _);
    }

    private static IReadOnlySet<string> ReadPermissions(JsonElement root)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (root.TryGetProperty("permissions", out var value) && value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray())
                if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                    result.Add(item.GetString()!);
        return result;
    }

    private static string ReadString(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    private static string? ReadOptionalString(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static long ReadInt64(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.TryGetInt64(out var result)
            ? result
            : throw new UnauthorizedAccessException($"SSO 토큰의 {name} 값이 올바르지 않습니다.");

    private static bool ReadBoolean(JsonElement root, string name)
        => root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? value.GetBoolean()
            : throw new UnauthorizedAccessException($"SSO 토큰의 {name} 값이 올바르지 않습니다.");

    private static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized += (normalized.Length % 4) switch { 2 => "==", 3 => "=", _ => "" };
        return Convert.FromBase64String(normalized);
    }
}
