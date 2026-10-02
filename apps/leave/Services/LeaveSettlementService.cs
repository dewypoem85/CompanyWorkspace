using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public class LeaveSettlementService(AppDbContext db, LeaveCalculationService calc, AuditService audit, SecurityPolicyService security)
{
    public async Task<LeaveSettlement> SettleAsync(long sourceGrantId, long adminId, LeaveSettlementType type, decimal days, string? note, string? expectedSnapshot = null)
    {
        security.EnsureAdmin(await db.Employees.SingleAsync(x => x.Id == adminId));
        string reason;
        try { reason = security.RequireReason(note, "정산 사유"); }
        catch (InvalidOperationException ex) { throw new LeaveSettlementValidationException(ex.Message); }
        if (type is not (LeaveSettlementType.Expiration or LeaveSettlementType.CarryOver or LeaveSettlementType.Compensation))
            throw new LeaveSettlementValidationException("소멸·이월·보상 중 하나를 선택해 주세요. 가불 차감은 자동 처리됩니다.");
        if (days <= 0 || days % 0.5m != 0) throw new LeaveSettlementValidationException("0.5일 단위로 입력해야 합니다.");
        var today = AppTime.Today;
        var source = await db.LeaveGrants.Include(x => x.Employee).SingleOrDefaultAsync(x => x.Id == sourceGrantId);
        if (source is null || !source.Employee.IsActive || source.Employee.IsSharedAccount || source.Employee.IsCompanyMaster)
            throw new LeaveSettlementConflictException("정산할 직원·발생분을 확인할 수 없습니다. 최신 내역을 확인해 주세요.");
        var balance = (await calc.GetGrantBalancesAsync(source.EmployeeId, today)).SingleOrDefault(x => x.Grant.Id == sourceGrantId);
        if (balance is null) throw new LeaveSettlementConflictException("발생분의 유효 기간이 변경되었거나 만료되었습니다. 최신 내역을 확인해 주세요.");
        if (expectedSnapshot is not null && expectedSnapshot != await LeaveSettlementSnapshot.ComputeAsync(db, balance, today))
            throw new LeaveSettlementConflictException("발생분·사용량·정산 내역이 변경되었습니다. 최신 내역을 확인해 주세요.");
        if (balance.Available < days) throw new LeaveSettlementValidationException("처리 가능한 잔여량을 초과했습니다.");

        await using var tx = await db.Database.BeginTransactionAsync();
        var settlement = new LeaveSettlement
        {
            EmployeeId = source.EmployeeId, SourceGrantId = source.Id, Type = type,
            Days = days, ProcessedDate = today, ProcessedByEmployeeId = adminId, Note = reason
        };
        db.LeaveSettlements.Add(settlement);
        await db.SaveChangesAsync();

        if (type == LeaveSettlementType.CarryOver)
        {
            var grant = new LeaveGrant
            {
                EmployeeId = source.EmployeeId, GrantType = LeaveGrantType.CarriedOver,
                GrantedDate = settlement.ProcessedDate, ExpiresDate = settlement.ProcessedDate.AddYears(1).AddDays(-1),
                GrantedDays = days, SourceGrantId = source.Id, Note = reason
            };
            db.LeaveGrants.Add(grant);
            await db.SaveChangesAsync();
            settlement.CreatedGrantId = grant.Id;
            await db.SaveChangesAsync();
        }
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, source.Employee, today);
        await tx.CommitAsync();
        await audit.WriteAsync(adminId, $"LeaveSettlement{type}", "LeaveGrant", sourceGrantId, new { days, note = reason, settlement.Id, settlement.CreatedGrantId }, reason: reason);
        return settlement;
    }
}
