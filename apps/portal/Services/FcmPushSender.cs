using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CompanyPortal.Services;

public enum PushSendOutcome { Delivered, Retry, InvalidToken, Failed, Disabled }
public sealed record PushSendResult(PushSendOutcome Outcome, string? ErrorCode = null);

public sealed class FcmPushSender(IHttpClientFactory clients, IConfiguration configuration, ILogger<FcmPushSender> logger)
{
    private readonly SemaphoreSlim tokenLock = new(1, 1);
    private string? accessToken;
    private DateTimeOffset accessTokenExpiresAt;
    private ServiceAccount? account;

    public bool Enabled => configuration.GetValue<bool>("Push:Enabled");

    public async Task<PushSendResult> SendAsync(string token, WorkspaceNotification notification, CancellationToken cancellationToken)
    {
        if (!Enabled) return new(PushSendOutcome.Disabled, "PUSH_DISABLED");
        try
        {
            var credentials = LoadAccount();
            var bearer = await GetAccessTokenAsync(credentials, cancellationToken);
            var serviceLabel = notification.Source == "leave" ? "연차관리" : "팀 일정";
            using var request = new HttpRequestMessage(HttpMethod.Post,
                $"https://fcm.googleapis.com/v1/projects/{Uri.EscapeDataString(credentials.ProjectId)}/messages:send");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            request.Content = JsonContent.Create(new
            {
                message = new
                {
                    token,
                    data = new Dictionary<string, string>
                    {
                        ["source"] = notification.Source,
                        ["sourceId"] = notification.SourceId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        ["serviceLabel"] = serviceLabel,
                        ["title"] = notification.Title,
                        ["link"] = notification.Link
                    },
                    android = new { priority = "HIGH", ttl = "86400s" }
                }
            });
            using var response = await clients.CreateClient("Fcm").SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode) return new(PushSendOutcome.Delivered);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var code = ErrorCode(body) ?? $"HTTP_{(int)response.StatusCode}";
            if (code is "UNREGISTERED" or "SENDER_ID_MISMATCH")
                return new(PushSendOutcome.InvalidToken, code);
            if ((int)response.StatusCode is 429 or >= 500)
                return new(PushSendOutcome.Retry, code);
            return new(PushSendOutcome.Failed, code);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new(PushSendOutcome.Retry, "TIMEOUT");
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "FCM push delivery failed");
            return new(PushSendOutcome.Retry, "FCM_CLIENT_ERROR");
        }
    }

    private ServiceAccount LoadAccount()
    {
        if (account is not null) return account;
        var path = configuration["Push:CredentialPath"];
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw new InvalidOperationException("FCM 서비스 계정 파일이 설정되지 않았습니다.");
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = document.RootElement;
        var configuredProject = configuration["Push:FirebaseProjectId"]?.Trim();
        var project = string.IsNullOrWhiteSpace(configuredProject)
            ? root.GetProperty("project_id").GetString()
            : configuredProject;
        account = new(
            project ?? throw new InvalidDataException("Firebase project_id가 없습니다."),
            root.GetProperty("client_email").GetString() ?? throw new InvalidDataException("Firebase client_email이 없습니다."),
            root.GetProperty("private_key").GetString() ?? throw new InvalidDataException("Firebase private_key가 없습니다."));
        return account;
    }

    private async Task<string> GetAccessTokenAsync(ServiceAccount credentials, CancellationToken cancellationToken)
    {
        if (accessToken is not null && accessTokenExpiresAt > DateTimeOffset.UtcNow.AddMinutes(5)) return accessToken;
        await tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (accessToken is not null && accessTokenExpiresAt > DateTimeOffset.UtcNow.AddMinutes(5)) return accessToken;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT" }));
            var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
            {
                iss = credentials.ClientEmail,
                scope = "https://www.googleapis.com/auth/firebase.messaging",
                aud = "https://oauth2.googleapis.com/token",
                iat = now,
                exp = now + 3600
            }));
            var unsigned = $"{header}.{payload}";
            using var rsa = RSA.Create();
            rsa.ImportFromPem(credentials.PrivateKey);
            var signature = Base64Url(rsa.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            using var content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                ["assertion"] = $"{unsigned}.{signature}"
            });
            using var response = await clients.CreateClient("Fcm").PostAsync("https://oauth2.googleapis.com/token", content, cancellationToken);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync(cancellationToken));
            accessToken = document.RootElement.GetProperty("access_token").GetString() ?? throw new InvalidDataException("FCM access token이 없습니다.");
            var expiresIn = document.RootElement.GetProperty("expires_in").GetInt32();
            accessTokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresIn);
            return accessToken;
        }
        finally { tokenLock.Release(); }
    }

    private static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string? ErrorCode(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var error = document.RootElement.GetProperty("error");
            if (error.TryGetProperty("details", out var details))
                foreach (var detail in details.EnumerateArray())
                    if (detail.TryGetProperty("errorCode", out var code)) return code.GetString();
            return error.TryGetProperty("status", out var status) ? status.GetString() : null;
        }
        catch { return null; }
    }

    private sealed record ServiceAccount(string ProjectId, string ClientEmail, string PrivateKey);
}
