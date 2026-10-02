using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CompanyPortal.Services;

public sealed class InternalServiceToken(IConfiguration configuration)
{
    public string Create(string audience, long companyUserId)
    {
        var secret = (configuration["Sso:SharedSecret"] ?? "").Trim();
        if (secret.Length < 32) throw new InvalidOperationException("내부 서비스 인증 키가 설정되지 않았습니다.");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = "company-portal",
            aud = audience,
            sub = companyUserId.ToString(),
            iat = now,
            exp = now + 60,
            jti = Guid.NewGuid().ToString("N")
        });
        var payloadPart = Encode(payload);
        var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(payloadPart));
        return $"{payloadPart}.{Encode(signature)}";
    }

    private static string Encode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
