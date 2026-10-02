using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Globalization;

namespace LeaveManager.Pages.Leave;

public class IndexModel(AppDbContext db, CurrentEmployeeService current, LeaveCalculationService calc, LeaveRequestService requests, LeaveDateService leaveDates, SecurityPolicyService security, AuditService audit, IScheduleMilestoneReader scheduleMilestones, ILogger<IndexModel> logger) : PageModel
{
    const string ApplicationMedia = "application/vnd.company.workspace-form+json";
    public bool ApplicationLocked { get; private set; }
    public string? ApplicationRawDraft { get; private set; }
    public static readonly IReadOnlyList<string> ExternalScheduleCategories = ["외근", "외부 일정", "출장", "기타"];

    [BindProperty(SupportsGet = true)] public int Year { get; set; }
    [BindProperty(SupportsGet = true)] public int Month { get; set; }
    [BindProperty(SupportsGet = true)] public string CalendarView { get; set; } = "month";
    [BindProperty(SupportsGet = true)] public bool SelfOnly { get; set; }
    [BindProperty(SupportsGet = true)] public bool ShowOthers { get; set; }
    [BindProperty(SupportsGet = true)] public bool SaveCalendarPreference { get; set; }
    [BindProperty(SupportsGet = true)] public long? ViewEmployeeId { get; set; }
    [BindProperty(SupportsGet = true)] public int RequestLimit { get; set; } = 10;
    [BindProperty(SupportsGet = true)] public int RequestPage { get; set; } = 1;
    [BindProperty] public ApplyInputModel Input { get; set; } = new();
    [BindProperty] public AdminForceLeaveInputModel ForceInput { get; set; } = new();
    [BindProperty] public long ForceDeleteRequestId { get; set; }
    [BindProperty] public string? ForceDeleteReason { get; set; }
    [BindProperty] public ExternalScheduleInputModel ExternalInput { get; set; } = new();

    public Employee Employee { get; set; } = null!;
    public Employee CurrentEmployee { get; set; } = null!;
    public List<Employee> ViewableEmployees { get; set; } = [];
    public List<Employee> ExternalScheduleEmployees { get; set; } = [];
    public bool IsAdminPreview => CurrentEmployee.IsAdmin && Employee.Id != CurrentEmployee.Id;
    public bool IsYearView => string.Equals(CalendarView, "year", StringComparison.OrdinalIgnoreCase);
    public LeaveBalance Balance { get; set; } = new(0, 0, 0, 0);
    public decimal CurrentYearGrantedDays { get; set; }
    public decimal CurrentYearUsedDays { get; set; }
    public decimal CurrentYearPendingDays { get; set; }
    public decimal OutstandingAdvanceDays { get; set; }
    public decimal OutstandingMonthlyAdvanceDays { get; set; }
    public decimal OutstandingAnnualAdvanceDays { get; set; }
    public int CompletedYears { get; set; }
    public int NextAnnualDays { get; set; }
    public List<LeaveRequest> Requests { get; set; } = [];
    public int RequestTotalCount { get; set; }
    public int RequestTotalPages => Math.Max(1, (int)Math.Ceiling(RequestTotalCount / (double)RequestLimit));
    public List<CalendarWeek> CalendarWeeks { get; set; } = [];
    public List<IndexYearCalendarMonth> YearCalendarMonths { get; set; } = [];
    public bool ScheduleMilestonesAvailable { get; private set; } = true;
    public decimal CalendarYearUsedDays { get; set; }
    public decimal CalendarYearPendingDays { get; set; }
    public string NextRenewalLabel { get; set; } = "";
    public string NextRenewalDday { get; set; } = "";
    public BirthdayLeaveAvailability BirthdayLeave { get; private set; } = new("missing", "", "", "neutral", null, []);
    public string? Error { get; set; }
    public bool ShowApplyPanel { get; set; }
    public bool CanAdminEditCalendar => CurrentEmployee.IsAdmin && !IsAdminPreview && !AdminForceLocked;
    public bool AdminForceLocked { get; private set; }
    public string? AdminForceRawDraft { get; private set; }
    public bool ForceReasonRequired => security.RequireReasonsForSensitiveAdminActions;
    public bool CanManageExternalSchedules => CurrentEmployee.IsAdmin && !ExternalScheduleLocked;
    public bool ExternalScheduleLocked { get; private set; }
    public string? ExternalScheduleRawDraft { get; private set; }
    public bool CanForceDelete => CurrentEmployee.IsMaster || !security.ForceDeleteRequiresMaster;
    private bool CanEmployeeViewOthers => !CurrentEmployee.IsAdmin && ShowOthers && !IsAdminPreview;

    public async Task OnGet()
    {
        Response.Headers.CacheControl = "no-store";
        await LoadPageAsync(null);
    }

    public async Task<IActionResult> OnPostApply()
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == ApplicationMedia);
        async Task<IActionResult> Failure(string outcome, string message, int status) {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = ApplicationMedia };
            Error = message; ShowApplyPanel = true; ApplicationLocked = outcome != "invalid"; CalendarView = "month";
            ApplicationRawDraft = System.Text.Json.JsonSerializer.Serialize(new[] { "Input.StartDate", "Input.EndDate", "Input.Portion", "Input.Reason", "Input.WorkPlan" }.ToDictionary(key => key, key => Request.Form[key].ToArray()));
            await LoadPageAsync(Input.StartDate == default ? null : Input.StartDate);Response.StatusCode = status;return Page();
        }
        var e = await current.GetRequiredAsync();var owner = e.Id.ToString(CultureInfo.InvariantCulture);
        if ((enhanced || Request.Form.ContainsKey("expectedEmployeeId")) && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != owner))
            return await Failure("conflict", "신청 화면을 연 직원과 현재 계정이 다릅니다. 현재 계정의 신청 내역을 확인해 주세요.", 409);
        if (ViewEmployeeId.HasValue && ViewEmployeeId.Value != e.Id)
            return await Failure("invalid", "관리자 대신보기 모드에서는 해당 직원 명의로 연차를 신청할 수 없습니다.", 422);
        if (new[] { "Input.StartDate", "Input.EndDate", "Input.Portion", "Input.WorkPlan" }.Any(key => Request.Form[key].Count != 1)
            || Request.Form["Input.Reason"].Count > 1 || ModelState.Any(entry => entry.Key.StartsWith("Input.", StringComparison.Ordinal) && entry.Value!.Errors.Count > 0)
            || !Enum.IsDefined(Input.Portion))
            return await Failure("invalid", "신청 날짜·유형·업무 기록을 확인해 주세요. 업무 기록은 2000자 이하여야 합니다.", 422);
        try
        {
            var created = await requests.CreateAsync(e.Id, new(Input.StartDate, Input.EndDate, Input.Portion, Input.Reason, Input.WorkPlan));
            var route = new { Year = Input.StartDate.Year, Month = Input.StartDate.Month, CalendarView = "month", SelfOnly, ShowOthers, ViewEmployeeId, RequestLimit, RequestPage = 1 };
            if (!enhanced) return RedirectToPage(route);
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = "연차 신청을 등록했습니다. 승인 대기 상태입니다.", data = new {
                operation = "Apply", employeeId = owner, id = created.Id.ToString(CultureInfo.InvariantCulture), status = created.Status.ToString(),
                input = new { startDate = Input.StartDate.ToString("yyyy-MM-dd"), endDate = (Input.EndDate < Input.StartDate ? Input.StartDate : Input.EndDate).ToString("yyyy-MM-dd"), portion = Input.Portion.ToString(), reason = created.Reason, workPlan = created.WorkPlan },
                calculatedDays = created.CalculatedDays.ToString(CultureInfo.InvariantCulture),
                dates = created.Dates.OrderBy(x => x.Date).Select(x => new { date = x.Date.ToString("yyyy-MM-dd"), portion = x.Portion.ToString() }),
                navigateTo = Url.Page("/Leave/Index", route)
            } }) { ContentType = ApplicationMedia };
        }
        catch (LeaveRequestValidationException ex) { return await Failure("invalid", ex.Message, 422); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "Leave application outcome is uncertain for employee {EmployeeId}", e.Id);
            return await Failure("unknown", "신청 결과를 확인하지 못했습니다. 신청이나 알림 일부가 반영되었을 수 있으므로 재신청하지 말고 최신 내역을 확인해 주세요.", 500);
        }
    }

    public Task<IActionResult> OnPostCancel(long id) => ProcessSelfAction(id, "Cancel");
    public Task<IActionResult> OnPostWithdrawCancel(long id) => ProcessSelfAction(id, "WithdrawCancel");
    public bool SelfActionLocked { get; private set; }
    async Task<IActionResult> ProcessSelfAction(long id, string operation)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == ApplicationMedia);
        async Task<IActionResult> Failure(string outcome, string message, int status) {
            if(enhanced) return new JsonResult(new { protocol="workspace-form-v1",outcome,message }) { StatusCode=status,ContentType=ApplicationMedia };
            Error=message;SelfActionLocked=true;await LoadPageAsync(null);Response.StatusCode=status;return Page();
        }
        var actor=await current.GetRequiredAsync();var owner=actor.Id.ToString(CultureInfo.InvariantCulture);
        var baseline=enhanced||Request.Form.ContainsKey("expectedEmployeeId")||Request.Form.ContainsKey("expectedSnapshot");
        if(baseline&&(Request.Form["expectedEmployeeId"].Count!=1||Request.Form["expectedEmployeeId"]!=owner))
            return await Failure("conflict","화면을 연 계정과 현재 직원이 다릅니다. 현재 계정의 내역을 확인해 주세요.",409);
        if(ViewEmployeeId.HasValue&&ViewEmployeeId.Value!=actor.Id)
            return await Failure("invalid","관리자 대신보기에서는 다른 직원의 취소·철회를 실행할 수 없습니다.",422);
        if(id<=0||Request.Form["id"].Count!=1||ModelState.TryGetValue("id",out var idState)&&idState.Errors.Count>0)
            return await Failure("invalid","처리할 신청 번호를 확인해 주세요.",422);
        var request=await db.LeaveRequests.Include(x=>x.Dates).SingleOrDefaultAsync(x=>x.Id==id&&x.EmployeeId==actor.Id);
        if(request is null)return await Failure("conflict","현재 직원의 신청을 찾지 못했습니다. 최신 내역을 확인해 주세요.",409);
        var before=LeaveRequestSnapshot.Compute(request);var previousStatus=request.Status;
        if(baseline&&(Request.Form["expectedSnapshot"].Count!=1||Request.Form["expectedSnapshot"]!=before))
            return await Failure("conflict","신청 내용이나 처리 상태가 변경되었습니다. 최신 내역을 확인해 주세요.",409);
        if(operation=="WithdrawCancel"?previousStatus!=LeaveRequestStatus.CancelRequested:previousStatus is not (LeaveRequestStatus.Pending or LeaveRequestStatus.Approved))
            return await Failure("invalid","현재 신청 상태에서는 이 작업을 할 수 없습니다. 최신 내역을 확인해 주세요.",422);
        if(operation=="Cancel"&&previousStatus==LeaveRequestStatus.Approved&&request.Dates.Any(x=>x.Date<AppTime.Today))
            return await Failure("invalid","이미 사용일이 지난 연차는 취소 요청할 수 없습니다. 관리자에게 문의하세요.",422);
        try {
            if(operation=="Cancel")await requests.RequestCancelAsync(id,actor.Id);
            else await requests.WithdrawCancelRequestAsync(id,actor.Id);
            var route=new { Year,Month,CalendarView,SelfOnly,ShowOthers,ViewEmployeeId,RequestLimit,RequestPage };
            if(!enhanced)return RedirectToPage(route);
            return new JsonResult(new { protocol="workspace-form-v1",outcome="saved",message=operation=="WithdrawCancel"?"취소 요청을 철회했습니다.":previousStatus==LeaveRequestStatus.Pending?"신청을 취소했습니다.":"취소 승인을 요청했습니다.",data=new {
                operation,employeeId=owner,id=id.ToString(CultureInfo.InvariantCulture),previousSnapshot=before,previousStatus=previousStatus.ToString(),status=request.Status.ToString(),navigateTo=Url.Page("/Leave/Index",route)
            }}) { ContentType=ApplicationMedia };
        }
        catch(OperationCanceledException){throw;}
        catch(Exception ex){logger.LogError(ex,"Leave self action {Operation} outcome uncertain for {EmployeeId} request {RequestId}",operation,actor.Id,id);return await Failure("unknown","처리 결과를 확인하지 못했습니다. 일부 반영됐을 수 있으므로 반복 실행하지 말고 최신 내역을 확인해 주세요.",500);}
    }

    public Task<IActionResult> OnPostAdminForceAdd() => ProcessAdminForce(false);
    public Task<IActionResult> OnPostAdminForceDelete() => ProcessAdminForce(true);

    async Task<IActionResult> ProcessAdminForce(bool deleting)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == ApplicationMedia);
        var baseline = enhanced || Request.Form.ContainsKey("expectedEmployeeId") || Request.Form.ContainsKey("expectedSnapshot");
        var operation = deleting ? "AdminForceDelete" : "AdminForceAdd";
        async Task<IActionResult> Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = ApplicationMedia };
            Error = message; AdminForceLocked = true;
            // Retain only business inputs, encoded by Razor; never echo credentials or arbitrary POST fields.
            var keys = deleting ? new[] { "ForceDeleteRequestId", "ForceDeleteReason" }
                : new[] { "ForceInput.EmployeeId", "ForceInput.Date", "ForceInput.Portion", "ForceInput.Reason" };
            AdminForceRawDraft = System.Text.Json.JsonSerializer.Serialize(keys.ToDictionary(key => key, key => Request.Form[key].ToArray()));
            await LoadPageAsync(null); Response.StatusCode = status; return Page();
        }
        var admin = await current.GetRequiredAsync();
        var actorId = admin.Id.ToString(CultureInfo.InvariantCulture);
        if (!admin.IsAdmin) return await Failure("denied", "관리자만 강제 연차 작업을 할 수 있습니다.", 403);
        if (baseline && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != actorId))
            return await Failure("conflict", "화면을 연 관리자와 현재 계정이 다릅니다. 현재 계정으로 내역을 다시 확인해 주세요.", 409);
        if (ViewEmployeeId.HasValue && ViewEmployeeId.Value != admin.Id)
            return await Failure("invalid", "관리자 대신보기에서는 강제 연차 작업을 할 수 없습니다. 내 화면에서 실행해 주세요.", 422);
        var fields = deleting ? new[] { "ForceDeleteRequestId", "ForceDeleteReason" }
            : new[] { "ForceInput.EmployeeId", "ForceInput.Date", "ForceInput.Portion", "ForceInput.Reason" };
        if (fields.Any(key => Request.Form[key].Count != 1 || ModelState.TryGetValue(key, out var state) && state.Errors.Count > 0)
            || (deleting ? ForceDeleteRequestId <= 0 : ForceInput.EmployeeId <= 0 || ForceInput.Date == default || !Enum.IsDefined(ForceInput.Portion)))
            return await Failure("invalid", "대상·날짜·유형·사유를 확인해 주세요.", 422);
        string reason;
        try
        {
            if (deleting) security.EnsureCanForceDelete(admin);
            reason = security.RequireReason(deleting ? ForceDeleteReason : ForceInput.Reason, deleting ? "강제 삭제 사유" : "강제 추가 사유");
        }
        catch (UnauthorizedAccessException) { return await Failure("denied", "강제 삭제 권한이 없습니다.", 403); }
        catch (InvalidOperationException ex) { return await Failure("invalid", ex.Message, 422); }

        LeaveRequest? request = null;
        var previousSnapshot = "";
        string? previousStatus = null;
        if (deleting)
        {
            request = await db.LeaveRequests.Include(x => x.Employee).Include(x => x.Dates).SingleOrDefaultAsync(x => x.Id == ForceDeleteRequestId);
            if (request is null || request.Employee.IsCompanyMaster)
                return await Failure("conflict", "삭제할 신청을 확인할 수 없습니다. 최신 내역을 확인해 주세요.", 409);
            previousSnapshot = LeaveRequestSnapshot.Compute(request);
            previousStatus = request.Status.ToString();
        }
        if (baseline && (Request.Form["expectedSnapshot"].Count != 1 || Request.Form["expectedSnapshot"] != previousSnapshot))
            return await Failure("conflict", "신청 내용이나 상태가 변경되었습니다. 최신 내역을 확인해 주세요.", 409);
        try
        {
            if (deleting) await requests.ForceDeleteAsync(request!.Id, admin.Id, reason);
            else request = await requests.ForceCreateForDateAsync(ForceInput.EmployeeId, admin.Id, ForceInput.Date, ForceInput.Portion, reason);
            var route = deleting ? new { Year, Month, CalendarView, SelfOnly, ShowOthers, ViewEmployeeId, RequestLimit, RequestPage }
                : new { Year = ForceInput.Date.Year, Month = ForceInput.Date.Month, CalendarView = "month", SelfOnly, ShowOthers, ViewEmployeeId, RequestLimit, RequestPage };
            if (!enhanced) return RedirectToPage(route);
            // The receipt baseline must match a later SQLite read (DateTime.Kind round trip).
            if (!deleting) request = await db.LeaveRequests.AsNoTracking().Include(x => x.Dates).SingleAsync(x => x.Id == request!.Id);
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = deleting ? "신청 전체를 강제 삭제했습니다." : "승인 완료 상태로 연차를 추가했습니다.", data = new {
                operation, actorEmployeeId = actorId, targetEmployeeId = request!.EmployeeId.ToString(CultureInfo.InvariantCulture), id = request.Id.ToString(CultureInfo.InvariantCulture),
                previousSnapshot, snapshot = deleting ? "" : LeaveRequestSnapshot.Compute(request), previousStatus, status = deleting ? "deleted" : request.Status.ToString(), reason,
                calculatedDays = request.CalculatedDays.ToString("0.############################", CultureInfo.InvariantCulture),
                dates = request.Dates.OrderBy(x => x.Date).Select(x => new { date = x.Date.ToString("yyyy-MM-dd"), portion = x.Portion.ToString() }),
                navigateTo = Url.Page("/Leave/Index", route)
            } }) { ContentType = ApplicationMedia };
        }
        catch (LeaveRequestValidationException ex) { return await Failure("invalid", ex.Message, 422); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "Calendar admin action {Operation} outcome uncertain for {EmployeeId}", operation, admin.Id);
            return await Failure("unknown", "처리 결과를 확인하지 못했습니다. 연차 변경이나 감사·알림 일부가 반영됐을 수 있으므로 반복 실행하지 말고 최신 내역을 확인해 주세요.", 500);
        }
    }

    public Task<IActionResult> OnPostExternalScheduleSave() => ProcessExternalSchedule(false, ExternalInput.Id);
    public Task<IActionResult> OnPostExternalScheduleDelete(long id) => ProcessExternalSchedule(true, id);

    async Task<IActionResult> ProcessExternalSchedule(bool deleting, long? id)
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == ApplicationMedia);
        var baseline = enhanced || Request.Form.ContainsKey("expectedEmployeeId") || Request.Form.ContainsKey("expectedSnapshot");
        var operation = deleting ? "ExternalScheduleDelete" : "ExternalScheduleSave";
        async Task<IActionResult> Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = ApplicationMedia };
            Error = message; CalendarView = "month"; ExternalScheduleLocked = true;
            // Only submitted business values are preserved; never copy arbitrary form fields or credentials.
            ExternalScheduleRawDraft = System.Text.Json.JsonSerializer.Serialize(new[] { "id", "ExternalInput.Id", "ExternalInput.EmployeeId", "ExternalInput.StartDate", "ExternalInput.EndDate", "ExternalInput.Category", "ExternalInput.Memo" }
                .ToDictionary(key => key, key => Request.Form[key].ToArray()));
            await LoadPageAsync(null); Response.StatusCode = status; return Page();
        }
        var admin = await current.GetRequiredAsync();
        var actorId = admin.Id.ToString(CultureInfo.InvariantCulture);
        if (!admin.IsAdmin) return await Failure("denied", "관리자만 외부 일정을 변경할 수 있습니다.", 403);
        if (baseline && (Request.Form["expectedEmployeeId"].Count != 1 || Request.Form["expectedEmployeeId"] != actorId))
            return await Failure("conflict", "화면을 연 관리자와 현재 계정이 다릅니다. 현재 계정과 일정을 확인해 주세요.", 409);
        var idKey = deleting ? "id" : "ExternalInput.Id";
        if (Request.Form[idKey].Count > 1 || deleting && (Request.Form[idKey].Count != 1 || id is null)
            || id is <= 0 || ModelState.TryGetValue(idKey, out var idState) && idState.Errors.Count > 0)
            return await Failure("invalid", "변경할 일정 번호를 확인해 주세요. 잘못된 수정 요청은 새 일정으로 등록하지 않습니다.", 422);
        if (!deleting)
        {
            var keys = new[] { "ExternalInput.EmployeeId", "ExternalInput.StartDate", "ExternalInput.EndDate", "ExternalInput.Category", "ExternalInput.Memo" };
            if (keys.Any(key => Request.Form[key].Count != 1) || ModelState.Any(entry => entry.Key.StartsWith("ExternalInput.", StringComparison.Ordinal) && entry.Value!.Errors.Count > 0))
                return await Failure("invalid", "직원·날짜·일정 구분·메모를 확인해 주세요. 메모는 500자 이내여야 합니다.", 422);
            ExternalInput.Category = (ExternalInput.Category ?? "").Trim();
            ExternalInput.Memo = (ExternalInput.Memo ?? "").Trim();
            if (ExternalInput.EmployeeId <= 0 || !await db.Employees.AnyAsync(x => x.Id == ExternalInput.EmployeeId && !x.IsSharedAccount && !x.IsCompanyMaster))
                return await Failure("invalid", "일정을 등록할 직원을 선택하세요.", 422);
            if (ExternalInput.StartDate == default || ExternalInput.EndDate == default || ExternalInput.EndDate < ExternalInput.StartDate)
                return await Failure("invalid", "시작일과 종료일을 확인해 주세요.", 422);
            if (!ExternalScheduleCategories.Contains(ExternalInput.Category, StringComparer.Ordinal) || string.IsNullOrWhiteSpace(ExternalInput.Memo) || ExternalInput.Memo.Length > 500)
                return await Failure("invalid", "일정 구분과 500자 이내의 메모를 입력하세요.", 422);
        }
        var item = id.HasValue ? await db.ExternalSchedules.Include(x => x.Employee).SingleOrDefaultAsync(x => x.Id == id.Value) : null;
        if (id.HasValue && item is null) return await Failure("conflict", "일정이 삭제되었거나 존재하지 않습니다. 최신 일정을 확인해 주세요.", 409);
        var previousSnapshot = item is null ? "" : ExternalScheduleFingerprint(item);
        if (baseline && (Request.Form["expectedSnapshot"].Count != 1 || Request.Form["expectedSnapshot"] != previousSnapshot))
            return await Failure("conflict", "일정 내용이 변경되었습니다. 최신 일정을 확인한 뒤 수정해 주세요.", 409);
        var mode = deleting ? "delete" : item is null ? "create" : "update";
        var before = item is null ? null : ExternalScheduleSnapshot(item);
        try
        {
            if (deleting) db.ExternalSchedules.Remove(item!);
            else
            {
                if (item is null)
                {
                    item = new ExternalSchedule { CreatedByEmployeeId = admin.Id, CreatedAtUtc = AppTime.UtcNow };
                    db.ExternalSchedules.Add(item);
                }
                item.EmployeeId = ExternalInput.EmployeeId;
                item.StartDate = ExternalInput.StartDate;
                item.EndDate = ExternalInput.EndDate;
                item.Category = ExternalInput.Category;
                item.Memo = ExternalInput.Memo;
                item.UpdatedByEmployeeId = admin.Id;
                item.UpdatedAtUtc = AppTime.UtcNow;
            }
            await db.SaveChangesAsync();
            // The legacy business commit and audit are separate: audit failure is NOT rollback.
            if (deleting) await audit.WriteAsync(admin.Id, "ExternalScheduleDeleted", "ExternalSchedule", item!.Id, before);
            else if (mode == "create") await audit.WriteAsync(admin.Id, "ExternalScheduleCreated", "ExternalSchedule", item!.Id, ExternalScheduleSnapshot(item));
            else await audit.WriteAsync(admin.Id, "ExternalScheduleUpdated", "ExternalSchedule", item!.Id, before: before, after: ExternalScheduleSnapshot(item));
            var route = CalendarRouteValues(item!.StartDate);
            if (!enhanced) return RedirectToPage(route);
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = deleting ? "외부 일정을 삭제했습니다." : "외부 일정을 저장했습니다.", data = new {
                operation, mode, actorEmployeeId = actorId, id = item.Id.ToString(CultureInfo.InvariantCulture), previousSnapshot,
                snapshot = deleting ? "" : ExternalScheduleFingerprint(item),
                input = new { employeeId = item.EmployeeId.ToString(CultureInfo.InvariantCulture), startDate = item.StartDate.ToString("yyyy-MM-dd"), endDate = item.EndDate.ToString("yyyy-MM-dd"), category = item.Category, memo = item.Memo },
                navigateTo = Url.Page("/Leave/Index", route)
            } }) { ContentType = ApplicationMedia };
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            logger.LogError(ex, "External schedule {Operation} outcome is uncertain for actor {EmployeeId}", operation, admin.Id);
            return await Failure("unknown", "일정 변경 결과를 확인하지 못했습니다. 일부 반영되었을 수 있으므로 다시 저장·삭제하지 말고 최신 일정을 확인해 주세요.", 500);
        }
    }

    // Read-time baseline only; not an authorization credential, atomic CAS or durable idempotency key.
    public static string ExternalScheduleFingerprint(ExternalSchedule item) => Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(
        System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { item.Id, item.EmployeeId, item.StartDate, item.EndDate, item.Category, item.Memo, item.CreatedByEmployeeId, item.UpdatedByEmployeeId, createdAtTicks = item.CreatedAtUtc.Ticks, updatedAtTicks = item.UpdatedAtUtc.Ticks })));

    private async Task LoadPageAsync(DateOnly? preferredDate)
    {
        var today = AppTime.Today;
        CurrentEmployee = await current.GetRequiredAsync();

        if (CurrentEmployee.IsAdmin && ViewEmployeeId.HasValue)
        {
            Employee = await db.Employees.SingleOrDefaultAsync(x => x.Id == ViewEmployeeId.Value)
                ?? CurrentEmployee;
            if (!Employee.IsActive || Employee.IsCompanyMaster || Employee.IsSharedAccount)
                Employee = CurrentEmployee;
            if (Employee.Id == CurrentEmployee.Id)
                ViewEmployeeId = null;
        }
        else
        {
            Employee = CurrentEmployee;
            ViewEmployeeId = null;
        }

        CalendarView = string.Equals(CalendarView, "year", StringComparison.OrdinalIgnoreCase) ? "year" : "month";
        await ApplyCalendarPreferencesAsync();

        ViewableEmployees = CurrentEmployee.IsAdmin
            ? await db.Employees.Where(x => x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster && (CurrentEmployee.IsAdmin || !x.IsPrivate)).OrderBy(x => x.Name).ThenBy(x => x.Email).ToListAsync()
            : new List<Employee> { CurrentEmployee };
        ExternalScheduleEmployees = CurrentEmployee.IsAdmin
            ? await db.Employees.Where(x => !x.IsSharedAccount && !x.IsCompanyMaster && (CurrentEmployee.IsAdmin || !x.IsPrivate)).OrderByDescending(x => x.IsActive).ThenBy(x => x.Name).ThenBy(x => x.Email).ToListAsync()
            : [];

        var currentYearSummary = await calc.GetCurrentLeaveYearSummaryAsync(Employee.Id, today);
        var advanceOutstanding = await calc.GetOutstandingAdvanceBreakdownAsync(Employee.Id);
        OutstandingAdvanceDays = advanceOutstanding.Total;
        OutstandingMonthlyAdvanceDays = advanceOutstanding.Monthly;
        OutstandingAnnualAdvanceDays = advanceOutstanding.Annual;
        CompletedYears = LeaveCalculationService.CompletedYears(Employee.HireDate, today);
        NextAnnualDays = LeaveCalculationService.AnnualDays(CompletedYears + 1);
        CurrentYearGrantedDays = currentYearSummary.Granted;
        CurrentYearUsedDays = currentYearSummary.Used;
        CurrentYearPendingDays = currentYearSummary.Pending;
        Balance = new LeaveBalance(currentYearSummary.Granted, currentYearSummary.Used + currentYearSummary.Pending, currentYearSummary.Settled, currentYearSummary.Available);
        BirthdayLeave = await BirthdayLeavePolicy.GetAvailabilityAsync(db, Employee, today);

        var renewalDate = leaveDates.GetNextRenewalDate(Employee, today);
        NextRenewalLabel = leaveDates.GetNextRenewalLabel(Employee, today);
        var dday = renewalDate.DayNumber - today.DayNumber;
        NextRenewalDday = dday == 0 ? "D-Day" : $"D-{dday:000}";

        RequestLimit = NormalizeRequestLimit(RequestLimit);
        RequestPage = Math.Max(1, RequestPage);
        var requestQuery = db.LeaveRequests.Include(x => x.Dates)
            .Where(x => x.EmployeeId == Employee.Id)
            .OrderByDescending(x => x.RequestedAtUtc);
        RequestTotalCount = await requestQuery.CountAsync();
        var requestTotalPages = Math.Max(1, (int)Math.Ceiling(RequestTotalCount / (double)RequestLimit));
        RequestPage = Math.Clamp(RequestPage, 1, requestTotalPages);
        Requests = await requestQuery
            .Skip((RequestPage - 1) * RequestLimit)
            .Take(RequestLimit)
            .ToListAsync();

        if (Year < 2000 || Year > 2100) Year = preferredDate?.Year ?? today.Year;
        if (Month < 1 || Month > 12) Month = preferredDate?.Month ?? today.Month;

        if (Input.StartDate == default)
        {
            Input.StartDate = preferredDate ?? today;
            Input.EndDate = preferredDate ?? today;
            Input.Portion = LeaveDayPortion.FullDay;
        }

        if (IsYearView)
            await LoadYearCalendarAsync();
        else
            await LoadMonthCalendarAsync();
    }

    private async Task ApplyCalendarPreferencesAsync()
    {
        if (SaveCalendarPreference)
        {
            if (CurrentEmployee.IsAdmin && !IsAdminPreview)
            {
                CurrentEmployee.CalendarSelfOnly = SelfOnly;
                ShowOthers = false;
                await db.SaveChangesAsync();
                return;
            }

            if (!CurrentEmployee.IsAdmin)
            {
                CurrentEmployee.CalendarShowApprovedOthers = ShowOthers;
                SelfOnly = false;
                await db.SaveChangesAsync();
                return;
            }
        }

        if (CurrentEmployee.IsAdmin)
        {
            SelfOnly = IsAdminPreview || CurrentEmployee.CalendarSelfOnly;
            ShowOthers = false;
        }
        else
        {
            SelfOnly = false;
            ShowOthers = CurrentEmployee.CalendarShowApprovedOthers;
        }
    }

    private async Task<List<Employee>> GetVisibleEmployeesAsync()
    {
        if (IsAdminPreview)
            return Employee.IsCompanyMaster || (!CurrentEmployee.IsAdmin && Employee.IsPrivate) ? [] : [Employee];
        if (CurrentEmployee.IsAdmin)
            return SelfOnly ? (Employee.IsCompanyMaster ? [] : [Employee]) : await db.Employees.Where(x => x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster && (CurrentEmployee.IsAdmin || !x.IsPrivate)).ToListAsync();
        return ShowOthers ? await db.Employees.Where(x => x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster && (CurrentEmployee.IsAdmin || !x.IsPrivate)).ToListAsync() : (Employee.IsCompanyMaster || Employee.IsPrivate ? [] : [Employee]);
    }

    private async Task<List<Employee>> GetVisibleBirthdayEmployeesAsync()
    {
        if (!CurrentEmployee.IsAdmin || IsAdminPreview || SelfOnly)
            return Employee.BirthDate.HasValue ? [Employee] : [];

        var employees = await db.Employees
            .AsNoTracking()
            .Where(x => x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster && x.BirthDate != null)
            .OrderBy(x => x.Name)
            .ThenBy(x => x.Email)
            .ToListAsync();

        // 회사 마스터도 자기 생일은 항상 볼 수 있어야 한다.
        if (CurrentEmployee.BirthDate.HasValue && employees.All(x => x.Id != CurrentEmployee.Id))
            employees.Add(CurrentEmployee);
        return employees;
    }

    private IQueryable<LeaveRequestDate> ApplyCalendarVisibility(IQueryable<LeaveRequestDate> query)
    {
        if (CurrentEmployee.IsAdmin || IsAdminPreview)
        {
            return query.Where(x =>
                x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
                x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested);
        }

        if (CanEmployeeViewOthers)
        {
            return query.Where(x =>
                (x.LeaveRequest.EmployeeId == Employee.Id &&
                    (x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
                     x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                     x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested)) ||
                (x.LeaveRequest.EmployeeId != Employee.Id && x.LeaveRequest.Status == LeaveRequestStatus.Approved));
        }

        return query.Where(x =>
            x.LeaveRequest.EmployeeId == Employee.Id &&
            (x.LeaveRequest.Status == LeaveRequestStatus.Pending ||
             x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
             x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested));
    }

    private async Task LoadMonthCalendarAsync()
    {
        var first = new DateOnly(Year, Month, 1);
        var last = first.AddMonths(1).AddDays(-1);
        var start = first.AddDays(-((int)first.DayOfWeek));
        var end = last.AddDays(6 - (int)last.DayOfWeek);

        var visibleEmployees = await GetVisibleEmployeesAsync();
        var visibleEmployeeIds = visibleEmployees.Select(x => x.Id).ToHashSet();
        var birthdayEmployees = await GetVisibleBirthdayEmployeesAsync();
        var milestoneRead = await scheduleMilestones.ReadAsync(CurrentEmployee.CompanyUserId, start, end, HttpContext.RequestAborted);
        ScheduleMilestonesAvailable = milestoneRead.Available;

        var requestDatesQuery = db.LeaveRequestDates
            .Include(x => x.LeaveRequest).ThenInclude(x => x.Employee)
            .Include(x => x.LeaveRequest).ThenInclude(x => x.Dates)
            .Where(x => x.Date >= start && x.Date <= end &&
                visibleEmployeeIds.Contains(x.LeaveRequest.EmployeeId));
        requestDatesQuery = ApplyCalendarVisibility(requestDatesQuery);

        var requestDates = await requestDatesQuery
            .OrderBy(x => x.Date).ThenBy(x => x.LeaveRequest.Employee.Name)
            .ToListAsync();

        var externalSchedules = new List<ExternalSchedule>();
        if (CurrentEmployee.IsAdmin)
        {
            var scheduleEmployeeIds = GetVisibleExternalScheduleEmployeeIds();
            externalSchedules = await db.ExternalSchedules
                .AsNoTracking()
                .Include(x => x.Employee)
                .Where(x => x.StartDate <= end && x.EndDate >= start && scheduleEmployeeIds.Contains(x.EmployeeId))
                .OrderBy(x => x.StartDate)
                .ThenBy(x => x.Employee!.Name)
                .ToListAsync();
        }

        var holidays = await db.Holidays
            .Where(x => x.Date >= first && x.Date <= last)
            .OrderBy(x => x.Date)
            .ToListAsync();

        var renewalEmployees = CurrentEmployee.IsAdmin && !IsAdminPreview && !SelfOnly
            ? visibleEmployees
            : visibleEmployees.Where(x => x.Id == Employee.Id).ToList();
        var renewals = renewalEmployees
            .SelectMany(e => GetRenewalOccurrences(e, first, last))
            .ToList();

        var allDays = new List<CalendarDay>();
        for (var d = start; d <= end; d = d.AddDays(1))
        {
            allDays.Add(new CalendarDay
            {
                Date = d,
                IsCurrentMonth = d.Month == Month,
                IsToday = d == AppTime.Today,
                Items = requestDates.Where(x => x.Date == d).Select(x => CalendarItem.FromRequestDate(x, CurrentEmployee.IsAdmin || x.LeaveRequest.EmployeeId == CurrentEmployee.Id)).ToList(),
                ExternalSchedules = externalSchedules.Where(x => x.StartDate <= d && x.EndDate >= d).Select(CalendarExternalSchedule.FromEntity).ToList(),
                ScheduleMilestones = milestoneRead.Items.Where(x => x.Date == d).ToList(),
                Renewals = renewals.Where(x => x.Date == d).Select(x => new CalendarRenewal(x.Employee.Id, x.Employee.Name, x.Employee.Id == Employee.Id, x.Kind)).ToList(),
                Birthdays = birthdayEmployees
                    .Where(x => x.BirthDate.HasValue && BirthdayCalendarDate.InYear(x.BirthDate.Value, d.Year) == d)
                    .Select(x => new CalendarBirthday(x.Id, x.Name, x.Id == CurrentEmployee.Id))
                    .ToList(),
                Holidays = holidays.Where(x => x.Date == d).Select(x => new CalendarHoliday(x.Name)).ToList(),
                IsHoliday = holidays.Any(x => x.Date == d)
            });
        }
        CalendarWeeks = allDays.Chunk(7).Select(x => new CalendarWeek(x.ToList())).ToList();
    }

    private async Task LoadYearCalendarAsync()
    {
        var today = AppTime.Today;
        var first = new DateOnly(Year, 1, 1);
        var last = new DateOnly(Year, 12, 31);

        var ownDates = await db.LeaveRequestDates
            .AsNoTracking()
            .Include(x => x.LeaveRequest)
            .Where(x => x.LeaveRequest.EmployeeId == Employee.Id &&
                x.Date >= first && x.Date <= last &&
                (x.LeaveRequest.Status == LeaveRequestStatus.Approved ||
                 x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested ||
                 x.LeaveRequest.Status == LeaveRequestStatus.Pending))
            .ToListAsync();

        CalendarYearUsedDays = ownDates
            .Where(x => x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested)
            .Sum(x => x.Days);
        CalendarYearPendingDays = ownDates
            .Where(x => x.LeaveRequest.Status == LeaveRequestStatus.Pending)
            .Sum(x => x.Days);

        var visibleEmployees = await GetVisibleEmployeesAsync();
        var visibleEmployeeIds = visibleEmployees.Select(x => x.Id).ToHashSet();
        var birthdayEmployees = await GetVisibleBirthdayEmployeesAsync();
        var milestoneRead = await scheduleMilestones.ReadAsync(CurrentEmployee.CompanyUserId, first, last, HttpContext.RequestAborted);
        ScheduleMilestonesAvailable = milestoneRead.Available;
        var requestDatesQuery = db.LeaveRequestDates
            .AsNoTracking()
            .Include(x => x.LeaveRequest).ThenInclude(x => x.Employee)
            .Where(x => x.Date >= first && x.Date <= last &&
                visibleEmployeeIds.Contains(x.LeaveRequest.EmployeeId));
        requestDatesQuery = ApplyCalendarVisibility(requestDatesQuery);

        var requestDates = await requestDatesQuery
            .OrderBy(x => x.Date)
            .ThenBy(x => x.LeaveRequest.Employee.Name)
            .ToListAsync();
        var holidays = await db.Holidays
            .AsNoTracking()
            .Where(x => x.Date >= first && x.Date <= last)
            .OrderBy(x => x.Date)
            .ToListAsync();
        var externalSchedules = new List<ExternalSchedule>();
        if (CurrentEmployee.IsAdmin)
        {
            var scheduleEmployeeIds = GetVisibleExternalScheduleEmployeeIds();
            externalSchedules = await db.ExternalSchedules
                .AsNoTracking()
                .Include(x => x.Employee)
                .Where(x => x.StartDate <= last && x.EndDate >= first && scheduleEmployeeIds.Contains(x.EmployeeId))
                .OrderBy(x => x.StartDate)
                .ThenBy(x => x.Employee!.Name)
                .ToListAsync();
        }

        YearCalendarMonths = Enumerable.Range(1, 12)
            .Select(month => BuildYearMonth(month, ownDates, requestDates, holidays, externalSchedules, birthdayEmployees, milestoneRead.Items, today))
            .ToList();
    }

    private IndexYearCalendarMonth BuildYearMonth(
        int month,
        IReadOnlyCollection<LeaveRequestDate> ownDates,
        IReadOnlyCollection<LeaveRequestDate> requestDates,
        IReadOnlyCollection<Holiday> holidays,
        IReadOnlyCollection<ExternalSchedule> externalSchedules,
        IReadOnlyCollection<Employee> birthdayEmployees,
        IReadOnlyCollection<CalendarScheduleMilestone> scheduleMilestones,
        DateOnly today)
    {
        var first = new DateOnly(Year, month, 1);
        var cells = new List<IndexYearCalendarDay?>();

        for (var i = 0; i < (int)first.DayOfWeek; i++)
            cells.Add(null);

        for (var day = 1; day <= DateTime.DaysInMonth(Year, month); day++)
        {
            var date = new DateOnly(Year, month, day);
            cells.Add(new IndexYearCalendarDay
            {
                Date = date,
                IsToday = date == today,
                HolidayNames = holidays.Where(x => x.Date == date).Select(x => x.Name).ToList(),
                ExternalSchedules = externalSchedules.Where(x => x.StartDate <= date && x.EndDate >= date).Select(CalendarExternalSchedule.FromEntity).ToList(),
                ScheduleMilestones = scheduleMilestones.Where(x => x.Date == date).ToList(),
                Birthdays = birthdayEmployees
                    .Where(x => x.BirthDate.HasValue && BirthdayCalendarDate.InYear(x.BirthDate.Value, date.Year) == date)
                    .Select(x => new CalendarBirthday(x.Id, x.Name, x.Id == CurrentEmployee.Id))
                    .ToList(),
                Items = requestDates
                    .Where(x => x.Date == date)
                    .Select(x => IndexYearCalendarItem.FromRequestDate(x, Employee.Id, CurrentEmployee.IsAdmin || x.LeaveRequest.EmployeeId == CurrentEmployee.Id))
                    .ToList()
            });
        }

        while (cells.Count < 42)
            cells.Add(null);

        var monthlyOwnDates = ownDates.Where(x => x.Date.Month == month).ToList();
        return new IndexYearCalendarMonth
        {
            Month = month,
            UsedDays = monthlyOwnDates
                .Where(x => x.LeaveRequest.Status == LeaveRequestStatus.Approved || x.LeaveRequest.Status == LeaveRequestStatus.CancelRequested)
                .Sum(x => x.Days),
            PendingDays = monthlyOwnDates
                .Where(x => x.LeaveRequest.Status == LeaveRequestStatus.Pending)
                .Sum(x => x.Days),
            Weeks = cells.Chunk(7).Select(x => x.ToList()).ToList()
        };
    }

    private IEnumerable<(Employee Employee, DateOnly Date, string Kind)> GetRenewalOccurrences(Employee employee, DateOnly start, DateOnly end)
    {
        var result = new List<(Employee Employee, DateOnly Date, string Kind)>();

        for (var month = 1; month <= 11; month++)
        {
            var monthly = employee.HireDate.AddMonths(month);
            if (monthly >= start && monthly <= end)
                result.Add((employee, monthly, "월차"));
        }

        for (var year = Math.Max(1, start.Year - employee.HireDate.Year - 1); year <= end.Year - employee.HireDate.Year + 1; year++)
        {
            if (year < 1) continue;
            var annual = employee.HireDate.AddYears(year);
            if (annual >= start && annual <= end)
                result.Add((employee, annual, "연차"));
        }

        return result;
    }

    public static int NormalizeRequestLimit(int value) => value switch
    {
        10 or 20 or 50 or 100 => value,
        _ => 10
    };

    public string RequestLimitSelected(int value) => RequestLimit == value ? "selected" : "";
    public string FormatDays(decimal days) => days % 1 == 0 ? ((int)days).ToString() : days.ToString("0.0");

    public string AdvanceKindLabel(LeaveRequest r)
    {
        if (!r.IsAdvance) return "";
        var monthly = r.MonthlyAdvanceDays;
        var annual = r.AnnualAdvanceDays;
        if (monthly <= 0m && annual <= 0m) annual = r.AdvanceDays;
        if (monthly > 0m && annual > 0m) return "월차/연차 가불";
        if (monthly > 0m) return "월차 가불";
        return "연차 가불";
    }

    public string AdvanceBreakdownLabel(LeaveRequest r)
    {
        if (!r.IsAdvance) return "";
        var monthly = r.MonthlyAdvanceDays;
        var annual = r.AnnualAdvanceDays;
        if (monthly <= 0m && annual <= 0m) annual = r.AdvanceDays;
        var parts = new List<string>();
        if (monthly > 0m) parts.Add($"월차 {monthly:0.#}일");
        if (annual > 0m) parts.Add($"연차 {annual:0.#}일");
        return string.Join(" / ", parts);
    }

    public string StatusName(LeaveRequestStatus s) => s switch { LeaveRequestStatus.Pending => "승인 대기", LeaveRequestStatus.Approved => "승인", LeaveRequestStatus.Rejected => "반려", LeaveRequestStatus.CancelRequested => "취소 승인 대기", LeaveRequestStatus.Cancelled => "취소", _ => s.ToString() };
    public string PortionName(LeaveDayPortion p) => p switch { LeaveDayPortion.FullDay => "연차", LeaveDayPortion.Morning => "오전반차", LeaveDayPortion.Afternoon => "오후반차", LeaveDayPortion.특수휴가 => "특수 휴가", LeaveDayPortion.기타 => "기타", LeaveDayPortion.Birthday => "🎂 생일연차", _ => "" };
    public string Kst(DateTime utc) => AppTime.ToKst(utc).ToString("yyyy-MM-dd HH:mm");
    public bool CanRequestCancel(LeaveRequest r)
    {
        if (IsAdminPreview) return false;
        if (r.Status == LeaveRequestStatus.Pending) return true;
        if (r.Status != LeaveRequestStatus.Approved) return false;
        return !r.Dates.Any(x => x.Date < AppTime.Today);
    }

    public string StatusClass(LeaveRequestStatus s) => s switch { LeaveRequestStatus.Pending => "pending", LeaveRequestStatus.Approved => "approved", LeaveRequestStatus.CancelRequested => "cancel", LeaveRequestStatus.Rejected => "rejected", LeaveRequestStatus.Cancelled => "cancelled", _ => "" };
    public string StatusTone(LeaveRequestStatus s) => s switch { LeaveRequestStatus.Pending => "info", LeaveRequestStatus.Approved => "success", LeaveRequestStatus.CancelRequested => "warning", LeaveRequestStatus.Rejected => "danger", _ => "neutral" };

    private HashSet<long> GetVisibleExternalScheduleEmployeeIds()
    {
        if (!CurrentEmployee.IsAdmin) return [];
        if (IsAdminPreview || SelfOnly) return ExternalScheduleEmployees.Where(x => x.Id == Employee.Id).Select(x => x.Id).ToHashSet();
        return ExternalScheduleEmployees.Select(x => x.Id).ToHashSet();
    }

    private object CalendarRouteValues(DateOnly date) => new
    {
        Year = date.Year,
        Month = date.Month,
        CalendarView = "month",
        SelfOnly,
        ShowOthers,
        ViewEmployeeId,
        RequestLimit,
        RequestPage
    };

    private static object ExternalScheduleSnapshot(ExternalSchedule item) => new
    {
        item.EmployeeId,
        item.StartDate,
        item.EndDate,
        item.Category,
        item.Memo
    };
}

public class ApplyInputModel
{
    [Required] public DateOnly StartDate { get; set; }
    [Required] public DateOnly EndDate { get; set; }
    public LeaveDayPortion Portion { get; set; } = LeaveDayPortion.FullDay;
    public string? Reason { get; set; }
    [Required, MaxLength(2000)] public string? WorkPlan { get; set; }
}

public record CalendarWeek(List<CalendarDay> Days);

public class CalendarDay
{
    public DateOnly Date { get; set; }
    public bool IsCurrentMonth { get; set; }
    public bool IsToday { get; set; }
    public bool IsHoliday { get; set; }
    public List<CalendarItem> Items { get; set; } = [];
    public List<CalendarExternalSchedule> ExternalSchedules { get; set; } = [];
    public List<CalendarScheduleMilestone> ScheduleMilestones { get; set; } = [];
    public List<CalendarRenewal> Renewals { get; set; } = [];
    public List<CalendarBirthday> Birthdays { get; set; } = [];
    public List<CalendarHoliday> Holidays { get; set; } = [];
}

public record CalendarRenewal(long EmployeeId, string EmployeeName, bool IsSelf, string Kind)
{
    public string Label => $"{EmployeeName} {Kind} 갱신";
}
public record CalendarHoliday(string Name);

public record CalendarBirthday(long EmployeeId, string EmployeeName, bool IsSelf)
{
    public string Label => $"{EmployeeName} 생일";
}

public record CalendarExternalSchedule(long Id, long EmployeeId, string EmployeeName, DateOnly StartDate, DateOnly EndDate, string Category, string Memo, string Snapshot)
{
    public static CalendarExternalSchedule FromEntity(ExternalSchedule item) =>
        new(item.Id, item.EmployeeId, item.Employee?.Name ?? $"직원 #{item.EmployeeId}", item.StartDate, item.EndDate, item.Category, item.Memo, IndexModel.ExternalScheduleFingerprint(item));
}

public record CalendarItem(long RequestId, long EmployeeId, string EmployeeName, LeaveDayPortion Portion, LeaveRequestStatus Status, bool CanSelfCancel, string? Reason, string? WorkPlan, bool IsAdvance, decimal AdvanceDays, string AdvanceLabel, string Snapshot, string DateLabel, string AdminTarget)
{
    public static CalendarItem FromRequestDate(LeaveRequestDate d, bool revealBirthdayLeave)
    {
        var hasPastDate = d.LeaveRequest.Dates.Any(x => x.Date < AppTime.Today);
        var canSelfCancel = d.LeaveRequest.Status is LeaveRequestStatus.Pending or LeaveRequestStatus.CancelRequested || !hasPastDate && d.LeaveRequest.Status == LeaveRequestStatus.Approved;
        var monthly = d.LeaveRequest.MonthlyAdvanceDays;
        var annual = d.LeaveRequest.AnnualAdvanceDays;
        if (d.LeaveRequest.IsAdvance && monthly <= 0m && annual <= 0m) annual = d.LeaveRequest.AdvanceDays;
        var parts = new List<string>();
        if (monthly > 0m) parts.Add($"월차 {monthly:0.#}일");
        if (annual > 0m) parts.Add($"연차 {annual:0.#}일");
        var advanceLabel = string.Join(" / ", parts);
        var request = d.LeaveRequest;
        var snapshot = LeaveRequestSnapshot.Compute(request);
        var adminTarget = System.Text.Json.JsonSerializer.Serialize(new {
            id = request.Id.ToString(CultureInfo.InvariantCulture), employeeId = request.EmployeeId.ToString(CultureInfo.InvariantCulture), employeeName = request.Employee.Name,
            snapshot, status = request.Status.ToString(), reason = request.Reason,
            calculatedDays = request.CalculatedDays.ToString("0.############################", CultureInfo.InvariantCulture),
            dates = request.Dates.OrderBy(x => x.Date).Select(x => new
            {
                date = x.Date.ToString("yyyy-MM-dd"),
                portion = x.Portion == LeaveDayPortion.Birthday && !revealBirthdayLeave
                    ? LeaveDayPortion.FullDay.ToString()
                    : x.Portion.ToString()
            })
        });
        var displayPortion = d.Portion == LeaveDayPortion.Birthday && !revealBirthdayLeave ? LeaveDayPortion.FullDay : d.Portion;
        return new(d.LeaveRequestId, request.EmployeeId, request.Employee.Name, displayPortion, request.Status, canSelfCancel, request.Reason, request.WorkPlan, request.IsAdvance, request.AdvanceDays, advanceLabel, snapshot, SelfActionFormModel.DateLabel(request), adminTarget);
    }
}

public class IndexYearCalendarMonth
{
    public int Month { get; set; }
    public decimal UsedDays { get; set; }
    public decimal PendingDays { get; set; }
    public List<List<IndexYearCalendarDay?>> Weeks { get; set; } = [];
}

public class IndexYearCalendarDay
{
    public DateOnly Date { get; set; }
    public bool IsToday { get; set; }
    public List<string> HolidayNames { get; set; } = [];
    public List<IndexYearCalendarItem> Items { get; set; } = [];
    public List<CalendarExternalSchedule> ExternalSchedules { get; set; } = [];
    public List<CalendarScheduleMilestone> ScheduleMilestones { get; set; } = [];
    public List<CalendarBirthday> Birthdays { get; set; } = [];
}

public record IndexYearCalendarItem(string EmployeeName, LeaveDayPortion Portion, LeaveRequestStatus Status, bool IsSelf, long EmployeeId)
{
    public static IndexYearCalendarItem FromRequestDate(LeaveRequestDate date, long selectedEmployeeId, bool revealBirthdayLeave) =>
        new(date.LeaveRequest.Employee.Name, date.Portion == LeaveDayPortion.Birthday && !revealBirthdayLeave ? LeaveDayPortion.FullDay : date.Portion, date.LeaveRequest.Status, date.LeaveRequest.EmployeeId == selectedEmployeeId, date.LeaveRequest.EmployeeId);
}

public class AdminForceLeaveInputModel
{
    [Required] public long EmployeeId { get; set; }
    [Required] public DateOnly Date { get; set; }
    public LeaveDayPortion Portion { get; set; } = LeaveDayPortion.FullDay;
    public string? Reason { get; set; }
}

public class ExternalScheduleInputModel
{
    public long? Id { get; set; }
    [Required] public long EmployeeId { get; set; }
    [Required] public DateOnly StartDate { get; set; }
    [Required] public DateOnly EndDate { get; set; }
    [Required, MaxLength(50)] public string Category { get; set; } = "외근";
    [Required, MaxLength(500)] public string Memo { get; set; } = "";
}
