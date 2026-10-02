using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public partial class AdjustmentsModel
{
    const string FormMedia = "application/vnd.company.workspace-form+json";
    static readonly string[] DraftFields = ["EmployeeId", "Days", "EffectiveDate", "Note", "AddEmployeeId", "AddGrantType", "AddGrantedDate", "AddExpiresDate", "AddDays", "AddNote", "grantId", "DeleteGrantReason"];
    LeaveGrant? committedGrant;
    public bool Locked { get; private set; }
    public string? RawDraft { get; private set; }
    public string ActorId { get; private set; } = "";
    public string ActorName { get; private set; } = "";
    public string Today => Date(AppTime.Today);
    public bool ReasonRequired => security.RequireReasonsForSensitiveAdminActions;
    public bool CanDelete { get; private set; }
    public string InitialCatalogJson { get; private set; } = "null";
    static string Id(long value) => value.ToString(CultureInfo.InvariantCulture);
    static string Amount(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    static string Date(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public Task<IActionResult> OnPost() => Execute("Adjust");
    public Task<IActionResult> OnPostAddGrant() => Execute("AddGrant");
    public Task<IActionResult> OnPostDeleteGrant(long grantId) => Execute("DeleteGrant", grantId);

    // Read only. The page policy and current actor are still required. No new baseline is
    // silently assigned to an existing draft by this endpoint.
    public async Task<IActionResult> OnGetBaseline(long employeeId)
    {
        Response.Headers.CacheControl = "no-store";
        var actor = await current.GetRequiredAsync(); security.EnsureAdmin(actor);
        var employee = await db.Employees.AsNoTracking().SingleOrDefaultAsync(x => x.Id == employeeId && !x.IsSharedAccount && !x.IsCompanyMaster);
        if (employee is null) return NotFound();
        return new JsonResult(await CatalogAsync(employee, actor, await ReadGrantRows(employeeId)));
    }

    async Task<object> CatalogAsync(Employee employee, Employee actor, IEnumerable<GrantManageRow> grants)
    {
        var rows = new List<object>();
        foreach (var row in grants) rows.Add(new { grant = GrantValue(row.Grant), snapshot = await LeaveGrantSnapshot.ComputeAsync(db, row.Grant),
            allocated = Amount(row.Allocated), settled = Amount(row.Settled), remaining = Amount(row.Remaining) });
        return new { protocol = "leave-grants-v1", actorEmployeeId = Id(actor.Id), actorName = actor.Name, today = Today,
            canDelete = actor.IsAdmin && (!security.ForceDeleteRequiresMaster || actor.IsMaster), reasonRequired = ReasonRequired,
            employeeId = Id(employee.Id), employeeName = employee.Name, employeeSnapshot = LeaveGrantSnapshot.Employee(employee),
            defaultDate = Date(GetCurrentLeaveYearStart(employee.HireDate, AppTime.Today)), grants = rows };
    }

    async Task<List<GrantManageRow>> ReadGrantRows(long employeeId)
    {
        var grants = await db.LeaveGrants.AsNoTracking().Include(x => x.Employee).Where(x => x.EmployeeId == employeeId)
            .OrderByDescending(x => x.ExpiresDate).ThenByDescending(x => x.GrantedDate).ThenBy(x => x.Id).ToListAsync();
        var rows = new List<GrantManageRow>();
        foreach (var grant in grants) {
            var allocated = await db.LeaveAllocations.Where(x => x.LeaveGrantId == grant.Id).SumAsync(x => (decimal?)x.Days) ?? 0m;
            var settled = await db.LeaveSettlements.Where(x => x.SourceGrantId == grant.Id).SumAsync(x => (decimal?)x.Days) ?? 0m;
            rows.Add(new(grant, allocated, settled, grant.GrantedDays - allocated - settled));
        }
        return rows;
    }

    static object GrantValue(LeaveGrant grant) => new {
        id = Id(grant.Id), employeeId = Id(grant.EmployeeId), type = grant.GrantType.ToString(),
        grantedDate = Date(grant.GrantedDate), expiresDate = Date(grant.ExpiresDate), days = Amount(grant.GrantedDays),
        sourceGrantId = grant.SourceGrantId is long sourceId ? Id(sourceId) : null, note = grant.Note, grant.IsImported
    };

    async Task<IActionResult> Execute(string operation, long grantId = 0)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == FormMedia);
        var baseline = enhanced || new[] { "expectedEmployeeId", "expectedEmployeeSnapshot", "expectedSnapshot" }.Any(Request.Form.ContainsKey);
        IActionResult Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = FormMedia };
            Error = message; Success = null; Locked = true;
            RawDraft = JsonSerializer.Serialize(DraftFields.ToDictionary(key => key, key => Request.Form[key].ToArray()));
            // Keep the submitted source only in the encoded recovery block. Do not turn a
            // malformed date into a fresh actionable native form, nor echo arbitrary fields.
            ModelState.Clear(); EffectiveDate = AddGrantedDate = AddExpiresDate = null;
            Response.StatusCode = status; return Page();
        }
        var actor = await current.GetRequiredAsync();
        try { if (operation == "DeleteGrant") security.EnsureCanForceDelete(actor); else security.EnsureAdmin(actor); }
        catch (UnauthorizedAccessException) { return Failure("denied", "이 연차 작업을 처리할 권한이 없습니다.", 403); }
        if (baseline && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != Id(actor.Id) ||
            Request.Form["expectedEmployeeSnapshot"].Count != 1 || !Regex.IsMatch(Request.Form["expectedEmployeeSnapshot"].ToString(), "\\A[a-f0-9]{64}\\z") ||
            Request.Form["expectedSnapshot"].Count != 1 || !Regex.IsMatch(Request.Form["expectedSnapshot"].ToString(), "\\A(?:[a-f0-9]{64})?\\z")))
            return Failure("conflict", "화면의 계정 또는 발생분 기준값이 없습니다. 최신 내역을 확인해 주세요.", 409);

        string[] required = operation switch { "Adjust" => ["EmployeeId", "Days"], "AddGrant" => ["AddEmployeeId", "AddGrantType", "AddGrantedDate", "AddDays"], _ => ["grantId"] };
        string[] optional = operation switch { "Adjust" => ["EffectiveDate", "Note"], "AddGrant" => ["AddExpiresDate", "AddNote"], _ => ["DeleteGrantReason"] };
        if (required.Any(key => Request.Form[key].Count != 1) || optional.Any(key => Request.Form[key].Count > 1) ||
            required.Concat(optional).Any(key => ModelState.TryGetValue(key, out var state) && state.Errors.Count > 0))
            return Failure("invalid", "직원·발생 유형·날짜·일수·사유 입력을 확인해 주세요.", 422);
        if (operation == "Adjust" && (EmployeeId <= 0 || Days == 0 || !IsHalfUnit(Days)) ||
            operation == "AddGrant" && (AddEmployeeId <= 0 || AddGrantedDate is null || AddDays == 0 || !IsHalfUnit(AddDays) || !Enum.IsDefined(AddGrantType) || AddGrantType == LeaveGrantType.Birthday) ||
            operation == "DeleteGrant" && grantId <= 0)
            return Failure("invalid", "직원·발생 유형·날짜와 0이 아닌 0.5일 단위 일수를 확인해 주세요.", 422);

        string reason;
        try { reason = security.RequireReason(operation switch { "Adjust" => Note, "AddGrant" => AddNote, _ => DeleteGrantReason }); }
        catch (InvalidOperationException ex) { return Failure("invalid", ex.Message, 422); }
        var existing = operation == "DeleteGrant" ? await db.LeaveGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == grantId) : null;
        var employeeId = operation switch { "Adjust" => EmployeeId, "AddGrant" => AddEmployeeId, _ => existing?.EmployeeId ?? 0 };
        var employee = await db.Employees.AsNoTracking().SingleOrDefaultAsync(x => x.Id == employeeId && !x.IsSharedAccount && !x.IsCompanyMaster);
        // Retired/private employees remain eligible for historical corrections by an administrator.
        if (employee is null) return Failure("conflict", "대상 직원 또는 발생분을 찾을 수 없습니다.", 409);
        var employeeSnapshot = LeaveGrantSnapshot.Employee(employee);
        if (baseline && Request.Form["expectedEmployeeSnapshot"] != employeeSnapshot)
            return Failure("conflict", "직원 정보가 변경되었습니다. 최신 내역을 확인해 주세요.", 409);
        var grantedDate = operation switch { "Adjust" => EffectiveDate ?? GetCurrentLeaveYearStart(employee.HireDate, AppTime.Today), "AddGrant" => AddGrantedDate!.Value, _ => existing!.GrantedDate };
        DateOnly expiresDate;
        try { expiresDate = operation switch { "Adjust" => grantedDate.AddYears(1).AddDays(-1), "AddGrant" => AddExpiresDate ?? grantedDate.AddYears(1).AddDays(-1), _ => existing!.ExpiresDate }; }
        catch (ArgumentOutOfRangeException) { return Failure("invalid", "자동 만료일을 계산할 수 없는 날짜입니다. 날짜를 확인해 주세요.", 422); }
        if (expiresDate < grantedDate) return Failure("invalid", "만료일은 발생일보다 빠를 수 없습니다.", 422);
        var type = operation switch { "Adjust" => LeaveGrantType.Manual, "AddGrant" => AddGrantType, _ => existing!.GrantType };
        if (operation != "DeleteGrant") existing = await db.LeaveGrants.AsNoTracking().SingleOrDefaultAsync(x => x.EmployeeId == employeeId && x.GrantType == type && x.GrantedDate == grantedDate);
        var previousSnapshot = existing is null ? "" : await LeaveGrantSnapshot.ComputeAsync(db, existing);
        if (baseline && Request.Form["expectedSnapshot"] != previousSnapshot)
            return Failure("conflict", "발생분 또는 배정·정산 내역이 변경되었습니다. 최신 내역을 확인해 주세요.", 409);
        if (operation == "AddGrant" && existing is not null)
            return Failure("invalid", "같은 직원·발생 유형·발생일의 발생분이 이미 있습니다.", 422);
        var inputDays = operation switch { "Adjust" => Days, "AddGrant" => AddDays, _ => existing!.GrantedDays };
        var beforeDays = existing?.GrantedDays ?? 0m;
        try { if (operation == "Adjust") _ = checked(beforeDays + inputDays); }
        catch (OverflowException) { return Failure("invalid", "보정 결과가 저장 가능한 일수 범위를 초과합니다.", 422); }
        try
        {
            var result = operation switch { "Adjust" => await AdjustCore(), "AddGrant" => await AddCore(), _ => await DeleteCore(grantId) };
            if (Error is not null) return Failure("invalid", Error, 422);
            if (!enhanced) { await LoadAsync(); return result; }
            // Each original operation has completed both its business write and subsequent
            // audit. Any exception after starting it is uncertain, never an input rollback.
            var grant = committedGrant ?? throw new InvalidOperationException("Missing committed grant");
            var persisted = operation == "DeleteGrant" ? null : await db.LeaveGrants.AsNoTracking().SingleAsync(x => x.Id == grant.Id);
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = Success, data = new {
                operation, actorEmployeeId = Id(actor.Id), employeeId = Id(employeeId), employeeSnapshot, previousSnapshot,
                snapshot = persisted is null ? "" : await LeaveGrantSnapshot.ComputeAsync(db, persisted),
                grant = GrantValue(persisted ?? grant), beforeDays = Amount(beforeDays), inputDays = Amount(inputDays), reason,
                navigateTo = Url.Page("/Admin/Adjustments", new { employeeId = Id(employeeId) })
            } }) { ContentType = FormMedia };
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "Leave grant {Operation} outcome uncertain for employee {EmployeeId}", operation, employeeId);
            return Failure("unknown", "처리 결과를 확인하지 못했습니다. 일부 변경이 반영됐을 수 있으므로 반복 처리하지 말고 최신 내역과 감사 기록을 확인해 주세요.", 500);
        }
    }
}
