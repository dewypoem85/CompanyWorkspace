using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public partial class AdjustmentsModel(AppDbContext db, CurrentEmployeeService current, AuditService audit, LeaveCalculationService calc, SecurityPolicyService security, ILogger<AdjustmentsModel> logger) : PageModel
{
    public List<Employee> Employees { get; set; } = [];
    public List<AdjustmentRow> History { get; set; } = [];
    public List<GrantManageRow> GrantRows { get; set; } = [];
    public string? Error { get; set; }
    public string? Success { get; set; }

    [BindProperty] public long EmployeeId { get; set; }
    [BindProperty] public decimal Days { get; set; }
    [BindProperty] public DateOnly? EffectiveDate { get; set; }
    [BindProperty] public string? Note { get; set; }

    [BindProperty] public long AddEmployeeId { get; set; }
    [BindProperty] public LeaveGrantType AddGrantType { get; set; } = LeaveGrantType.Manual;
    [BindProperty] public DateOnly? AddGrantedDate { get; set; }
    [BindProperty] public DateOnly? AddExpiresDate { get; set; }
    [BindProperty] public decimal AddDays { get; set; }
    [BindProperty] public string? AddNote { get; set; }
    [BindProperty] public string? DeleteGrantReason { get; set; }

    public async Task OnGet(long? employeeId)
    {
        Response.Headers.CacheControl = "no-store";
        security.EnsureAdmin(await current.GetRequiredAsync());
        if (employeeId.HasValue)
        {
            EmployeeId = employeeId.Value;
            AddEmployeeId = employeeId.Value;
        }
        await LoadAsync();
    }

    private async Task<IActionResult> AdjustCore()
    {
        var actor = await current.GetRequiredAsync();
        security.EnsureAdmin(actor);
        string requiredNote;
        try { requiredNote = security.RequireReason(Note, "보정 사유"); }
        catch (Exception ex) { Error = ex.Message; return Page(); }
        if (Days == 0)
        {
            Error = "보정 일수는 0일 수 없습니다.";
            return Page();
        }

        if (!IsHalfUnit(Days))
        {
            Error = "보정 일수는 0.5일 단위로 입력해야 합니다.";
            return Page();
        }

        var employee = await db.Employees.SingleOrDefaultAsync(x => x.Id == EmployeeId && !x.IsSharedAccount && !x.IsCompanyMaster);
        if (employee is null)
        {
            Error = "직원을 찾을 수 없습니다.";
            return Page();
        }

        var today = AppTime.Today;
        var cycleStart = EffectiveDate ?? GetCurrentLeaveYearStart(employee.HireDate, today);
        var cycleEnd = cycleStart.AddYears(1).AddDays(-1);
        var trimmedNote = requiredNote;

        await using var tx = await db.Database.BeginTransactionAsync();

        var existing = await db.LeaveGrants.SingleOrDefaultAsync(x =>
            x.EmployeeId == employee.Id &&
            x.GrantType == LeaveGrantType.Manual &&
            x.GrantedDate == cycleStart);

        decimal beforeDays = existing?.GrantedDays ?? 0m;
        if (existing is null)
        {
            existing = new LeaveGrant
            {
                EmployeeId = employee.Id,
                GrantType = LeaveGrantType.Manual,
                GrantedDate = cycleStart,
                ExpiresDate = cycleEnd,
                GrantedDays = Days,
                Note = MakeNote(Days, trimmedNote, actor.Name, today),
                IsImported = false
            };
            db.LeaveGrants.Add(existing);
        }
        else
        {
            existing.GrantedDays += Days;
            existing.ExpiresDate = cycleEnd;
            existing.Note = AppendNote(existing.Note, MakeNote(Days, trimmedNote, actor.Name, today));
        }

        await db.SaveChangesAsync();
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, today);
        await tx.CommitAsync();

        await audit.WriteAsync(actor.Id, "LeaveCountAdjusted", "Employee", employee.Id, new
        {
            EmployeeId = employee.Id,
            employee.Name,
            employee.Email,
            CycleStart = cycleStart,
            CycleEnd = cycleEnd,
            AdjustmentDays = Days,
            BeforeAdjustmentTotal = beforeDays,
            AfterAdjustmentTotal = existing.GrantedDays,
            Note = trimmedNote
        });

        committedGrant = existing;
        Success = $"{employee.Name} 님의 {cycleStart:yyyy-MM-dd} 기준 연차를 {(Days > 0 ? "+" : "")}{Days:0.##}일 보정했습니다.";
        AddEmployeeId = EmployeeId;
        Days = 0;
        Note = null;
        EffectiveDate = cycleStart;
        return Page();
    }

    private async Task<IActionResult> AddCore()
    {
        var actor = await current.GetRequiredAsync();
        security.EnsureAdmin(actor);
        if (AddGrantType == LeaveGrantType.Birthday)
        {
            Error = "생일 보상 발생분은 더 이상 추가할 수 없습니다.";
            return Page();
        }
        string requiredAddNote;
        try { requiredAddNote = security.RequireReason(AddNote, "발생분 추가 사유"); }
        catch (Exception ex) { Error = ex.Message; return Page(); }
        EmployeeId = AddEmployeeId;

        if (AddDays == 0)
        {
            Error = "추가할 일수는 0일 수 없습니다.";
            return Page();
        }

        if (!IsHalfUnit(AddDays))
        {
            Error = "추가할 일수는 0.5일 단위로 입력해야 합니다.";
            return Page();
        }

        if (AddGrantedDate is null)
        {
            Error = "발생일을 입력해야 합니다.";
            return Page();
        }

        var employee = await db.Employees.SingleOrDefaultAsync(x => x.Id == AddEmployeeId && !x.IsSharedAccount && !x.IsCompanyMaster);
        if (employee is null)
        {
            Error = "직원을 찾을 수 없습니다.";
            return Page();
        }

        var grantedDate = AddGrantedDate.Value;
        var expiresDate = AddExpiresDate ?? grantedDate.AddYears(1).AddDays(-1);
        if (expiresDate < grantedDate)
        {
            Error = "만료일은 발생일보다 빠를 수 없습니다.";
            return Page();
        }

        var exists = await db.LeaveGrants.AnyAsync(x =>
            x.EmployeeId == employee.Id &&
            x.GrantType == AddGrantType &&
            x.GrantedDate == grantedDate);
        if (exists)
        {
            Error = "같은 직원, 같은 발생 유형, 같은 발생일의 연차 발생분이 이미 있습니다. 기존 발생분을 삭제하거나 다른 발생일을 사용하세요.";
            return Page();
        }

        var trimmedNote = requiredAddNote;
        var grant = new LeaveGrant
        {
            EmployeeId = employee.Id,
            GrantType = AddGrantType,
            GrantedDate = grantedDate,
            ExpiresDate = expiresDate,
            GrantedDays = AddDays,
            Note = string.IsNullOrWhiteSpace(trimmedNote) ? $"관리자 수동 추가 - {actor.Name}" : $"관리자 수동 추가 - {actor.Name}: {trimmedNote}",
            IsImported = false
        };
        await using var tx = await db.Database.BeginTransactionAsync();
        db.LeaveGrants.Add(grant);
        await db.SaveChangesAsync();
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, employee, AppTime.Today);
        await tx.CommitAsync();

        await audit.WriteAsync(actor.Id, "LeaveGrantAdded", "LeaveGrant", grant.Id, new
        {
            EmployeeId = employee.Id,
            employee.Name,
            employee.Email,
            GrantId = grant.Id,
            GrantType = AddGrantType.ToString(),
            GrantedDate = grantedDate,
            ExpiresDate = expiresDate,
            Days = AddDays,
            Note = trimmedNote
        });

        committedGrant = grant;
        Success = $"{employee.Name} 님에게 {grantedDate:yyyy-MM-dd} 발생분 {AddDays:0.##}일을 추가했습니다.";
        AddGrantedDate = null;
        AddExpiresDate = null;
        AddDays = 0;
        AddNote = null;
        return Page();
    }

    private async Task<IActionResult> DeleteCore(long grantId)
    {
        var actor = await current.GetRequiredAsync();
        try { security.EnsureCanForceDelete(actor); }
        catch (Exception ex) { Error = ex.Message; return Page(); }
        string requiredDeleteReason;
        try { requiredDeleteReason = security.RequireReason(DeleteGrantReason, "발생분 삭제 사유"); }
        catch (Exception ex) { Error = ex.Message; return Page(); }
        var grant = await db.LeaveGrants.Include(x => x.Employee).SingleOrDefaultAsync(x => x.Id == grantId);
        if (grant is null)
        {
            Error = "삭제할 연차 발생분을 찾을 수 없습니다.";
            return Page();
        }

        EmployeeId = grant.EmployeeId;
        AddEmployeeId = grant.EmployeeId;

        var allocated = await db.LeaveAllocations.Where(x => x.LeaveGrantId == grant.Id).SumAsync(x => (decimal?)x.Days) ?? 0m;
        var settled = await db.LeaveSettlements.Where(x => x.SourceGrantId == grant.Id).SumAsync(x => (decimal?)x.Days) ?? 0m;
        if (allocated != 0 || settled != 0)
        {
            Error = $"이미 신청 배정 또는 정산 이력이 있는 발생분은 삭제할 수 없습니다. 배정 {allocated:0.##}일, 정산 {settled:0.##}일이 있습니다. 차감이 필요하면 보정 기능을 사용하세요.";
            return Page();
        }

        var detail = new
        {
            EmployeeId = grant.EmployeeId,
            grant.Employee.Name,
            grant.Employee.Email,
            GrantId = grant.Id,
            GrantType = grant.GrantType.ToString(),
            grant.GrantedDate,
            grant.ExpiresDate,
            grant.GrantedDays,
            grant.Note
        };

        await using var tx = await db.Database.BeginTransactionAsync();
        db.LeaveGrants.Remove(grant);
        await db.SaveChangesAsync();
        await LeaveAdvanceReconciliationService.ReconcileCurrentPeriodAsync(db, grant.Employee, AppTime.Today);
        await tx.CommitAsync();
        await audit.WriteAsync(actor.Id, "LeaveGrantDeleted", "LeaveGrant", grantId, detail, before: detail, reason: requiredDeleteReason);

        committedGrant = grant;
        Success = $"{grant.Employee.Name} 님의 {grant.GrantedDate:yyyy-MM-dd} 발생분 {grant.GrantedDays:0.##}일을 삭제했습니다.";
        return Page();
    }

    private async Task LoadAsync()
    {
        var actor = await current.GetRequiredAsync();
        ActorId = Id(actor.Id); ActorName = actor.Name;
        CanDelete = actor.IsAdmin && (!security.ForceDeleteRequiresMaster || actor.IsMaster);
        Employees = await db.Employees
            .Where(x => !x.IsSharedAccount && !x.IsCompanyMaster)
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.Name)
            .ToListAsync();
        var today = AppTime.Today;
        var firstActive = Employees.FirstOrDefault(x => x.IsActive) ?? Employees.FirstOrDefault();
        if (firstActive is not null)
        {
            if (!Employees.Any(x => x.Id == EmployeeId)) EmployeeId = firstActive.Id;
            if (!Employees.Any(x => x.Id == AddEmployeeId)) AddEmployeeId = EmployeeId;
            var selected = Employees.FirstOrDefault(x => x.Id == EmployeeId) ?? firstActive;
            EffectiveDate ??= GetCurrentLeaveYearStart(selected.HireDate, today);
            AddGrantedDate ??= EffectiveDate;
            var defaultGrantedDate = AddGrantedDate ?? today;
            AddExpiresDate ??= defaultGrantedDate.Year == 9999 ? DateOnly.MaxValue : defaultGrantedDate.AddYears(1).AddDays(-1);
        }

        var grants = await db.LeaveGrants
            .Include(x => x.Employee)
            .Where(x => x.GrantType == LeaveGrantType.Manual)
            .OrderByDescending(x => x.GrantedDate)
            .ThenBy(x => x.Employee.Name)
            .Take(100)
            .ToListAsync();

        History = [];
        foreach (var g in grants)
        {
            var balance = await calc.GetBalanceAsync(g.EmployeeId, today);
            History.Add(new AdjustmentRow(g, balance.Available));
        }

        if (EmployeeId != 0)
        {
            GrantRows = await ReadGrantRows(EmployeeId);
            var selected = Employees.SingleOrDefault(x => x.Id == EmployeeId);
            if (selected is not null) InitialCatalogJson = System.Text.Json.JsonSerializer.Serialize(await CatalogAsync(selected, actor, GrantRows), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        }
    }

    private static bool IsHalfUnit(decimal value) => value % .5m == 0;

    public static DateOnly GetCurrentLeaveYearStart(DateOnly hireDate, DateOnly today)
    {
        var years = today.Year - hireDate.Year;
        var candidate = hireDate.AddYears(years);
        if (candidate > today) candidate = hireDate.AddYears(years - 1);
        return candidate;
    }

    public static string MakeNote(decimal days, string? note, string actorName, DateOnly today)
    {
        var prefix = days > 0 ? "+" : "";
        var reason = string.IsNullOrWhiteSpace(note) ? "사유 없음" : note;
        return $"{today:yyyy-MM-dd} {actorName}: {prefix}{days:0.##}일 보정 - {reason}";
    }

    public static string AppendNote(string? oldNote, string newNote)
    {
        if (string.IsNullOrWhiteSpace(oldNote)) return newNote;
        return oldNote + Environment.NewLine + newNote;
    }

    public static string GrantTypeName(LeaveGrantType type) => type switch
    {
        LeaveGrantType.Manual => "수동/보정",
        LeaveGrantType.Monthly => "월차",
        LeaveGrantType.Annual => "연차",
        LeaveGrantType.CarriedOver => "이월",
        LeaveGrantType.Imported => "가져오기",
        LeaveGrantType.Birthday => "생일 미사용 추가",
        _ => type.ToString()
    };
}

public record AdjustmentRow(LeaveGrant Grant, decimal CurrentAvailable);
public record GrantManageRow(LeaveGrant Grant, decimal Allocated, decimal Settled, decimal Remaining);
public record GrantRowView(GrantManageRow Row, bool CanDelete, bool ReasonRequired);
