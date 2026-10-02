using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<CompanyUser> Users => Set<CompanyUser>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<CompanyProject> Projects => Set<CompanyProject>();
    public DbSet<ProjectMembership> ProjectMemberships => Set<ProjectMembership>();
    public DbSet<DepartmentLead> DepartmentLeads => Set<DepartmentLead>();
    public DbSet<OrganizationImport> OrganizationImports => Set<OrganizationImport>();
    public DbSet<LeaveProjectionOutboxItem> LeaveProjectionOutbox => Set<LeaveProjectionOutboxItem>();
    public DbSet<WorkspacePushDevice> WorkspacePushDevices => Set<WorkspacePushDevice>();
    public DbSet<WorkspacePushSourceCursor> WorkspacePushSourceCursors => Set<WorkspacePushSourceCursor>();
    public DbSet<WorkspacePushDelivery> WorkspacePushDeliveries => Set<WorkspacePushDelivery>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Department>().HasIndex(x => x.Name).IsUnique();
        modelBuilder.Entity<Department>().Property(x => x.Version).IsConcurrencyToken();
        modelBuilder.Entity<CompanyProject>().Property(x => x.Version).IsConcurrencyToken();
        modelBuilder.Entity<ProjectMembership>().HasKey(x => new { x.EmployeeId, x.ProjectId });
        modelBuilder.Entity<DepartmentLead>().HasKey(x => new { x.DepartmentId, x.EmployeeId });
        modelBuilder.Entity<CompanyUser>(entity =>
        {
            entity.HasIndex(x => x.Email).IsUnique();
            entity.Property(x => x.Email).HasMaxLength(200);
            entity.Property(x => x.Name).HasMaxLength(100);
            entity.Property(x => x.Department).HasMaxLength(100);
            entity.Property(x => x.Permissions).HasMaxLength(1000);
        });

        modelBuilder.Entity<LeaveProjectionOutboxItem>(entity =>
        {
            entity.ToTable(LeaveProjectionOutboxStore.TableName);
            entity.HasKey(x => x.CompanyUserId);
            entity.Property(x => x.CompanyUserId).ValueGeneratedNever();
            entity.HasIndex(x => x.NextAttemptAtUtc);
            entity.Property(x => x.LastError).HasMaxLength(2000);
        });

        modelBuilder.Entity<WorkspacePushDevice>(entity =>
        {
            entity.HasIndex(x => x.InstallationId).IsUnique();
            entity.HasIndex(x => x.TokenHash).IsUnique();
            entity.HasIndex(x => new { x.UserId, x.Enabled });
        });
        modelBuilder.Entity<WorkspacePushSourceCursor>(entity =>
        {
            entity.HasKey(x => new { x.UserId, x.Source });
        });
        modelBuilder.Entity<WorkspacePushDelivery>(entity =>
        {
            entity.HasIndex(x => new { x.DeviceId, x.Source, x.SourceId }).IsUnique();
            entity.HasIndex(x => new { x.Status, x.NextAttemptAtUtc });
        });
    }
}
