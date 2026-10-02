using System.ComponentModel.DataAnnotations;

namespace CompanyPortal.Models;

public sealed class LeaveProjectionOutboxItem
{
    public long CompanyUserId { get; set; }
    public long Version { get; set; } = 1;
    public DateTime QueuedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime NextAttemptAtUtc { get; set; } = DateTime.UtcNow;
    public int AttemptCount { get; set; }
    [MaxLength(2000)] public string? LastError { get; set; }
}
