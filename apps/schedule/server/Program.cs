using System.Security.Claims;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Schedule;

var verifyData = args.Contains("verify-data");
var seedLoadTest = args.Contains("seed-load-test");
var syncDirectory = args.Contains("sync-directory");
var builder = WebApplication.CreateBuilder(args.Where(x => x is not ("verify-data" or "seed-load-test" or "sync-directory")).ToArray());
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
var demo = builder.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("DemoMode");
var dataPath = Path.GetFullPath(builder.Configuration["DataPath"] ?? "data");
Directory.CreateDirectory(dataPath);
Directory.CreateDirectory(Path.Combine(dataPath, "images"));
builder.Configuration["DataPath"] = dataPath;
if (verifyData)
{
    // WAL recovery can require a temporary shared-memory file even for a read-only query.
    // Work on a copy so a read-only backup volume can be verified without changing it.
    var verifyPath = Path.Combine(Path.GetTempPath(), "schedule-verify-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(verifyPath);
    try
    {
    foreach (var suffix in new[] { "", "-wal", "-shm" })
    {
        var source = Path.Combine(dataPath, "schedule.db" + suffix);
        if (File.Exists(source)) File.Copy(source, Path.Combine(verifyPath, "schedule.db" + suffix));
    }
    using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(verifyPath, "schedule.db")};Mode=ReadOnly;Pooling=False");
    connection.Open();
    using var command = connection.CreateCommand(); command.CommandText = "PRAGMA integrity_check";
    var integrity = Convert.ToString(command.ExecuteScalar());
    var counts = new Dictionary<string, long>();
    foreach (var table in new[] { "Tasks", "Comments", "Attachments", "Employees" }) { command.CommandText = $"SELECT COUNT(*) FROM {table}"; counts[table] = Convert.ToInt64(command.ExecuteScalar()); }
    command.CommandText = "SELECT Id FROM Attachments WHERE TaskId IS NOT NULL";
    using var rows = command.ExecuteReader(); var missingImages = 0;
    while (rows.Read()) if (!File.Exists(Path.Combine(dataPath, "images", rows.GetString(0)))) missingImages++;
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { integrity, counts, missingImages }));
    Environment.ExitCode = integrity == "ok" && missingImages == 0 ? 0 : 1;
    }
    finally { Directory.Delete(verifyPath, recursive: true); }
    return;
}
if (seedLoadTest && !demo) throw new InvalidOperationException("부하 검증 데이터는 Development + DemoMode에서만 생성할 수 있습니다.");
if (!demo && (builder.Configuration["Sso:SharedSecret"] ?? "").Length < 32) throw new InvalidOperationException("Sso:SharedSecret 설정이 필요합니다.");
builder.Services.AddDbContext<ScheduleDb>(o => o.UseSqlite($"Data Source={Path.Combine(dataPath, "schedule.db")};Default Timeout=15"));
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataPath, "keys")));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<Access>();
builder.Services.AddSingleton<DirectoryService>();
builder.Services.AddHttpClient("internal", c => c.Timeout = TimeSpan.FromSeconds(8)).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
builder.Services.AddHostedService<Maintenance>();
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.ForwardLimit = 1;
    if (builder.Configuration.GetValue<bool>("TrustProxy")) { o.KnownIPNetworks.Clear(); o.KnownProxies.Clear(); }
});
builder.Services.AddAntiforgery(o => { o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.Name = "ScheduleCsrf"; o.Cookie.SameSite = SameSiteMode.Strict; o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always; });
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = builder.Environment.IsDevelopment() ? "ScheduleSession" : "__Host-ScheduleSession";
    o.Cookie.HttpOnly = true; o.Cookie.Path = "/"; o.Cookie.SameSite = SameSiteMode.Lax;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.ExpireTimeSpan = TimeSpan.FromHours(168); o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "same-origin";
    ctx.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' https://company.example.com; connect-src 'self' https://company.example.com; img-src 'self' blob: https://company.example.com; style-src 'self' 'unsafe-inline' https://company.example.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
    if (ctx.Request.Path.StartsWithSegments("/api") || ctx.Request.Path.StartsWithSegments("/auth")) ctx.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (Exception ex) when (!ctx.Response.HasStarted)
    {
        var (status, message) = ex switch
        {
            ApiError e => (e.Status, e.Message),
            DbUpdateConcurrencyException => (409, "다른 사람이 수정했습니다. 작성 내용은 유지됩니다. 최신 내용을 확인해 주세요."),
            AntiforgeryValidationException => (403, "화면 인증이 만료되었습니다. 새로고침 후 다시 시도해 주세요."),
            BadHttpRequestException => (400, "요청 형식이나 파일 크기를 확인해 주세요."),
            _ => (500, "저장하지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.")
        };
        if (status == 500) app.Logger.LogError(ex, "Schedule request failed");
        ctx.Response.StatusCode = status;
        await ctx.Response.WriteAsJsonAsync(new { error = message });
    }
});
app.UseAuthentication();
app.UseAuthorization();
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api")
        && !ctx.Request.Path.StartsWithSegments("/api/internal")
        && ctx.Request.Path != "/api/health")
    {
        if (ctx.User.Identity?.IsAuthenticated != true) { ctx.Response.StatusCode = 401; await ctx.Response.WriteAsJsonAsync(new { error = "회사 로그인이 필요합니다.", loginUrl = "/auth/login" }); return; }
        if (!demo)
        {
            var result = await WorkspaceSessionCheck.CheckAsync(ctx.User.FindFirst("CompanySessionId")?.Value, ctx.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                "schedule", app.Configuration["Sso:SharedSecret"]!, app.Configuration["Portal:InternalUrl"] ?? "http://company-portal:8080", ctx.RequestAborted, ctx.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("internal"));
            if(result!=204) { ctx.Response.StatusCode=result; await ctx.Response.WriteAsJsonAsync(new { error=result==503?"회사 인증 서버 연결을 확인해 주세요.":result==403?"서비스 접근 권한이 없습니다.":"회사 로그인이 필요합니다.", loginUrl="/auth/login" }); return; }
        }
        var write = ctx.Request.Method is not ("GET" or "HEAD");
        if (write) await ctx.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(ctx);
        await ctx.RequestServices.GetRequiredService<DirectoryService>().Refresh(true);
        await ctx.RequestServices.GetRequiredService<Access>().Me();
    }
    await next();
});
app.UseStaticFiles();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/auth/login", (string? returnUrl) => Results.Redirect((builder.Configuration["Portal:PublicUrl"] ?? "https://company.example.com").TrimEnd('/') + "/Auth/schedule?returnUrl=" + Uri.EscapeDataString(SafeReturn(returnUrl))));
app.MapPost("/auth/sso/callback", async (HttpContext ctx, ScheduleDb db, DirectoryService directory) =>
{
    if (ctx.Request.ContentLength > 65536) throw new ApiError(413, "인증 요청이 너무 큽니다.");
    var form = await ctx.Request.ReadFormAsync();
    var token = Tokens.Verify(form["token"].ToString(), builder.Configuration["Sso:SharedSecret"]!, builder.Configuration["Sso:Issuer"] ?? "company-portal", "schedule");
    if (!token.TryGetProperty("sub", out var subject) || subject.ValueKind != System.Text.Json.JsonValueKind.String || !long.TryParse(subject.GetString(), out var id)
        || !token.TryGetProperty("accountType", out var accountType) || accountType.GetString() != "employee"
        || !token.TryGetProperty("permissions", out var permissions) || permissions.ValueKind != System.Text.Json.JsonValueKind.Array
        || !permissions.EnumerateArray().Any(x => x.ValueKind == System.Text.Json.JsonValueKind.String && x.GetString() == "schedule.access")) throw new ApiError(403, "일정표 접근 권한이 없습니다.");
    var jti = token.GetProperty("jti").GetString()!;
    db.ConsumedTokens.Add(new() { Id = jti, ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(token.GetProperty("exp").GetInt64()).UtcDateTime });
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { throw new ApiError(401, "이미 사용된 로그인입니다. 회사 홈에서 다시 진입해 주세요."); }
    await directory.Refresh(true);
    var employee = await db.Employees.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.Active && x.Access && !x.Shared) ?? throw new ApiError(403, "활성 직원만 사용할 수 있습니다.");
    await Login(ctx, employee, token.TryGetProperty("sid", out var sessionId) ? sessionId.GetString() : null);
    return Results.Redirect(SafeReturn(token.TryGetProperty("returnUrl", out var r) ? r.GetString() : null));
});
app.MapPost("/api/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); return Results.Ok(new { url = builder.Configuration["Portal:PublicUrl"] ?? "https://company.example.com" }); });
if (demo)
{
    app.MapGet("/auth/demo", async (long? id, HttpContext ctx, ScheduleDb db) =>
    {
        if (ctx.Connection.RemoteIpAddress is not null && !System.Net.IPAddress.IsLoopback(ctx.Connection.RemoteIpAddress)) throw new ApiError(403, "로컬 시제품 전용입니다.");
        var employee = await db.Employees.FindAsync(id ?? 1) ?? throw new ApiError(404, "테스트 직원을 찾을 수 없습니다.");
        await Login(ctx, employee); return Results.Redirect("/");
    });
}
app.MapGet("/api/bootstrap", async (HttpContext ctx, ScheduleDb db, Access access, IAntiforgery anti) =>
{
    var me = await access.Me();
    var employees = await access.VisibleEmployees(me).AsNoTracking().OrderBy(x => x.Department).ThenBy(x => x.Name).ToListAsync();
    var visibleProjectIds = await access.VisibleProjects(me).Select(p => p.Id).ToArrayAsync();
    var memberships = await db.Memberships.AsNoTracking().Where(m => visibleProjectIds.Contains(m.ProjectId)).ToListAsync();
    foreach (var e in employees) e.ProjectIds = memberships.Where(m => m.EmployeeId == e.Id).Select(m => m.ProjectId).ToArray();
    me.ProjectIds = memberships.Where(m => m.EmployeeId == me.Id).Select(m => m.ProjectId).ToArray();
    return Results.Ok(new { me, demo, csrfToken = anti.GetAndStoreTokens(ctx).RequestToken,
        employees, departments = await db.Departments.AsNoTracking().ToListAsync(),
        leads = await db.TeamLeads.AsNoTracking().Where(l => db.Employees.Any(e => e.Id == l.EmployeeId && e.Role != "master" && (me.IsAdmin || !e.IsPrivate))).ToListAsync(),
        projects = await access.VisibleProjects(me).AsNoTracking().ToListAsync(),
        goals = await db.WorkGoals.AsNoTracking().Where(g => g.ProjectId == null || visibleProjectIds.Contains(g.ProjectId.Value)).OrderBy(g => g.ClosedAt != null).ThenBy(g => g.Title).ToListAsync() });
});
app.MapGet("/api/absences", async (DateOnly from, DateOnly to, DirectoryService directory, Access access) =>
{
    if (from > to || to.DayNumber - from.DayNumber > 62) throw new ApiError(400, "부재 조회 기간은 최대 62일입니다.");
    return Results.Ok(await directory.Absences(from, to, (await access.Me()).IsAdmin));
});
app.MapGet("/api/holidays", async (DateOnly from, DateOnly to, DirectoryService directory, Access access) =>
{
    if (from > to || to.DayNumber - from.DayNumber > 73050) throw new ApiError(400, "공휴일 조회 기간이 올바르지 않습니다.");
    await access.Me();
    return Results.Ok(await directory.Holidays(from, to));
});
app.MapCompanyNotificationReadApi();
app.MapLeaveMilestoneReadApi();
app.MapReleases(); app.MapTasks(); app.MapDiscussion(); app.MapManagement(); app.MapImages(); app.MapPersonalTodos(); app.MapWorkPlanning(); app.MapFeedback();
foreach (var route in WorkspaceRoutes.Patterns) app.MapFallbackToFile(route, "index.html");
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
    await db.Database.EnsureCreatedAsync();
    await OrganizationSchema.ApplyAsync(db);
    await MilestoneSchema.ApplyAsync(db);
    await PlanningSchema.ApplyAsync(db);
    await WorkPlanningSchema.ApplyAsync(db);
    await PersonalTodoSchema.ApplyAsync(db);
    await ReleaseImportSchema.ApplyAsync(db);
    await FeedbackSchema.ApplyAsync(db);
    await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
    if (demo) await Demo.Seed(db);
    if (seedLoadTest) { await Demo.SeedLoadTest(db); return; }
    if (syncDirectory)
    {
        await app.Services.GetRequiredService<DirectoryService>().Refresh(true);
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { employees = await db.Employees.CountAsync(), departments = await db.Departments.CountAsync(), projects = await db.Projects.CountAsync(), memberships = await db.Memberships.CountAsync(), leads = await db.TeamLeads.CountAsync() }));
        return;
    }
}
app.Run();

static string SafeReturn(string? raw)
{
    if (string.IsNullOrWhiteSpace(raw) || raw.Length > 2048 || !raw.StartsWith('/') || raw.StartsWith("//") || raw.Contains('\\') || raw.Contains('\r') || raw.Contains('\n') || raw.StartsWith("/auth", StringComparison.OrdinalIgnoreCase)) return "/";
    return raw;
}
static Task Login(HttpContext ctx, Employee employee, string? sid = null) => ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
    new ClaimsPrincipal(new ClaimsIdentity([new Claim("CompanySessionId", sid ?? ""), new Claim(ClaimTypes.NameIdentifier, employee.Id.ToString()), new Claim(ClaimTypes.Name, employee.Name)], CookieAuthenticationDefaults.AuthenticationScheme)),
    new AuthenticationProperties { IsPersistent = true });
public partial class Program { }
