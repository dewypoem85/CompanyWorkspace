using LeaveManager.Data;

namespace LeaveManager.Services;

// Read-time baseline, not a credential, atomic compare-and-swap or idempotency key.
public static class LeaveSettlementSnapshot
{
    public static async Task<string> ComputeAsync(AppDbContext db, LeaveGrantBalance balance, DateOnly today)
    {
        return LeaveGrantSnapshot.Hash(new { today, balance.Available, grant = await LeaveGrantSnapshot.ComputeAsync(db, balance.Grant) });
    }
}

public class LeaveSettlementValidationException(string message) : InvalidOperationException(message);
public class LeaveSettlementConflictException(string message) : InvalidOperationException(message);
