using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<LeaveRequestDate> LeaveRequestDates => Set<LeaveRequestDate>();
    public DbSet<LeaveGrant> LeaveGrants => Set<LeaveGrant>();
    public DbSet<LeaveAllocation> LeaveAllocations => Set<LeaveAllocation>();
    public DbSet<LeaveSettlement> LeaveSettlements => Set<LeaveSettlement>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AppNotification> AppNotifications => Set<AppNotification>();
    public DbSet<DiscordWebhook> DiscordWebhooks => Set<DiscordWebhook>();
    public DbSet<ExternalSchedule> ExternalSchedules => Set<ExternalSchedule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Employee>(entity =>
        {
            entity.HasIndex(x => x.Email).IsUnique();
            entity.HasIndex(x => x.CompanyUserId).IsUnique();
            entity.Property(x => x.Email).HasMaxLength(200);
            entity.Property(x => x.Name).HasMaxLength(100);
            entity.Property(x => x.Department).HasMaxLength(100);
        });

        modelBuilder.Entity<LeaveRequest>(entity =>
        {
            entity.Property(x => x.CalculatedDays).HasPrecision(8, 2);
            entity.Property(x => x.AdvanceDays).HasPrecision(8, 2);
            entity.Property(x => x.AdvanceRepaymentDays).HasPrecision(8, 2);
            entity.Property(x => x.MonthlyAdvanceDays).HasPrecision(8, 2);
            entity.Property(x => x.AnnualAdvanceDays).HasPrecision(8, 2);
            entity.Property(x => x.MonthlyAdvanceRepaymentDays).HasPrecision(8, 2);
            entity.Property(x => x.AnnualAdvanceRepaymentDays).HasPrecision(8, 2);
            entity.HasIndex(x => new { x.EmployeeId, x.Status });
            entity.HasIndex(x => x.RequestedAtUtc);
            entity.HasIndex(x => new { x.EmployeeId, x.BirthdayBenefitDate })
                .IsUnique()
                .HasDatabaseName("IX_LeaveRequests_EmployeeId_BirthdayBenefitDate_Active")
                .HasFilter("\"BirthdayBenefitDate\" IS NOT NULL AND \"IsBirthdayPolicyOverride\" = 0 AND \"Status\" IN (0, 1, 3)");
            entity.HasOne(x => x.Employee)
                .WithMany()
                .HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<LeaveRequestDate>(entity =>
        {
            entity.HasIndex(x => x.Date);
            entity.HasIndex(x => new { x.LeaveRequestId, x.Date });
            entity.HasOne(x => x.LeaveRequest)
                .WithMany(x => x.Dates)
                .HasForeignKey(x => x.LeaveRequestId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<LeaveGrant>(entity =>
        {
            entity.Property(x => x.GrantedDays).HasPrecision(8, 2);
            entity.HasIndex(x => new { x.EmployeeId, x.GrantedDate, x.GrantType });
            entity.HasIndex(x => new { x.EmployeeId, x.GrantType, x.BenefitYear }).IsUnique();
            entity.HasIndex(x => x.ExpiresDate);
            entity.HasOne(x => x.Employee)
                .WithMany()
                .HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<LeaveAllocation>(entity =>
        {
            entity.Property(x => x.Days).HasPrecision(8, 2);
            entity.HasIndex(x => x.LeaveGrantId);
            entity.HasOne(x => x.LeaveRequest)
                .WithMany(x => x.Allocations)
                .HasForeignKey(x => x.LeaveRequestId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.LeaveGrant)
                .WithMany()
                .HasForeignKey(x => x.LeaveGrantId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<LeaveSettlement>(entity =>
        {
            entity.Property(x => x.Days).HasPrecision(8, 2);
            entity.HasIndex(x => x.EmployeeId);
            entity.HasIndex(x => x.SourceGrantId);
            entity.HasIndex(x => x.AdvanceLeaveRequestId);
            entity.HasOne<Employee>()
                .WithMany()
                .HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Holiday>(entity =>
        {
            entity.HasIndex(x => x.Date).IsUnique();
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasIndex(x => x.CreatedAtUtc);
            entity.HasIndex(x => new { x.Action, x.TargetType });
            entity.HasOne(x => x.ActorEmployee)
                .WithMany()
                .HasForeignKey(x => x.ActorEmployeeId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AppNotification>(entity =>
        {
            entity.HasIndex(x => new { x.RecipientEmployeeId, x.IsRead, x.CreatedAtUtc });
            entity.HasOne(x => x.RecipientEmployee)
                .WithMany()
                .HasForeignKey(x => x.RecipientEmployeeId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DiscordWebhook>(entity =>
        {
            entity.HasIndex(x => x.Url).IsUnique();
            entity.HasOne(x => x.CreatedByEmployee)
                .WithMany()
                .HasForeignKey(x => x.CreatedByEmployeeId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ExternalSchedule>(entity =>
        {
            entity.Property(x => x.Category).HasMaxLength(50);
            entity.Property(x => x.Memo).HasMaxLength(500);
            entity.HasIndex(x => new { x.StartDate, x.EndDate });
            entity.HasIndex(x => new { x.EmployeeId, x.StartDate });
            entity.HasOne(x => x.Employee)
                .WithMany()
                .HasForeignKey(x => x.EmployeeId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
