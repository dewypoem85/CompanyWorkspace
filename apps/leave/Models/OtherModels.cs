using LeaveManager.Services;
using System.ComponentModel.DataAnnotations;

namespace LeaveManager.Models;

public class LeaveSettlement
{
    public long Id { get; set; }
    public long EmployeeId { get; set; }
    public long SourceGrantId { get; set; }
    public LeaveSettlementType Type { get; set; }
    public decimal Days { get; set; }
    public DateOnly ProcessedDate { get; set; }
    public long ProcessedByEmployeeId { get; set; }
    public string? Note { get; set; }
    public long? CreatedGrantId { get; set; }
    public long? AdvanceLeaveRequestId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
}

public class AuditLog
{
    public long Id { get; set; }
    public long? ActorEmployeeId { get; set; }
    public Employee? ActorEmployee { get; set; }
    [Required, MaxLength(100)] public string Action { get; set; } = "";
    [Required, MaxLength(100)] public string TargetType { get; set; } = "";
    public string? TargetId { get; set; }
    public string? DetailJson { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    [MaxLength(500)] public string? Reason { get; set; }
    [MaxLength(100)] public string? IpAddress { get; set; }
    [MaxLength(500)] public string? UserAgent { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
}

public class Holiday
{
    public long Id { get; set; }
    public DateOnly Date { get; set; }
    [Required, MaxLength(100)] public string Name { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
    public long? CreatedByEmployeeId { get; set; }
}


public class AppNotification
{
    public long Id { get; set; }
    public long RecipientEmployeeId { get; set; }
    public Employee? RecipientEmployee { get; set; }
    [Required, MaxLength(100)] public string Type { get; set; } = "";
    [Required, MaxLength(200)] public string Title { get; set; } = "";
    [Required, MaxLength(1000)] public string Message { get; set; } = "";
    [MaxLength(500)] public string? Link { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
    public DateTime? ReadAtUtc { get; set; }
}


public class DiscordWebhook
{
    public long Id { get; set; }
    [Required, MaxLength(1000)] public string Url { get; set; } = "";
    [MaxLength(200)] public string? Memo { get; set; }
    public long? CreatedByEmployeeId { get; set; }
    public Employee? CreatedByEmployee { get; set; }
    public DateTime CreatedAtUtc { get; set; } = AppTime.UtcNow;
}
