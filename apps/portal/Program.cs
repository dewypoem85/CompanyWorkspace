using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Services;
using CompanyPortal.Workspace;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

if (args.Length is 3 or 4 && args[0] == "import-schedule-organization")
{
    if (args.Length == 4 && args[3] != "--apply") throw new ArgumentException("마지막 인수는 --apply만 허용됩니다.");
    var result = await ScheduleOrganizationImporter.RunAsync(args[1], args[2], args.Length == 4);
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { apply = args.Length == 4, result }));
    return;
}

if (args.Length == 3 && args[0] == "import-leave-employees")
{
    var result = await LegacyLeaveImporter.ImportAsync(args[1], args[2]);
    Console.WriteLine(
        $"Leave 직원 이관 완료: 신규 Portal 계정 {result.ImportedUsers}명, " +
        $"역할·접근권한 갱신 {result.UpdatedUsers}명, Leave 연결 {result.LinkedEmployees}명");
    Console.WriteLine($"Portal 백업: {result.PortalBackupPath}");
    Console.WriteLine($"Leave 백업: {result.LeaveBackupPath}");
    return;
}

var builder = WebApplication.CreateBuilder(args);
var secureCookies = !builder.Environment.IsDevelopment();
var trustAnyForwarder = builder.Configuration.GetValue<bool>("Security:TrustForwardedHeadersFromAnyProxy");
var sessionHours = Math.Clamp(
    builder.Configuration.GetValue<int?>("Authentication:SessionHours") ?? 168,
    1,
    168);

builder.Services.AddRazorPages(options =>
{
    WorkspacePages.Configure(options);
    options.Conventions.ConfigureFilter(new AutoValidateAntiforgeryTokenAttribute());
    options.Conventions.AuthorizeFolder("/Admin", "AdminOnly");
    options.Conventions.AuthorizeFolder("/Auth", "EmployeeOnly");
});
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=company-portal.db"));
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(builder.Configuration["DataProtection:KeyPath"] ?? "data-keys"));
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    if (trustAnyForwarder)
    {
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
    }
});

builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.LoginPath = "/Account/Login";
        options.AccessDeniedPath = "/Account/AccessDenied";
        options.ExpireTimeSpan = TimeSpan.FromHours(sessionHours);
        options.SlidingExpiration = true;
        options.Cookie.Name = secureCookies ? "__Host-CompanyPortal.Auth" : "CompanyPortal.Auth";
        options.Cookie.Path = "/";
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Events.OnSigningIn = async context =>
        {
            context.Properties.IsPersistent = true;
            context.Properties.AllowRefresh = true;
            context.Properties.ExpiresUtc = DateTimeOffset.UtcNow.AddHours(sessionHours);
            var identity = (ClaimsIdentity)context.Principal!.Identity!;
            if (!identity.HasClaim(c => c.Type == WorkspaceApi.SessionClaim))
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                var sid = await WorkspaceApi.CreateSessionAsync(db, long.Parse(identity.FindFirst("CompanyUserId")!.Value));
                identity.AddClaim(new Claim(WorkspaceApi.SessionClaim, sid));
            }
        };
        options.Events.OnValidatePrincipal = async context =>
        {
            var idText = context.Principal?.FindFirst("CompanyUserId")?.Value;
            if (!long.TryParse(idText, out var id))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return;
            }

            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.IsActive);
            var expectedSnapshot = user is null ? "" : string.Join(',', PermissionCatalog.Effective(user));
            var actualSnapshot = context.Principal?.FindFirst("PermissionSnapshot")?.Value ?? "";
            var hasAdminRole = context.Principal?.HasClaim(ClaimTypes.Role, "Admin") == true;
            var hasMasterRole = context.Principal?.HasClaim(ClaimTypes.Role, "Master") == true;
            var accountType = context.Principal?.FindFirst("CompanyAccountType")?.Value ?? "employee";
            if (user is null
                || PermissionCatalog.IsAdministrator(user) != hasAdminRole
                || user.IsMaster != hasMasterRole
                || PermissionCatalog.AccountType(user) != accountType
                || expectedSnapshot != actualSnapshot)
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return;
            }

            var identity = (ClaimsIdentity)context.Principal!.Identity!;
            var sid = identity.FindFirst(WorkspaceApi.SessionClaim)?.Value;
            if (sid is null)
            {
                sid = await WorkspaceApi.CreateSessionAsync(db, id);
                identity.AddClaim(new Claim(WorkspaceApi.SessionClaim, sid));
                context.ShouldRenew = true;
            }
            else if (!await WorkspaceApi.ActiveAsync(db, sid, id))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync();
                return;
            }
            await WorkspaceApi.RenewAsync(db, sid);
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
    })
    .AddGoogle(options =>
    {
        options.ClientId = builder.Configuration["Authentication:Google:ClientId"] ?? "";
        options.ClientSecret = builder.Configuration["Authentication:Google:ClientSecret"] ?? "";
        options.CallbackPath = "/signin-google";
        options.CorrelationCookie.SameSite = SameSiteMode.Lax;
        options.CorrelationCookie.SecurePolicy = secureCookies ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        options.CorrelationCookie.HttpOnly = true;
        options.CorrelationCookie.IsEssential = true;
        options.Events.OnRedirectToAuthorizationEndpoint = context =>
        {
            var redirectUri = context.RedirectUri;
            if (!redirectUri.Contains("prompt=", StringComparison.OrdinalIgnoreCase))
                redirectUri += (redirectUri.Contains('?') ? "&" : "?") + "prompt=select_account";
            context.Response.Redirect(redirectUri);
            return Task.CompletedTask;
        };
        options.Events.OnCreatingTicket = async context =>
        {
            var email = context.Identity?.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(email))
            {
                context.Fail("Google 계정 이메일을 확인할 수 없습니다.");
                return;
            }

            await using var scope = context.HttpContext.RequestServices.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleOrDefaultAsync(x => x.Email == email && x.IsActive);
            if (user is null)
            {
                context.Fail("등록되지 않았거나 비활성화된 회사 계정입니다.");
                return;
            }

            context.Principal = CompanyPrincipalFactory.Create(user);
        };
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect("/Account/AccessDenied");
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("EmployeeOnly", policy => policy.RequireClaim("CompanyUserId"));
    options.AddPolicy("AdminOnly", policy => policy.RequireClaim("CompanyUserId").RequireRole("Admin"));
    options.AddPolicy("MasterOnly", policy => policy.RequireClaim("CompanyUserId").RequireRole("Master"));
});
builder.Services.AddAntiforgery(o => o.HeaderName = "X-Workspace-CSRF");
builder.Services.AddCors(o => o.AddPolicy("Workspace", p => p.WithOrigins(
    CompanySystemCatalog.All.Select(s => builder.Configuration[s.BaseUrlConfigurationKey]?.TrimEnd('/'))
        .Where(s => !string.IsNullOrWhiteSpace(s)).Cast<string>().ToArray())
    .AllowCredentials().WithMethods("GET", "POST", "PATCH", "DELETE").WithHeaders("Content-Type", "X-Workspace-CSRF")));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<CurrentUserService>();
builder.Services.AddScoped<OrganizationService>();
builder.Services.AddSingleton<SsoTokenService>();
builder.Services.AddSingleton<InternalServiceToken>();
builder.Services.AddScoped<NotificationAggregationService>();
builder.Services.AddScoped<PushDeviceService>();
builder.Services.AddScoped<PushNotificationSourceClient>();
builder.Services.AddSingleton<FcmPushSender>();
builder.Services.AddHttpClient("NotificationSources", client => client.Timeout = TimeSpan.FromSeconds(5));
builder.Services.AddHttpClient("Fcm", client => client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddSingleton<LeaveProvisioningTokenService>();
var leaveProvisioningTimeoutSeconds = Math.Clamp(
    builder.Configuration.GetValue<int?>("Provisioning:Leave:RequestTimeoutSeconds") ?? 10,
    1,
    60);
builder.Services
    .AddHttpClient("LeaveProvisioning", client =>
        client.Timeout = TimeSpan.FromSeconds(leaveProvisioningTimeoutSeconds))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false
    });
if (builder.Configuration.GetValue<bool>("Provisioning:Leave:Enabled"))
    builder.Services.AddHostedService<LeaveProjectionProvisioningWorker>();
if (builder.Configuration.GetValue<bool>("Push:Enabled"))
    builder.Services.AddHostedService<PushNotificationDispatchWorker>();

var app = builder.Build();
app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}
app.UseWhen(ctx => !ctx.Request.Path.StartsWithSegments("/api/internal"), branch => branch.UseHttpsRedirection());
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var path = context.Context.Request.Path;
        if (path.StartsWithSegments("/css/company-workspace.css") ||
            path.StartsWithSegments("/js/company-workspace.js") ||
            path.StartsWithSegments("/service-worker.js"))
        {
            context.Context.Response.Headers.CacheControl = "no-store";
        }
    }
});
app.UseRouting();
app.UseCors("Workspace");
app.UseAuthentication();
app.UseAuthorization();
app.MapRazorPages();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/workspace/navigation", WorkspacePages.Navigation).RequireAuthorization();
app.MapGet("/workspace/{system}", (string system, string? returnUrl) =>
{
    var definition = CompanySystemCatalog.Find(system);
    if (definition is null) return Results.NotFound();
    var target = $"/Auth/{Uri.EscapeDataString(definition.Key)}";
    if (!string.IsNullOrWhiteSpace(returnUrl))
        target += $"?returnUrl={Uri.EscapeDataString(returnUrl)}";
    return Results.Redirect(target);
}).RequireAuthorization("EmployeeOnly");
app.MapScheduleReadApi();
app.MapWorkspaceApi();
app.MapMobileLogin();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.EnsureCreatedAsync();
    await SchemaMigrator.ApplyAsync(db);
    await OrganizationSchema.ApplyAsync(db);
    await WorkspaceApi.InitializeAsync(db);
    await DbSeeder.SeedAsync(db, app.Configuration);
}

app.Run();
