using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public sealed record PushDeviceRegistration(string ExpectedUserId, string InstallationId, string Token, string AppVersion);
public sealed record PushDevicePreferences(string ExpectedUserId, bool Enabled, bool LeaveEnabled, bool ScheduleEnabled);

public sealed class PushDeviceService(
    AppDbContext db,
    IDataProtectionProvider dataProtection,
    PushNotificationSourceClient sources)
{
    private static readonly Regex TokenPattern = new("\\A[A-Za-z0-9_:\\-]{20,2048}\\z", RegexOptions.CultureInvariant);
    private readonly IDataProtector protector = dataProtection.CreateProtector("CompanyWorkspace.Push.FcmToken.v1");

    public async Task<object> ListAsync(long userId, CancellationToken cancellationToken)
    {
        var rows = await db.WorkspacePushDevices.AsNoTracking()
            .Where(device => device.UserId == userId)
            .OrderByDescending(device => device.UpdatedAtUtc)
            .Select(device => new
            {
                installationId = device.InstallationId,
                appVersion = device.AppVersion,
                enabled = device.Enabled,
                leaveEnabled = device.LeaveEnabled,
                scheduleEnabled = device.ScheduleEnabled,
                updatedAtUtc = device.UpdatedAtUtc,
                disabledAtUtc = device.DisabledAtUtc
            })
            .ToArrayAsync(cancellationToken);
        return new { devices = rows };
    }

    public async Task<object> RegisterAsync(CompanyUser user, string sessionId, PushDeviceRegistration input, CancellationToken cancellationToken)
    {
        RequireExpectedUser(user.Id, input.ExpectedUserId);
        if (!Guid.TryParseExact(input.InstallationId, "D", out _)) throw new PushInputException("앱 설치 식별자를 확인해 주세요.");
        var token = input.Token?.Trim() ?? "";
        var appVersion = input.AppVersion?.Trim() ?? "";
        if (!TokenPattern.IsMatch(token) || appVersion.Length is < 1 or > 40)
            throw new PushInputException("앱 알림 토큰과 버전을 확인해 주세요.");

        var allowedSources = AllowedSources(user);
        var tokenHash = Hash(token);
        var hadActiveDevice = await HasActiveDeviceAsync(user.Id, null, null, cancellationToken);
        var device = await db.WorkspacePushDevices.SingleOrDefaultAsync(row => row.InstallationId == input.InstallationId, cancellationToken);
        var tokenDevice = await db.WorkspacePushDevices.SingleOrDefaultAsync(row => row.TokenHash == tokenHash, cancellationToken);
        if (device is not null && tokenDevice is not null && tokenDevice.Id != device.Id)
        {
            tokenDevice.Enabled = false;
            tokenDevice.ProtectedToken = "";
            tokenDevice.TokenHash = Hash($"replaced:{tokenDevice.Id}:{Guid.NewGuid():N}");
            tokenDevice.DisabledAtUtc = DateTime.UtcNow;
            tokenDevice.UpdatedAtUtc = DateTime.UtcNow;
            // Release the unique token hash before assigning it to the installation row.
            await db.SaveChangesAsync(cancellationToken);
        }
        else device ??= tokenDevice;
        var now = DateTime.UtcNow;
        var sameUser = device is not null && device.UserId == user.Id;
        var retainedRegistration = sameUser && !string.IsNullOrEmpty(device!.ProtectedToken);
        if (device is null)
        {
            device = new WorkspacePushDevice
            {
                UserId = user.Id,
                SessionId = sessionId,
                InstallationId = input.InstallationId,
                CreatedAtUtc = now
            };
            db.WorkspacePushDevices.Add(device);
        }
        else
        {
            if (!sameUser)
            {
                db.WorkspacePushDeliveries.RemoveRange(db.WorkspacePushDeliveries.Where(delivery => delivery.DeviceId == device.Id));
                device.LeaveEnabled = true;
                device.ScheduleEnabled = true;
            }
            device.UserId = user.Id;
            device.SessionId = sessionId;
            device.InstallationId = input.InstallationId;
        }
        device.ProtectedToken = protector.Protect(token);
        device.TokenHash = tokenHash;
        device.AppVersion = appVersion;
        if (!retainedRegistration) device.Enabled = true;
        device.DisabledAtUtc = device.Enabled ? null : device.DisabledAtUtc ?? now;
        device.UpdatedAtUtc = now;

        var resetSources = device.Enabled && !hadActiveDevice
            ? allowedSources.Where(source => source == "leave" ? device.LeaveEnabled : device.ScheduleEnabled).ToArray()
            : [];
        var latestIds = await sources.LatestIdsAsync(user.Id, resetSources, cancellationToken);
        foreach (var source in resetSources)
        {
            var cursor = await db.WorkspacePushSourceCursors.FindAsync([user.Id, source], cancellationToken);
            if (cursor is null)
                db.WorkspacePushSourceCursors.Add(new WorkspacePushSourceCursor
                {
                    UserId = user.Id,
                    Source = source,
                    LastSourceId = latestIds[source],
                    UpdatedAtUtc = now
                });
            else
            {
                cursor.LastSourceId = latestIds[source];
                cursor.UpdatedAtUtc = now;
            }
        }
        await db.SaveChangesAsync(cancellationToken);
        return DeviceResult(device);
    }

    public async Task<object> UpdateAsync(CompanyUser user, string installationId, PushDevicePreferences input, CancellationToken cancellationToken)
    {
        RequireExpectedUser(user.Id, input.ExpectedUserId);
        if (!Guid.TryParseExact(installationId, "D", out _)) throw new PushInputException("앱 설치 식별자를 확인해 주세요.");
        var device = await db.WorkspacePushDevices.SingleOrDefaultAsync(
            row => row.InstallationId == installationId && row.UserId == user.Id,
            cancellationToken) ?? throw new KeyNotFoundException();
        var reenabled = new List<string>();
        if (input.Enabled && input.LeaveEnabled && (!device.Enabled || !device.LeaveEnabled)) reenabled.Add("leave");
        if (input.Enabled && input.ScheduleEnabled && (!device.Enabled || !device.ScheduleEnabled)) reenabled.Add("schedule");
        reenabled = reenabled.Where(source => AllowedSources(user).Contains(source)).ToList();
        if (reenabled.Count > 0)
        {
            var resetSources = new List<string>();
            foreach (var source in reenabled)
                if (!await HasActiveDeviceAsync(user.Id, device.Id, source, cancellationToken)) resetSources.Add(source);
            var latest = await sources.LatestIdsAsync(user.Id, resetSources, cancellationToken);
            foreach (var source in resetSources)
            {
                var cursor = await db.WorkspacePushSourceCursors.FindAsync([user.Id, source], cancellationToken);
                if (cursor is null) db.WorkspacePushSourceCursors.Add(new() { UserId = user.Id, Source = source, LastSourceId = latest[source], UpdatedAtUtc = DateTime.UtcNow });
                else { cursor.LastSourceId = Math.Max(cursor.LastSourceId, latest[source]); cursor.UpdatedAtUtc = DateTime.UtcNow; }
            }
        }
        device.Enabled = input.Enabled;
        device.LeaveEnabled = input.LeaveEnabled;
        device.ScheduleEnabled = input.ScheduleEnabled;
        device.DisabledAtUtc = input.Enabled ? null : DateTime.UtcNow;
        device.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return DeviceResult(device);
    }

    public async Task DisableAsync(CompanyUser user, string installationId, string expectedUserId, CancellationToken cancellationToken)
    {
        RequireExpectedUser(user.Id, expectedUserId);
        var device = await db.WorkspacePushDevices.SingleOrDefaultAsync(
            row => row.InstallationId == installationId && row.UserId == user.Id,
            cancellationToken) ?? throw new KeyNotFoundException();
        device.Enabled = false;
        device.ProtectedToken = "";
        device.TokenHash = Hash($"disabled:{device.Id}:{Guid.NewGuid():N}");
        device.DisabledAtUtc = DateTime.UtcNow;
        device.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    public string Unprotect(string protectedToken) => protector.Unprotect(protectedToken);

    private async Task<bool> HasActiveDeviceAsync(long userId, long? excludedDeviceId, string? source, CancellationToken cancellationToken)
    {
        var candidates = await db.WorkspacePushDevices.AsNoTracking()
            .Where(device => device.UserId == userId
                && device.Enabled
                && (!excludedDeviceId.HasValue || device.Id != excludedDeviceId.Value)
                && (source == null || source == "leave" && device.LeaveEnabled || source == "schedule" && device.ScheduleEnabled))
            .Select(device => new { device.SessionId })
            .ToArrayAsync(cancellationToken);
        foreach (var candidate in candidates)
            if (await WorkspaceApi.ActiveAsync(db, candidate.SessionId, userId)) return true;
        return false;
    }

    private static object DeviceResult(WorkspacePushDevice device) => new
    {
        installationId = device.InstallationId,
        appVersion = device.AppVersion,
        enabled = device.Enabled,
        leaveEnabled = device.LeaveEnabled,
        scheduleEnabled = device.ScheduleEnabled,
        updatedAtUtc = device.UpdatedAtUtc
    };

    private static HashSet<string> AllowedSources(CompanyUser user)
        => new(new[] { "leave", "schedule" }.Where(source => PermissionCatalog.Has(user, source + ".access")), StringComparer.Ordinal);
    private static void RequireExpectedUser(long userId, string expected)
    {
        if (expected != userId.ToString(CultureInfo.InvariantCulture)) throw new PushConflictException("푸시 알림을 설정하는 계정이 변경되었습니다.");
    }
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}

public sealed class PushInputException(string message) : Exception(message);
public sealed class PushConflictException(string message) : Exception(message);
