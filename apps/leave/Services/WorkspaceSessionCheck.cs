using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public static class WorkspaceSessionCheck
{
    public static async Task<int> CheckAsync(HttpClient client, string? sid, string? sub, string service, string secret, string url, CancellationToken ct)
    {
        if(string.IsNullOrEmpty(sid) || string.IsNullOrEmpty(sub)) return 401;
        var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        static string Encode(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+','-').Replace('/','_');
        var part=Encode(JsonSerializer.SerializeToUtf8Bytes(new { iss=service, aud="workspace-session", sid, sub, iat=now, exp=now+60, jti=Guid.NewGuid().ToString("N") }));
        var token=part+"."+Encode(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes(part)));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url.TrimEnd('/')+"/api/internal/workspace/session");
            request.Headers.Host="company.example.com";
            request.Headers.Authorization=new("Bearer",token);
            using var response=await client.SendAsync(request,ct);
            return response.IsSuccessStatusCode ? 204 : (int)response.StatusCode is 401 or 403 ? (int)response.StatusCode : 503;
        }
        catch(HttpRequestException) { return 503; }
        catch(TaskCanceledException) { return 503; }
    }
}
