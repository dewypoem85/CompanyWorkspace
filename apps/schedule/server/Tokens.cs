using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Schedule;

public static class Tokens
{
    public static string Encode(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static byte[] Decode(string value) => Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/') + new string('=', (4 - value.Length % 4) % 4));
    public static string Sign(object payload, string secret)
    {
        var body = Encode(JsonSerializer.SerializeToUtf8Bytes(payload));
        return body + "." + Encode(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body)));
    }
    public static JsonElement Verify(string token, string secret, string issuer, string audience)
    {
        try
        {
            var p = token.Split('.');
            if (secret.Length < 32 || p.Length != 2 || token.Length > 16384) throw new Exception();
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(p[0]));
            if (!CryptographicOperations.FixedTimeEquals(expected, Decode(p[1]))) throw new Exception();
            using var doc = JsonDocument.Parse(Decode(p[0]));
            var d = doc.RootElement;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var iat = d.GetProperty("iat").GetInt64();
            var exp = d.GetProperty("exp").GetInt64();
            if (d.GetProperty("iss").GetString() != issuer || d.GetProperty("aud").GetString() != audience || exp <= now || iat > now + 30 || exp - iat > 90 || exp <= iat || string.IsNullOrWhiteSpace(d.GetProperty("jti").GetString())) throw new Exception();
            return d.Clone();
        }
        catch { throw new ApiError(401, "인증 토큰이 올바르지 않거나 만료되었습니다."); }
    }
    public static string Service(string audience, string secret)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return Sign(new { iss = "company-schedule", aud = audience, sub = "schedule", iat = now, exp = now + 60, jti = Guid.NewGuid().ToString("N") }, secret);
    }
}
