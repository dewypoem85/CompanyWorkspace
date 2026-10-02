using System.Globalization;
using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public class SettlementsModel(AppDbContext db, LeaveCalculationService calc, LeaveSettlementService service,
    CurrentEmployeeService current, SecurityPolicyService security, ILogger<SettlementsModel> logger) : PageModel
{
    const string Media = "application/vnd.company.workspace-form+json";
    public List<LeaveGrantBalance> Grants { get; private set; } = [];
    public List<LeaveSettlement> History { get; private set; } = [];
    public Dictionary<long, Employee> Employees { get; private set; } = [];
    public Dictionary<long, string> Snapshots { get; private set; } = [];
    public string ActorId { get; private set; } = "";
    public bool ReasonRequired => security.RequireReasonsForSensitiveAdminActions;
    public string? Error { get; private set; }
    public string? RawDraft { get; private set; }
    public bool Locked { get; private set; }
    public DateOnly Today { get; private set; }
    public static string Days(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    public static string TypeLabel(LeaveSettlementType type) => type switch {
        LeaveSettlementType.Expiration => "소멸", LeaveSettlementType.CarryOver => "이월",
        LeaveSettlementType.Compensation => "보상", LeaveSettlementType.AdvanceRepayment => "가불 차감", _ => "기타"
    };
    public async Task OnGet()
    {
        Response.Headers.CacheControl = "no-store";
        var actor = await current.GetRequiredAsync(); security.EnsureAdmin(actor);
        ActorId = actor.Id.ToString(CultureInfo.InvariantCulture); Today = AppTime.Today;
        Employees = await db.Employees.AsNoTracking().ToDictionaryAsync(x => x.Id);
        Grants = [];
        foreach (var employee in Employees.Values.Where(x => x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster).OrderBy(x => x.Name))
            Grants.AddRange((await calc.GetGrantBalancesAsync(employee.Id, Today)).Where(x => x.Available > 0));
        Snapshots = [];
        foreach (var balance in Grants) Snapshots[balance.Grant.Id] = await LeaveSettlementSnapshot.ComputeAsync(db, balance, Today);
        History = await db.LeaveSettlements.AsNoTracking().OrderByDescending(x => x.ProcessedDate).ThenByDescending(x => x.Id).Take(100).ToListAsync();
    }

    public async Task<IActionResult> OnPost(long grantId, LeaveSettlementType type, decimal days, string? note)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == Media);
        var baseline = enhanced || Request.Form.ContainsKey("expectedEmployeeId") || Request.Form.ContainsKey("expectedSnapshot");
        async Task<IActionResult> Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = Media };
            Error = message; Locked = true;
            RawDraft = JsonSerializer.Serialize(new[] { "grantId", "type", "days", "note" }.ToDictionary(key => key, key => Request.Form[key].ToArray()));
            await OnGet(); Response.StatusCode = status; return Page();
        }
        var actor = await current.GetRequiredAsync();
        if (!actor.IsAdmin) return await Failure("denied", "관리자만 연차 정산을 처리할 수 있습니다.", 403);
        var actorId = actor.Id.ToString(CultureInfo.InvariantCulture);
        if (baseline && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != actorId ||
            Request.Form["expectedSnapshot"].Count != 1 || !System.Text.RegularExpressions.Regex.IsMatch(Request.Form["expectedSnapshot"].ToString(), "\\A[a-f0-9]{64}\\z")))
            return await Failure("conflict", "화면의 계정 또는 발생분 기준값을 확인할 수 없습니다. 최신 내역을 확인해 주세요.", 409);
        if (new[] { "grantId", "type", "days" }.Any(key => Request.Form[key].Count != 1 || ModelState.TryGetValue(key, out var state) && state.Errors.Count > 0) ||
            Request.Form["note"].Count > 1 || grantId <= 0 || !Enum.IsDefined(type))
            return await Failure("invalid", "발생분·처리 종류·일수·사유를 확인해 주세요.", 422);
        try
        {
            var previousSnapshot = baseline ? Request.Form["expectedSnapshot"].ToString() : null;
            var result = await service.SettleAsync(grantId, actor.Id, type, days, note, previousSnapshot);
            if (!enhanced) return RedirectToPage();
            // Audit has also completed. Earlier failure may still represent a committed settlement.
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = "연차 정산을 처리했습니다.", data = new {
                operation = "Settle", actorEmployeeId = actorId, employeeId = result.EmployeeId.ToString(CultureInfo.InvariantCulture),
                grantId = result.SourceGrantId.ToString(CultureInfo.InvariantCulture), id = result.Id.ToString(CultureInfo.InvariantCulture),
                previousSnapshot, type = result.Type.ToString(), days = Days(result.Days), note = result.Note,
                processedDate = result.ProcessedDate.ToString("yyyy-MM-dd"), createdGrantId = result.CreatedGrantId?.ToString(CultureInfo.InvariantCulture),
                navigateTo = Url.Page("/Admin/Settlements")
            } }) { ContentType = Media };
        }
        catch (LeaveSettlementValidationException ex) { return await Failure("invalid", ex.Message, 422); }
        catch (LeaveSettlementConflictException ex) { return await Failure("conflict", ex.Message, 409); }
        catch (UnauthorizedAccessException) { return await Failure("denied", "정산 처리 권한이 없습니다.", 403); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "Leave settlement outcome uncertain for grant {GrantId}", grantId);
            return await Failure("unknown", "정산 결과를 확인하지 못했습니다. 일부 변경이 반영됐을 수 있으므로 반복 처리하지 말고 최신 정산 내역을 확인해 주세요.", 500);
        }
    }
}
