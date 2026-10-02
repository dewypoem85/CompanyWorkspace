using LeaveManager.Data;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public class SecurityModel(
    AppDbContext db,
    IConfiguration configuration,
    SecurityPolicyService security,
    IWebHostEnvironment environment) : PageModel
{
    public bool ForceDeleteRequiresMaster { get; set; }
    public bool RequireReasons { get; set; }
    public bool BackupEnabled { get; set; }
    public string BackupPath { get; set; } = "";
    public int BackupRetentionDays { get; set; }
    public List<string> RecentBackups { get; set; } = [];
    public int AuditLogCount { get; set; }
    public int EmployeeCount { get; set; }

    public bool IsHttps { get; set; }
    public string Scheme { get; set; } = "";
    public string Host { get; set; } = "";
    public string RemoteIp { get; set; } = "";
    public string OriginalScheme { get; set; } = "";
    public string OriginalRemoteIp { get; set; } = "";
    public bool TrustForwardedHeadersFromAnyProxy { get; set; }
    public string AllowedHosts { get; set; } = "";
    public bool AllowedHostsRestricted { get; set; }
    public string PublicBaseUrl { get; set; } = "";
    public bool PublicBaseUrlUsesHttps { get; set; }
    public bool SecureCookiePolicyEnabled { get; set; }

    public string DataProtectionPath { get; set; } = "";
    public int DataProtectionKeyCount { get; set; }

    public async Task OnGet()
    {
        ForceDeleteRequiresMaster = security.ForceDeleteRequiresMaster;
        RequireReasons = security.RequireReasonsForSensitiveAdminActions;
        BackupEnabled = !bool.TryParse(configuration["Backup:Enabled"], out var enabled) || enabled;
        BackupPath = configuration["Backup:Path"] ?? "data/backups";
        BackupRetentionDays = int.TryParse(configuration["Backup:RetentionDays"], out var days) ? days : 14;
        AuditLogCount = await db.AuditLogs.CountAsync();
        EmployeeCount = await db.Employees.CountAsync(x => !x.IsSharedAccount);

        IsHttps = Request.IsHttps;
        Scheme = Request.Scheme;
        Host = Request.Host.ToString();
        var remoteAddress = HttpContext.Connection.RemoteIpAddress;
        if (remoteAddress?.IsIPv4MappedToIPv6 == true) remoteAddress = remoteAddress.MapToIPv4();
        RemoteIp = remoteAddress?.ToString() ?? "";
        OriginalScheme = Request.Headers["X-Original-Proto"].ToString();
        OriginalRemoteIp = Request.Headers["X-Original-For"].ToString();

        TrustForwardedHeadersFromAnyProxy = configuration.GetValue<bool>("Security:TrustForwardedHeadersFromAnyProxy");
        AllowedHosts = configuration["AllowedHosts"] ?? "";
        AllowedHostsRestricted = AllowedHosts
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .All(x => x != "*") && !string.IsNullOrWhiteSpace(AllowedHosts);
        PublicBaseUrl = configuration["App:PublicBaseUrl"] ?? "";
        PublicBaseUrlUsesHttps = Uri.TryCreate(PublicBaseUrl, UriKind.Absolute, out var publicUri)
            && publicUri.Scheme == Uri.UriSchemeHttps;
        SecureCookiePolicyEnabled = !environment.IsDevelopment();

        DataProtectionPath = configuration["DataProtection:KeyPath"] ?? "data-keys";
        if (Directory.Exists(DataProtectionPath))
            DataProtectionKeyCount = Directory.GetFiles(DataProtectionPath, "*.xml").Length;

        if (Directory.Exists(BackupPath))
        {
            RecentBackups = Directory.GetFiles(BackupPath, "leave-manager-*.db")
                .OrderByDescending(System.IO.File.GetLastWriteTimeUtc)
                .Take(10)
                .Select(x => $"{Path.GetFileName(x)} ({new FileInfo(x).Length / 1024m / 1024m:0.##} MB)")
                .ToList();
        }
    }

    public string BoolLabel(bool value) => value ? "켜짐" : "꺼짐";
    public string SafeLabel(bool value) => value ? "정상" : "확인 필요";
    public string ValueOrDash(string? value) => string.IsNullOrWhiteSpace(value) ? "-" : value;
}
