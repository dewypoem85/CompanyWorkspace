using System.ComponentModel.DataAnnotations;

namespace CompanyPortal.Models;

public sealed class WorkspacePushDevice
{
    public long Id { get; set; }
    public long UserId { get; set; }
    [MaxLength(64)] public string SessionId { get; set; } = "";
    [MaxLength(64)] public string InstallationId { get; set; } = "";
    [MaxLength(4096)] public string ProtectedToken { get; set; } = "";
    [MaxLength(64)] public string TokenHash { get; set; } = "";
    [MaxLength(40)] public string AppVersion { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public bool LeaveEnabled { get; set; } = true;
    public bool ScheduleEnabled { get; set; } = true;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? DisabledAtUtc { get; set; }
}

public sealed class WorkspacePushSourceCursor
{
    public long UserId { get; set; }
    [MaxLength(32)] public string Source { get; set; } = "";
    public long LastSourceId { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class WorkspacePushDelivery
{
    public long Id { get; set; }
    public long DeviceId { get; set; }
    [MaxLength(32)] public string Source { get; set; } = "";
    public long SourceId { get; set; }
    [MaxLength(200)] public string Title { get; set; } = "";
    [MaxLength(2048)] public string Link { get; set; } = "";
    [MaxLength(24)] public string Status { get; set; } = "pending";
    public int AttemptCount { get; set; }
    public DateTime NextAttemptAtUtc { get; set; } = DateTime.UtcNow;
    [MaxLength(200)] public string? LastErrorCode { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? DeliveredAtUtc { get; set; }
}
