using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Schedule;

public class Employee
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Department { get; set; } = "";
    public long? DepartmentId { get; set; }
    public long[] ProjectIds { get; set; } = [];
    public string Role { get; set; } = "employee";
    public bool Active { get; set; }
    public bool Shared { get; set; }
    public bool IsPrivate { get; set; }
    public bool Access { get; set; }
    public bool IsAdmin => Role is "admin" or "master";
}
public class WorkItem
{
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public long AssigneeId { get; set; }
    public long CreatedBy { get; set; }
    public long? ProjectId { get; set; }
    public long? GoalId { get; set; }
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Status { get; set; } = "planned";
    public bool Archived { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class WorkGoal
{
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public long? ProjectId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime? ClosedAt { get; set; }
    public long? ClosedBy { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class TaskScheduleItem
{
    public long Id { get; set; }
    public long TaskId { get; set; }
    public string Title { get; set; } = "";
    public DateOnly Date { get; set; }
    public DateOnly EndDate { get; set; }
    public long CreatedBy { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class SharedTaskTodo
{
    public long Id { get; set; }
    public long TaskId { get; set; }
    public string Title { get; set; } = "";
    public long CreatedBy { get; set; }
    public long? CompletedBy { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class Comment
{
    public long Id { get; set; }
    public long TaskId { get; set; }
    public long AuthorId { get; set; }
    public long? ParentId { get; set; }
    public string Body { get; set; } = "";
    public bool Deleted { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EditedAt { get; set; }
}
public class Attachment
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public long OwnerId { get; set; }
    public long? TaskId { get; set; }
    public long? CommentId { get; set; }
    public long? FeedbackId { get; set; }
    public long? FeedbackCommentId { get; set; }
    public string ContentType { get; set; } = "";
    public string Name { get; set; } = "";
    public long Size { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class Project
{
    public bool IsPrivate { get; set; }
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#3b65de";
    public bool Archived { get; set; }
    public int Version { get; set; } = 1;
}
public class Milestone
{
    public string Type { get; set; } = "general";
    public long Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string DeadlineMemo { get; set; } = "";
    public DateOnly Date { get; set; }
    public DateOnly? EndDate { get; set; }
    [JsonIgnore]
    public string AdditionalSchedulesJson { get; set; } = "[]";
    [NotMapped]
    public List<MilestoneSchedule> AdditionalSchedules
    {
        get => JsonSerializer.Deserialize<List<MilestoneSchedule>>(AdditionalSchedulesJson) ?? [];
        set => AdditionalSchedulesJson = JsonSerializer.Serialize(value);
    }
    public long? ProjectId { get; set; }
    public int Version { get; set; } = 1;
    public long? CreatedBy { get; set; }
    public long? UpdatedBy { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
public record MilestoneSchedule(string Type, DateOnly Date, DateOnly? EndDate = null, string Memo = "");
public class MilestoneRevision
{
    public long Id { get; set; }
    public long MilestoneId { get; set; }
    public long ActorId { get; set; }
    public string Action { get; set; } = "";
    public string BeforeSnapshot { get; set; } = "";
    public string AfterSnapshot { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class LegacyReleaseRecord
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public DateOnly? ReleasedOn { get; set; }
    public string Notes { get; set; } = "";
    public string Issue { get; set; } = "";
    public string SourceReference { get; set; } = "";
}
public class ReleaseRecord
{
    public bool ReleasedOnUnknown { get; set; }
    public string SourceReference { get; set; } = "";
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public int BaseVersion { get; set; }
    public int Minor { get; set; }
    public DateOnly ReleasedOn { get; set; }
    public string Notes { get; set; } = "";
    public string Status { get; set; } = "stable";
    public string Issue { get; set; } = "";
    public long? RollbackTargetId { get; set; }
    public long? ResolvedInId { get; set; }
    public long CreatedBy { get; set; }
    public int Version { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class ReleaseRevision
{
    public long Id { get; set; }
    public long ReleaseId { get; set; }
    public long ActorId { get; set; }
    public string Snapshot { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public record ReleaseInput(long ProjectId, int BaseVersion, int Minor, DateOnly ReleasedOn, string Notes, string Status, string Issue, long? RollbackTargetId, int Version, long? ResolvedInId = null, bool? ReleasedOnUnknown = null);
public class TeamLead
{
    public long Id { get; set; }
    public string Department { get; set; } = "";
    public long? DepartmentId { get; set; }
    public long EmployeeId { get; set; }
}
public class Department
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public bool HandlesScheduleFeedback { get; set; }
    public bool Archived { get; set; }
    public int Version { get; set; } = 1;
}
public class Membership { public long EmployeeId { get; set; } public long ProjectId { get; set; } }
public record DirectoryLead(long DepartmentId, long EmployeeId);
public record DirectorySnapshot(int SchemaVersion, Employee[] Employees, Department[] Departments, Project[] Projects, Membership[] Memberships, DirectoryLead[] Leads);
public class Notice
{
    public long Id { get; set; }
    public long RecipientId { get; set; }
    public long TaskId { get; set; }
    public long? CommentId { get; set; }
    public string Message { get; set; } = "";
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class ChangeLog
{
    public long Id { get; set; }
    public long? TaskId { get; set; }
    public long ActorId { get; set; }
    public string Action { get; set; } = "";
    public string Details { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class FeedbackItem
{
    public long Id { get; set; }
    public long ProjectId { get; set; }
    public long ReporterId { get; set; }
    public long? AssigneeId { get; set; }
    public long? LinkedTaskId { get; set; }
    public string Type { get; set; } = "bug";
    public string Priority { get; set; } = "normal";
    public string Status { get; set; } = "new";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Resolution { get; set; } = "";
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class FeedbackComment
{
    public long Id { get; set; }
    public long FeedbackId { get; set; }
    public long AuthorId { get; set; }
    public long? ParentId { get; set; }
    public string Body { get; set; } = "";
    public bool Deleted { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EditedAt { get; set; }
}
public class FeedbackRevision
{
    public long Id { get; set; }
    public long FeedbackId { get; set; }
    public long ActorId { get; set; }
    public string Action { get; set; } = "";
    public string BeforeSnapshot { get; set; } = "";
    public string AfterSnapshot { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public class ConsumedToken
{
    public string Id { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
}
public class PersonalTodo
{
    public long Id { get; set; }
    public long OwnerId { get; set; }
    public string Title { get; set; } = "";
    public long SortOrder { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int Version { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public class ScheduleDb(DbContextOptions<ScheduleDb> options) : DbContext(options)
{
    public DbSet<WorkGoal> WorkGoals => Set<WorkGoal>();
    public DbSet<TaskScheduleItem> TaskScheduleItems => Set<TaskScheduleItem>();
    public DbSet<SharedTaskTodo> SharedTaskTodos => Set<SharedTaskTodo>();
    public DbSet<PersonalTodo> PersonalTodos => Set<PersonalTodo>();
    public DbSet<LegacyReleaseRecord> LegacyReleases => Set<LegacyReleaseRecord>();
    public DbSet<ReleaseRecord> Releases => Set<ReleaseRecord>();
    public DbSet<ReleaseRevision> ReleaseRevisions => Set<ReleaseRevision>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<WorkItem> Tasks => Set<WorkItem>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Milestone> Milestones => Set<Milestone>();
    public DbSet<MilestoneRevision> MilestoneRevisions => Set<MilestoneRevision>();
    public DbSet<TeamLead> TeamLeads => Set<TeamLead>();
    public DbSet<Notice> Notices => Set<Notice>();
    public DbSet<ChangeLog> Changes => Set<ChangeLog>();
    public DbSet<FeedbackItem> FeedbackItems => Set<FeedbackItem>();
    public DbSet<FeedbackComment> FeedbackComments => Set<FeedbackComment>();
    public DbSet<FeedbackRevision> FeedbackRevisions => Set<FeedbackRevision>();
    public DbSet<ConsumedToken> ConsumedTokens => Set<ConsumedToken>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ReleaseRecord>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<ReleaseRecord>().HasIndex(x => new { x.ProjectId, x.BaseVersion, x.Minor }).IsUnique();
        b.Entity<ReleaseRecord>().HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<ReleaseRevision>().HasIndex(x => new { x.ReleaseId, x.Id });
        b.Entity<ReleaseRevision>().HasOne<ReleaseRecord>().WithMany().HasForeignKey(x => x.ReleaseId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Employee>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Employee>().Ignore(x => x.IsAdmin);
        b.Entity<Employee>().Ignore(x => x.ProjectIds);
        b.Entity<Department>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Project>().Property(x => x.Id).ValueGeneratedNever();
        b.Entity<Membership>().HasKey(x => new { x.EmployeeId, x.ProjectId });
        b.Entity<WorkItem>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<WorkGoal>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<TaskScheduleItem>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<SharedTaskTodo>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<Comment>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<Project>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<Milestone>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<MilestoneRevision>().HasIndex(x => new { x.MilestoneId, x.Id });
        b.Entity<PersonalTodo>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<PersonalTodo>().HasIndex(x => new { x.OwnerId, x.CompletedAt, x.SortOrder });
        b.Entity<PersonalTodo>().HasOne<Employee>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedbackItem>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<FeedbackComment>().Property(x => x.Version).IsConcurrencyToken();
        b.Entity<FeedbackItem>().HasIndex(x => new { x.Status, x.UpdatedAt });
        b.Entity<FeedbackItem>().HasIndex(x => new { x.ProjectId, x.Status, x.Id });
        b.Entity<FeedbackItem>().HasIndex(x => x.LinkedTaskId).IsUnique();
        b.Entity<FeedbackItem>().HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedbackItem>().HasOne<Employee>().WithMany().HasForeignKey(x => x.ReporterId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedbackItem>().HasOne<Employee>().WithMany().HasForeignKey(x => x.AssigneeId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<FeedbackItem>().HasOne<WorkItem>().WithMany().HasForeignKey(x => x.LinkedTaskId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<FeedbackComment>().HasIndex(x => new { x.FeedbackId, x.CreatedAt });
        b.Entity<FeedbackComment>().HasOne<FeedbackItem>().WithMany().HasForeignKey(x => x.FeedbackId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<FeedbackRevision>().HasIndex(x => new { x.FeedbackId, x.Id });
        b.Entity<FeedbackRevision>().HasOne<FeedbackItem>().WithMany().HasForeignKey(x => x.FeedbackId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<WorkItem>().HasIndex(x => new { x.Archived, x.Status, x.UpdatedAt });
        b.Entity<WorkItem>().HasIndex(x => new { x.AssigneeId, x.StartDate, x.EndDate });
        b.Entity<WorkItem>().HasOne<Employee>().WithMany().HasForeignKey(x => x.AssigneeId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<WorkItem>().HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<WorkItem>().HasOne<WorkGoal>().WithMany().HasForeignKey(x => x.GoalId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<WorkGoal>().HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<WorkGoal>().HasIndex(x => new { x.ClosedAt, x.ProjectId, x.Title });
        b.Entity<TaskScheduleItem>().HasOne<WorkItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TaskScheduleItem>().HasIndex(x => new { x.TaskId, x.Date, x.Id });
        b.Entity<SharedTaskTodo>().HasOne<WorkItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<SharedTaskTodo>().HasIndex(x => new { x.TaskId, x.CompletedAt, x.Id });
        b.Entity<Comment>().HasIndex(x => new { x.TaskId, x.CreatedAt });
        b.Entity<Comment>().HasOne<WorkItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Attachment>().HasIndex(x => x.TaskId);
        b.Entity<Notice>().HasIndex(x => new { x.RecipientId, x.IsRead, x.Id });
        b.Entity<TeamLead>().HasIndex(x => new { x.Department, x.EmployeeId }).IsUnique();
    }
}
public record TaskInput(string Title, string Body, long AssigneeId, long? ProjectId, DateOnly? StartDate, DateOnly? EndDate, string Status, int Version, string[]? AttachmentIds, GoalSelection? Goal = null);
public record GoalSelection(long? Id);
public record WorkGoalInput(string Title, string? Description, long? ProjectId, int Version = 0);
public record WorkGoalCloseInput(bool Closed, int Version);
public record TaskScheduleItemInput(string Title, DateOnly Date, DateOnly? EndDate = null, int Version = 0);
public record SharedTaskTodoInput(string Title, int Version = 0);
public record SharedTaskTodoCompletionInput(bool Completed, int Version);
public record CommentInput(string Body, long? ParentId, int Version, string[]? AttachmentIds);
public record VersionInput(int Version);
public record StatusInput(string Status, int Version);
public record ProjectInput(string Name, string Color, bool Archived, int Version);
public record MilestoneInput(string Title, DateOnly Date, long? ProjectId, int Version, string? Description = null, string? Type = null, DateOnly? EndDate = null, List<MilestoneSchedule>? AdditionalSchedules = null, string? DeadlineMemo = null);
public record LeadInput(string Department, long EmployeeId);
public record Absence(long EmployeeId, DateOnly Date, string Portion);
public record CalendarHoliday(DateOnly Date, string Name);
public record PersonalTodoInput(string Title, int Version = 0);
public record PersonalTodoCompletionInput(bool Completed, int Version);
public record PersonalTodoOrderInput(long[] Ids, bool Archived);
public record FeedbackInput(long ProjectId, string Type, string Priority, string Title, string Body, int Version, string[]? AttachmentIds);
public record FeedbackAssignmentInput(long? AssigneeId, int Version);
public record FeedbackStatusInput(string Status, int Version, string? Resolution = null);
public record FeedbackCommentInput(string Body, long? ParentId, int Version, string[]? AttachmentIds);
public record FeedbackTaskInput(long AssigneeId, string Title, string Body, DateOnly? StartDate, DateOnly? EndDate, int Version);
public class ApiError(int status, string message) : Exception(message) { public int Status => status; }
