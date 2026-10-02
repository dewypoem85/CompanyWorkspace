using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CompanyPortal.Models;

namespace CompanyPortal.Services;

public sealed class LeaveProvisioningTokenService(IConfiguration configuration)
{
    public const string Audience = "leave-provision";

    public string Create(CompanyUser user)
    {
        var secret = (configuration["Sso:SharedSecret"] ?? "").Trim();
        if (secret.Length < 32)
            throw new InvalidOperationException("Sso:SharedSecret에 32자 이상의 공유 키가 필요합니다.");

        var now = DateTimeOffset.UtcNow;
        var payload = new Dictionary<string, object?>
        {
            ["iss"] = (configuration["Sso:Issuer"] ?? "company-portal").Trim(),
            ["aud"] = Audience,
            ["sub"] = user.Id.ToString(),
            ["name"] = user.Name,
            ["email"] = user.Email,
            ["department"] = user.Department,
            ["hireDate"] = user.HireDate.ToString("yyyy-MM-dd"),
            ["birthDate"] = user.BirthDate?.ToString("MM-dd", System.Globalization.CultureInfo.InvariantCulture),
            ["accountType"] = PermissionCatalog.AccountType(user),
            ["isPrivate"] = user.IsPrivate,
            ["active"] = user.IsActive && !user.IsSharedAccount,
            ["role"] = PermissionCatalog.CompanyRole(user),
            ["permissions"] = PermissionCatalog.Effective(user),
            ["iat"] = now.ToUnixTimeSeconds(),
            ["exp"] = now.AddMinutes(1).ToUnixTimeSeconds(),
            ["jti"] = Guid.NewGuid().ToString("N")
        };

        var payloadPart = Base64UrlEncode(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var signaturePart = Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadPart)));
        return $"{payloadPart}.{signaturePart}";
    }

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
