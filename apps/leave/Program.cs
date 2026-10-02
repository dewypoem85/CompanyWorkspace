using LeaveManager.Data;
using LeaveManager.Services;
using LeaveManager.Workspace;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var secureCookies = !builder.Environment.IsDevelopment();
var trustForwardedHeadersFromAnyProxy =
    builder.Configuration.GetValue<bool>("Security:TrustForwardedHeadersFromAnyProxy");
var sessionHours = Math.Clamp(
    builder.Configuration.GetValue<int?>("Authentication:SessionHours") ?? 168,
    1,
    168);

var companyPortalBaseUrl = (builder.Configuration["CompanyPortal:BaseUrl"] ?? "").Trim().TrimEnd('/');
if (!Uri.TryCreate(companyPortalBaseUrl, UriKind.Absolute, out var companyPortalUri)
    || (companyPortalUri.Scheme != Uri.UriSchemeHttps
        && companyPortalUri.Host is not "localhost" and not "127.0.0.1"))
    throw new InvalidOperationException("CompanyPortal:BaseUrl에 HTTPS 회사 포털 주소를 설정해야 합니다.");

if ((builder.Configuration["CompanyPortal:SsoSharedSecret"] ?? "").Trim().Length < 32)
    throw new InvalidOperationException("CompanyPortal:SsoSharedSecret에 32자 이상의 공유 키를 설정해야 합니다.");

builder.Services.AddRazorPages(options =>
{
    WorkspacePages.Configure(options);
    options.Conventions.ConfigureFilter(new AutoValidateAntiforgeryTokenAttribute());
    options.Conventions.AuthorizeFolder("/Leave", "EmployeeOnly");
    options.Conventions.AuthorizeFolder("/Notifications", "EmployeeOnly");
    options.Conventions.AuthorizeFolder("/Settings", "EmployeeOnly");
    options.Conventions.AuthorizeFolder("/Auth", "EmployeeOnly");
    options.Conventions.AuthorizeFolder("/Admin", "AdminOnly");
    options.Conventions.AuthorizeFolder("/Master", "MasterOnly");
});
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=leave-manager.db"));
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(builder.Configuration["DataProtection:KeyPath"] ?? "data-keys"));
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;

    if (trustForwardedHeadersFromAnyProxy)
    {
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
    }
});
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("WorkspaceSession", client => client.Timeout = TimeSpan.FromSeconds(5))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
builder.Services.AddHttpClient("ScheduleInternal", client => client.Timeout = TimeSpan.FromSeconds(4))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
builder.Services.AddScoped<IScheduleMilestoneReader, ScheduleMilestoneClient>();
builder.Services.AddScoped<IWorkspaceNavigationBadges, LeaveNavigationBadges>();
builder.Services
    .AddAuthentication(o =>
    {
        o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(o =>
    {
        o.LoginPath = "/Account/Login";
        o.AccessDeniedPath = "/Account/AccessDenied";
        o.ExpireTimeSpan = TimeSpan.FromHours(sessionHours);
        o.SlidingExpiration = true;
        o.Cookie.Name = secureCookies ? "__Host-LeaveManager.Auth" : "LeaveManager.Auth";
        o.Cookie.Path = "/";
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        o.Cookie.HttpOnly = true;
        o.Cookie.IsEssential = true;
        o.Events.OnValidatePrincipal = async context =>
        {
            var idText = context.Principal?.FindFirst("EmployeeId")?.Value;
            if (!long.TryParse(idText, out var employeeId))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return;
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var employee = await db.Employees
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == employeeId && x.IsActive, context.HttpContext.RequestAborted);

            var shouldBeAdmin = employee?.Role is LeaveManager.Models.EmployeeRole.Admin or LeaveManager.Models.EmployeeRole.Master;
            var shouldBeMaster = employee?.Role == LeaveManager.Models.EmployeeRole.Master;
            var hasAdminClaim = context.Principal?.IsInRole("Admin") == true;
            var hasMasterClaim = context.Principal?.IsInRole("Master") == true;

            if (employee is null || shouldBeAdmin != hasAdminClaim || shouldBeMaster != hasMasterClaim)
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return;
            }

            var desiredLifetime = TimeSpan.FromHours(sessionHours);
            var currentLifetime = context.Properties.ExpiresUtc - context.Properties.IssuedUtc;
            if (!context.Properties.IsPersistent
                || context.Properties.AllowRefresh != true
                || currentLifetime is null
                || currentLifetime.Value < desiredLifetime - TimeSpan.FromMinutes(1))
            {
                context.Properties.IsPersistent = true;
                context.Properties.AllowRefresh = true;
                context.Properties.IssuedUtc = DateTimeOffset.UtcNow;
                context.Properties.ExpiresUtc = DateTimeOffset.UtcNow.Add(desiredLifetime);
                context.ShouldRenew = true;
            }
        };
        o.Events.OnRedirectToLogin = context =>
        {
            var isBackgroundRequest = string.Equals(
                    context.Request.Headers["X-Requested-With"],
                    "XMLHttpRequest",
                    StringComparison.OrdinalIgnoreCase)
                || context.Request.Headers.Accept.Any(x => x?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true);
            if (isBackgroundRequest || context.Request.Path.StartsWithSegments("/api/workspace/navigation"))
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            else
                context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
        o.Events.OnRedirectToAccessDenied = context =>
        {
            var isBackgroundRequest = string.Equals(
                    context.Request.Headers["X-Requested-With"],
                    "XMLHttpRequest",
                    StringComparison.OrdinalIgnoreCase)
                || context.Request.Headers.Accept.Any(x => x?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true);
            if (isBackgroundRequest || context.Request.Path.StartsWithSegments("/api/workspace/navigation"))
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
            else
                context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("EmployeeOnly", p => p.RequireClaim("EmployeeId"));
    o.AddPolicy("AdminOnly", p => p.RequireClaim("EmployeeId").RequireRole("Admin"));
    o.AddPolicy("MasterOnly", p => p.RequireClaim("EmployeeId").RequireRole("Master"));
});
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<CurrentEmployeeService>();
builder.Services.AddScoped<CompanyEmployeeProjectionService>();
builder.Services.AddScoped<LeaveCalculationService>();
builder.Services.AddScoped<LeaveDateService>();
builder.Services.AddScoped<LeaveRequestService>();
builder.Services.AddScoped<LeaveSettlementService>();
builder.Services.AddScoped<LeaveUsageReportService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<DiscordNotificationService>();
builder.Services.AddScoped<DiscordDirectMessageService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddSingleton<NotificationTextFormatter>();
builder.Services.AddSingleton<SecurityPolicyService>();
builder.Services.AddSingleton<CompanySsoService>();
builder.Services.AddHostedService<LeaveAccrualWorker>();
builder.Services.AddHostedService<DatabaseBackupService>();

var app = builder.Build();
app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        headers.TryAdd("X-Content-Type-Options", "nosniff");
        headers.TryAdd("X-Frame-Options", "DENY");
        headers.TryAdd("Referrer-Policy", "same-origin");
        headers.TryAdd("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        headers.TryAdd("Content-Security-Policy", "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
        return Task.CompletedTask;
    });
    await next();
});

app.UseWhen(ctx => !ctx.Request.Path.StartsWithSegments("/api/internal/schedule"), branch => branch.UseHttpsRedirection());
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.Use(async (ctx, next) =>
{
    if(ctx.User.Identity?.IsAuthenticated == true && !ctx.Request.Path.StartsWithSegments("/api/internal") &&
       !ctx.Request.Path.StartsWithSegments("/Sso") && !ctx.Request.Path.StartsWithSegments("/auth") && !ctx.Request.Path.StartsWithSegments("/Account"))
    {
        using var sessionClient = ctx.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("WorkspaceSession");
        var result = await WorkspaceSessionCheck.CheckAsync(sessionClient, ctx.User.FindFirst("CompanySessionId")?.Value,
            ctx.User.FindFirst("CompanyUserId")?.Value, "leave", app.Configuration["CompanyPortal:SsoSharedSecret"]!,
            app.Configuration["CompanyPortal:InternalUrl"] ?? "http://company-portal:8080", ctx.RequestAborted);
        if(result != 204)
        {
            ctx.Response.StatusCode=result;
            if(result==401) await ctx.SignOutAsync();
            if(ctx.Request.Headers.Accept.ToString().Contains("text/html") && result==401)
                ctx.Response.Redirect("/Account/Login?returnUrl="+Uri.EscapeDataString(ctx.Request.Path+ctx.Request.QueryString));
            else await ctx.Response.WriteAsJsonAsync(new { error=result==503?"회사 인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.":result==403?"서비스 접근 권한이 없습니다.":"회사 로그인이 필요합니다." });
            return;
        }
    }
    await next();
});

app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            context.Response.Headers["Cache-Control"] = "no-store, no-cache";
            context.Response.Headers["Pragma"] = "no-cache";
            context.Response.Headers["Expires"] = "0";
        }
        return Task.CompletedTask;
    });
    await next();
});

app.UseAuthorization();
app.MapRazorPages();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/workspace/navigation", WorkspacePages.Navigation).RequireAuthorization();
app.MapScheduleReadApi();
app.MapCompanyNotificationReadApi();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
    await SchemaMigrator.ApplyAsync(db);
}

app.Run();
