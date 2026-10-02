using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db, IConfiguration configuration)
    {
        var email = (configuration["SeedMaster:Email"] ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(email)) return;

        var existing = await db.Users.SingleOrDefaultAsync(x => x.Email == email);
        if (existing is not null)
        {
            if (!existing.IsMaster || !existing.IsAdmin || !existing.IsActive)
            {
                existing.IsAdmin = true;
                existing.IsMaster = true;
                existing.IsActive = true;
                existing.UpdatedAtUtc = DateTime.UtcNow;
                await SaveAndQueueLeaveProjectionAsync(db, existing);
            }
            return;
        }

        var hireDateText = configuration["SeedMaster:HireDate"];
        var hireDate = DateOnly.TryParse(hireDateText, out var parsed) ? parsed : DateOnly.FromDateTime(DateTime.Today);
        var user = new CompanyUser
        {
            Email = email,
            Name = (configuration["SeedMaster:Name"] ?? "회사 마스터").Trim(),
            HireDate = hireDate,
            IsActive = true,
            IsAdmin = true,
            IsMaster = true,
            Permissions = ""
        };
        db.Users.Add(user);
        await SaveAndQueueLeaveProjectionAsync(db, user);
    }

    private static async Task SaveAndQueueLeaveProjectionAsync(AppDbContext db, CompanyUser user)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.SaveChangesAsync();
        await LeaveProjectionOutboxStore.EnqueueAsync(db, user.Id);
        await transaction.CommitAsync();
    }
}
