using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CompanyPortal.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

// Chrome authenticates with Google; the embedded WebView receives its own cookie only
// after redeeming a short-lived, single-use code bound to an app-held PKCE verifier.
public static class MobileLoginApi
{
    private static readonly Regex Encoded32 = new("^[A-Za-z0-9_-]{43}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex StatePattern = new("^[a-f0-9]{32}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static void MapMobileLogin(this WebApplication app)
    {
        app.MapGet("/mobile/authorize", Authorize).RequireAuthorization("EmployeeOnly");
        app.MapPost("/mobile/exchange", Exchange);
    }

    private static async Task<IResult> Authorize(HttpContext ctx, AppDbContext db, string? challenge, string? state)
    {
        NoStore(ctx);
        if (!Encoded32.IsMatch(challenge ?? "") || !StatePattern.IsMatch(state ?? "")) return Results.BadRequest();
        if (!long.TryParse(ctx.User.FindFirstValue("CompanyUserId"), out var userId)) return Results.Unauthorized();
        var sessionId = ctx.User.FindFirstValue(WorkspaceApi.SessionClaim);
        if (!await WorkspaceApi.ActiveAsync(db, sessionId, userId)) return Results.Unauthorized();

        var code = Encode(RandomNumberGenerator.GetBytes(32));
        var codeHash = Hash(code);
        var expiry = DateTimeOffset.UtcNow.AddMinutes(2).ToUnixTimeSeconds();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM WorkspaceMobileLoginCodes WHERE ExpiresAtUtc<{now} OR UserId={userId}");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO WorkspaceMobileLoginCodes (CodeHash,UserId,SourceSessionId,Challenge,State,ExpiresAtUtc) VALUES ({codeHash},{userId},{sessionId!},{challenge!},{state!},{expiry})");

        var link = "companyworkspace://auth?code=" + Uri.EscapeDataString(code) + "&state=" + Uri.EscapeDataString(state!);
        ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
        return Results.Content($$"""
            <!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>96% 앱 로그인</title><style>body{font:16px system-ui;margin:12vh auto;padding:24px;max-width:440px;line-height:1.6}a{display:inline-block;padding:14px 20px;background:#5265d7;color:white;border-radius:10px;text-decoration:none}</style>
            <h1>로그인 완료</h1><p>앱으로 돌아가기를 누르면 96% 앱에 로그인됩니다. 이 연결은 2분 동안 한 번만 사용할 수 있습니다.</p>
            <a href="{{WebUtility.HtmlEncode(link)}}">96% 앱으로 돌아가기</a>
            </html>
            """, "text/html; charset=utf-8");
    }

    private static async Task<IResult> Exchange(HttpContext ctx, AppDbContext db)
    {
        NoStore(ctx);
        if (!ctx.Request.HasFormContentType || ctx.Request.ContentLength is null or > 1024) return Results.BadRequest();
        IFormCollection form;
        try { form = await ctx.Request.ReadFormAsync(); }
        catch { return Results.BadRequest(); }
        var code = form["code"].ToString();
        var verifier = form["verifier"].ToString();
        var state = form["state"].ToString();
        if (!Encoded32.IsMatch(code) || !Encoded32.IsMatch(verifier) || !StatePattern.IsMatch(state)) return Results.BadRequest();
        var codeHash = Hash(code);
        var challenge = Encode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        await using var transaction = await db.Database.BeginTransactionAsync();
        var row = await db.Database.SqlQueryRaw<MobileLoginRow>(
            "SELECT UserId,SourceSessionId,Challenge,State FROM WorkspaceMobileLoginCodes WHERE CodeHash={0} AND ConsumedAtUtc IS NULL AND ExpiresAtUtc>{1}", codeHash, now)
            .SingleOrDefaultAsync();
        if (row is null || row.Challenge != challenge || row.State != state
            || !await WorkspaceApi.ActiveAsync(db, row.SourceSessionId, row.UserId)) return Results.Unauthorized();
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == row.UserId && u.IsActive);
        if (user is null) return Results.Unauthorized();
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceMobileLoginCodes SET ConsumedAtUtc={now} WHERE CodeHash={codeHash} AND ConsumedAtUtc IS NULL AND ExpiresAtUtc>{now}");
        if (changed != 1) return Results.Unauthorized();

        await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, CompanyPrincipalFactory.Create(user));
        await transaction.CommitAsync();
        return Results.Redirect("/");
    }

    private static void NoStore(HttpContext ctx)
    {
        ctx.Response.Headers.CacheControl = "no-store";
        ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
        ctx.Response.Headers.XContentTypeOptions = "nosniff";
    }

    private static string Encode(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(value)));

    public sealed class MobileLoginRow
    {
        public long UserId { get; set; }
        public string SourceSessionId { get; set; } = "";
        public string Challenge { get; set; } = "";
        public string State { get; set; } = "";
    }
}
