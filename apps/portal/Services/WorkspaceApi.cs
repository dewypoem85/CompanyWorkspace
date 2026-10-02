using System.Collections.Concurrent;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public static class WorkspaceApi
{
    public const string SessionClaim = "CompanySessionId";
    private static readonly ConcurrentDictionary<string, long> Used = new();

    public static async Task InitializeAsync(AppDbContext db)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS WorkspaceSessions (
                Id TEXT PRIMARY KEY, UserId INTEGER NOT NULL, ExpiresAt INTEGER NOT NULL, Revoked INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS IX_WorkspaceSessions_UserId ON WorkspaceSessions(UserId);
            CREATE TABLE IF NOT EXISTS WorkspaceProfiles (UserId INTEGER PRIMARY KEY, Image BLOB NOT NULL, Version TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS WorkspaceProjectIcons (ProjectId INTEGER PRIMARY KEY, Image BLOB NOT NULL, Version TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS WorkspacePushDevices (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId INTEGER NOT NULL,
                SessionId TEXT NOT NULL,
                InstallationId TEXT NOT NULL,
                ProtectedToken TEXT NOT NULL,
                TokenHash TEXT NOT NULL,
                AppVersion TEXT NOT NULL,
                Enabled INTEGER NOT NULL DEFAULT 1,
                LeaveEnabled INTEGER NOT NULL DEFAULT 1,
                ScheduleEnabled INTEGER NOT NULL DEFAULT 1,
                CreatedAtUtc TEXT NOT NULL,
                UpdatedAtUtc TEXT NOT NULL,
                DisabledAtUtc TEXT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_WorkspacePushDevices_InstallationId ON WorkspacePushDevices(InstallationId);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_WorkspacePushDevices_TokenHash ON WorkspacePushDevices(TokenHash);
            CREATE INDEX IF NOT EXISTS IX_WorkspacePushDevices_UserId_Enabled ON WorkspacePushDevices(UserId, Enabled);
            CREATE TABLE IF NOT EXISTS WorkspacePushSourceCursors (
                UserId INTEGER NOT NULL,
                Source TEXT NOT NULL,
                LastSourceId INTEGER NOT NULL,
                UpdatedAtUtc TEXT NOT NULL,
                PRIMARY KEY(UserId, Source));
            CREATE TABLE IF NOT EXISTS WorkspacePushDeliveries (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                DeviceId INTEGER NOT NULL,
                Source TEXT NOT NULL,
                SourceId INTEGER NOT NULL,
                Title TEXT NOT NULL,
                Link TEXT NOT NULL,
                Status TEXT NOT NULL,
                AttemptCount INTEGER NOT NULL DEFAULT 0,
                NextAttemptAtUtc TEXT NOT NULL,
                LastErrorCode TEXT NULL,
                CreatedAtUtc TEXT NOT NULL,
                DeliveredAtUtc TEXT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS IX_WorkspacePushDeliveries_Device_Source_SourceId ON WorkspacePushDeliveries(DeviceId, Source, SourceId);
            CREATE INDEX IF NOT EXISTS IX_WorkspacePushDeliveries_Status_NextAttemptAtUtc ON WorkspacePushDeliveries(Status, NextAttemptAtUtc);
            CREATE TABLE IF NOT EXISTS WorkspaceMobileLoginCodes (
                CodeHash TEXT PRIMARY KEY,
                UserId INTEGER NOT NULL,
                SourceSessionId TEXT NOT NULL,
                Challenge TEXT NOT NULL,
                State TEXT NOT NULL,
                ExpiresAtUtc INTEGER NOT NULL,
                ConsumedAtUtc INTEGER NULL);
            CREATE INDEX IF NOT EXISTS IX_WorkspaceMobileLoginCodes_UserId ON WorkspaceMobileLoginCodes(UserId);
            """);
    }

    public static async Task<string> CreateSessionAsync(AppDbContext db, long userId)
    {
        var id = Guid.NewGuid().ToString("N");
        var expiry = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO WorkspaceSessions (Id, UserId, ExpiresAt) VALUES ({id}, {userId}, {expiry})");
        return id;
    }

    public static async Task<bool> ActiveAsync(AppDbContext db, string? sid, long userId)
    {
        if (string.IsNullOrEmpty(sid)) return false;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS Value FROM WorkspaceSessions WHERE Id={sid} AND UserId={userId} AND Revoked=0 AND ExpiresAt>{now}").SingleAsync() == 1;
    }

    public static async Task RenewAsync(AppDbContext db, string sid)
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();
        var threshold = expiry - 3600;
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceSessions SET ExpiresAt={expiry} WHERE Id={sid} AND Revoked=0 AND ExpiresAt<{threshold}");
    }

    public static void MapWorkspaceApi(this WebApplication app)
    {
        var group = app.MapGroup("/api/workspace");
        group.AddEndpointFilter(async (context, next) =>
        {
            var ctx = context.HttpContext;
            ctx.Response.Headers.CacheControl = "no-store";
            if (ctx.Request.Method is not ("GET" or "HEAD"))
            {
                if (ctx.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
                try { await ctx.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(ctx); }
                catch (AntiforgeryValidationException) { return Results.Json(new { error = "화면 인증을 갱신한 뒤 다시 시도해 주세요." }, statusCode: 403); }
            }
            return await next(context);
        });
        group.MapProjectIcons();
        group.MapPushDevices();
        group.MapGet("/context", async (HttpContext ctx, CurrentUserService current, AppDbContext db, IAntiforgery anti) =>
        {
            if (ctx.User.Identity?.IsAuthenticated != true) return Results.Ok(new { authenticated = false });
            var user = await current.GetRequiredAsync();
            var photos = await db.Database.SqlQueryRaw<ProfileStamp>("SELECT p.UserId, p.Version FROM WorkspaceProfiles p INNER JOIN Users u ON u.Id=p.UserId WHERE u.IsActive=1").ToArrayAsync();
            var allowed = (await db.Users.Where(u => !u.IsPrivate || u.Id == user.Id || user.IsAdmin || user.IsMaster).Select(u => u.Id).ToArrayAsync()).ToHashSet();
            photos = photos.Where(p => allowed.Contains(p.UserId)).ToArray();
            var projects = await db.Projects.Where(p => !p.IsPrivate || user.IsAdmin || user.IsMaster).Select(p => new { p.Id, p.Name, p.IsPrivate }).ToArrayAsync();
            var icons = await db.Database.SqlQueryRaw<ProjectIconStamp>("SELECT ProjectId, Version FROM WorkspaceProjectIcons").ToArrayAsync();
            var projectIcons = icons.Where(i => projects.Any(p => p.Id == i.ProjectId)).ToDictionary(i => i.ProjectId.ToString(), i => $"/api/workspace/project-icon/{i.ProjectId}?v={i.Version}");
            var profiles = photos.ToDictionary(p => p.UserId.ToString(), p => $"/api/workspace/avatar/{p.UserId}?v={p.Version}");
            return Results.Ok(new {
                authenticated = true,
                user = new { id = user.Id, name = user.Name, email = user.Email, department = user.Department,
                    role = PermissionCatalog.CompanyRole(user), accountType = PermissionCatalog.AccountType(user),
                    avatarUrl = profiles.GetValueOrDefault(user.Id.ToString()) },
                profiles, projectIcons, projects,
                services = CompanySystemCatalog.All.Where(s => PermissionCatalog.Has(user, s.AccessPermission))
                    .Select(s => new { key = s.Key, name = s.Name, href = s.LaunchPath }),
                isAdmin = PermissionCatalog.IsAdministrator(user),
                csrfToken = anti.GetAndStoreTokens(ctx).RequestToken
            });
        });
        group.MapPost("/logout", async (HttpContext ctx, AppDbContext db) =>
        {
            var sid = ctx.User.FindFirst(SessionClaim)?.Value ?? "";
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspaceSessions SET Revoked=1 WHERE Id={sid}");
            var now = DateTime.UtcNow;
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE WorkspacePushDevices SET Enabled=0, ProtectedToken='', DisabledAtUtc={now}, UpdatedAtUtc={now} WHERE SessionId={sid}");
            await ctx.SignOutAsync();
            return Results.Ok(new { loggedOut = true });
        });
        group.MapGet("/avatar/{id:long}", async (long id, HttpContext ctx, AppDbContext db, CurrentUserService current) =>
        {
            if (ctx.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var viewer = await current.GetRequiredAsync();
            if (!await db.Users.AnyAsync(u => u.Id == id && (!u.IsPrivate || u.Id == viewer.Id || viewer.IsAdmin || viewer.IsMaster))) return Results.NotFound();
            var bytes = await db.Database.SqlQuery<byte[]>($"SELECT Image AS Value FROM WorkspaceProfiles WHERE UserId={id}").SingleOrDefaultAsync();
            ctx.Response.Headers.XContentTypeOptions = "nosniff";
            return bytes is null ? Results.NotFound() : Results.File(bytes, "image/png");
        });
        group.MapPost("/avatar", async (HttpContext ctx, AppDbContext db, CurrentUserService current) =>
        {
            if (ctx.Request.ContentLength is > 524288) return Results.StatusCode(413);
            byte[] image;
            try { image = await AvatarStore.ReadPngAsync(ctx.Request.Body, ctx.RequestAborted); }
            catch (AvatarStore.SizeException) { return Results.StatusCode(413); }
            catch { return Results.BadRequest(new { error = "올바른 256×256 PNG 사진을 선택해 주세요." }); }
            var user = await current.GetRequiredAsync();
            var version = await AvatarStore.ApplyAsync(db, user.Id, image, null);
            return Results.Ok(new { avatarUrl = $"/api/workspace/avatar/{user.Id}?v={version}" });
        });
        group.MapDelete("/avatar", async (AppDbContext db, CurrentUserService current) =>
        {
            var user = await current.GetRequiredAsync();
            await AvatarStore.ApplyAsync(db, user.Id, null, null);
            return Results.NoContent();
        });
        static bool NotificationAccountMatches(HttpContext ctx, long userId)
        {
            var expected = ctx.Request.Query["expectedUserId"];
            return expected.Count == 0 || expected.Count == 1 && expected[0] == userId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        group.MapGet("/notifications", async (HttpContext ctx, CurrentUserService current, NotificationAggregationService feed, int? take) =>
        {
            if (ctx.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var user = await current.GetRequiredAsync();
            if (!NotificationAccountMatches(ctx, user.Id)) return Results.Conflict(new { error = "알림을 요청한 계정이 변경되었습니다." });
            return Results.Ok(await feed.GetAsync(user.Id, take ?? 10, ctx.RequestAborted));
        });
        group.MapGet("/notifications/{source}/{id:long}", async (string source, long id, HttpContext ctx, CurrentUserService current, NotificationAggregationService feed) =>
        {
            if (ctx.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var user = await current.GetRequiredAsync();
            if (!NotificationAccountMatches(ctx, user.Id)) return Results.Conflict(new { error = "알림을 요청한 계정이 변경되었습니다." });
            var lookup = await feed.GetOneAsync(user.Id, source, id, ctx.RequestAborted);
            if (!lookup.Available) return Results.Json(new { error = "알림 서비스 연결을 확인해 주세요." }, statusCode: 503);
            if (lookup.Item is null) return Results.NotFound(new { error = "현재 계정에서 확인할 수 없는 알림입니다." });
            return Results.Ok(new WorkspaceNotificationFeed([lookup.Item], [new(source, true, null)], lookup.Item.IsRead ? 0 : 1));
        });
        group.MapPost("/notifications/{source}/{id:long}/read", async (string source, long id, CurrentUserService current, NotificationAggregationService feed, HttpContext ctx) =>
        {
            var user = await current.GetRequiredAsync();
            if (!NotificationAccountMatches(ctx, user.Id)) return Results.Conflict(new { error = "알림을 요청한 계정이 변경되었습니다." });
            return await feed.MarkReadAsync(user.Id, source, id, ctx.RequestAborted)
                ? Results.NoContent() : Results.Json(new { error = "읽음 처리를 완료하지 못했습니다. 다시 시도해 주세요." }, statusCode: 503);
        });
        group.MapPost("/notifications/read-all", async (CurrentUserService current, NotificationAggregationService feed, HttpContext ctx) =>
        {
            if (!NotificationAccountMatches(ctx, (await current.GetRequiredAsync()).Id)) return Results.Conflict(new { error = "알림을 요청한 계정이 변경되었습니다." });
            return await feed.MarkAllReadAsync(ctx.RequestAborted) ? Results.NoContent() : Results.Json(new { error = "일부 서비스의 읽음 처리에 실패했습니다." }, statusCode: 503);
        });
        app.MapGet("/api/internal/workspace/session", async (HttpContext ctx, AppDbContext db, IConfiguration config) =>
        {
            ctx.Response.Headers.CacheControl = "no-store";
            var payload = Verify(ctx.Request.Headers.Authorization.ToString(), config["Sso:SharedSecret"] ?? "");
            if (payload is null) return Results.Unauthorized();
            using var doc = payload;
            var root = doc.RootElement;
            var source = root.GetProperty("iss").GetString();
            var definition = CompanySystemCatalog.Find(source);
            if (definition is null || !long.TryParse(root.GetProperty("sub").GetString(), out var uid)) return Results.Unauthorized();
            if (!await ActiveAsync(db, root.GetProperty("sid").GetString(), uid)) return Results.Unauthorized();
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == uid && x.IsActive);
            if (user is null || !PermissionCatalog.Has(user, definition.AccessPermission)) return Results.StatusCode(403);
            // 하위 서비스가 쓰기 직전에 요청하는 추가 권한을 현재 직원 정보로 검증한다.
            if (root.TryGetProperty("permission", out var requested))
            {
                var permission = requested.GetString();
                if (permission != definition.AccessPermission && !(source == "iap" && permission == PermissionCatalog.IapPublish))
                    return Results.StatusCode(403);
                if (permission is null || !PermissionCatalog.Has(user, permission)) return Results.StatusCode(403);
            }
            await RenewAsync(db, root.GetProperty("sid").GetString()!);
            if (source == "iap" && ctx.Request.Query["include"] == "projects")
            {
                var projects = await db.Projects.AsNoTracking()
                    .Where(p => !p.IsPrivate || user.IsAdmin || user.IsMaster)
                    .OrderBy(p => p.Name)
                    .Select(p => new { id = p.Id.ToString(), name = p.Name, archived = p.Archived })
                    .ToArrayAsync();
                return Results.Ok(new { projects });
            }
            return Results.NoContent();
        });
    }

    private sealed record ProjectIconStamp(long ProjectId, string Version);
    private sealed record ProfileStamp(long UserId, string Version);

    private static JsonDocument? Verify(string header, string secret)
    {
        JsonDocument? doc = null;
        try
        {
            if (secret.Length < 32 || header.Length > 16384 || !header.StartsWith("Bearer ")) return null;
            var parts = header[7..].Split('.');
            if (parts.Length != 2) return null;
            static byte[] Decode(string v) => Convert.FromBase64String(v.Replace('-', '+').Replace('_', '/') + new string('=', (4-v.Length%4)%4));
            var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(parts[0]));
            if (!CryptographicOperations.FixedTimeEquals(signature, Decode(parts[1]))) return null;
            doc = JsonDocument.Parse(Decode(parts[0]));
            var p = doc.RootElement; var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var exp = p.GetProperty("exp").GetInt64(); var iat = p.GetProperty("iat").GetInt64();
            var jti = p.GetProperty("jti").GetString()!;
            if (p.GetProperty("aud").GetString() != "workspace-session" || exp <= now || iat > now+30 || exp-iat is <=0 or >90 || string.IsNullOrEmpty(jti)) throw new InvalidOperationException();
            foreach (var item in Used) if (item.Value <= now) Used.TryRemove(item.Key, out _);
            if (string.IsNullOrEmpty(p.GetProperty("sid").GetString()) || string.IsNullOrEmpty(p.GetProperty("sub").GetString()) || string.IsNullOrEmpty(p.GetProperty("iss").GetString())) throw new InvalidOperationException();
            if (!Used.TryAdd(jti, exp)) throw new InvalidOperationException();
            return doc;
        }
        catch { doc?.Dispose(); return null; }
    }
}

internal static class AvatarPng
{
    public static byte[] Normalize(byte[] data)
    {
        ReadOnlySpan<byte> signature = [137,80,78,71,13,10,26,10];
        if (data.Length < 57 || !data.AsSpan(0,8).SequenceEqual(signature)) throw new InvalidDataException();
        using var result = new MemoryStream(); result.Write(signature);
        using var compressed = new MemoryStream();
        var pos = 8; var channels = 0; var ended = false; var hasData = false;
        while (pos + 12 <= data.Length)
        {
            var len = System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos,4));
            if (len < 0 || len > data.Length-pos-12) throw new InvalidDataException();
            var type = Encoding.ASCII.GetString(data, pos+4,4);
            uint crc = 0xffffffff;
            foreach (var b in data.AsSpan(pos+4,len+4)) { crc ^= b; for(var i=0;i<8;i++) crc=(crc>>1)^((crc&1)!=0?0xedb88320u:0); }
            if (~crc != System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(pos+8+len,4))) throw new InvalidDataException();
            if (type == "IHDR")
            {
                if(pos!=8 || len!=13 || System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos+8,4))!=256 ||
                   System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos+12,4))!=256 ||
                   data[pos+16]!=8 || data[pos+17] is not (2 or 6) || data[pos+18]!=0 || data[pos+19]!=0 || data[pos+20]!=0) throw new InvalidDataException();
                channels = data[pos+17]==6?4:3;
            }
            else if (channels==0) throw new InvalidDataException();
            else if (type=="IDAT") { compressed.Write(data,pos+8,len); hasData=true; }
            else if (type=="IEND") { if(len!=0 || !hasData) throw new InvalidDataException(); ended=true; }
            else if (char.IsUpper(type[0]) && type!="PLTE") throw new InvalidDataException();
            if(type is "IHDR" or "IDAT" or "IEND") result.Write(data,pos,len+12);
            pos+=len+12;
            if(ended) break;
        }
        if(!ended || pos!=data.Length) throw new InvalidDataException();
        compressed.Position=0;
        using var zip = new ZLibStream(compressed,CompressionMode.Decompress);
        var raw=new byte[256*(256*channels+1)];
        zip.ReadExactly(raw);
        if(zip.ReadByte()!=-1) throw new InvalidDataException();
        for(var row=0;row<256;row++) if(raw[row*(256*channels+1)]>4) throw new InvalidDataException();
        return result.ToArray();
    }
}
