using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Globalization;

namespace CompanyPortal.Pages.Admin;
[RequestSizeLimit(1048576)]
[RequestFormLimits(MultipartBodyLengthLimit = 1048576)]
public class OrganizationModel(AppDbContext db, CurrentUserService currentUser, OrganizationService organization, ILogger<OrganizationModel> logger) : PageModel
{
    const string MediaType = "application/vnd.company.workspace-form+json";
    [BindProperty(SupportsGet = true)] public string Tab { get; set; } = "departments";
    [BindProperty] public EditForm Form { get; set; } = new();
    [BindProperty] public string? ExpectedUserId { get; set; }
    [BindProperty] public string? ProjectId { get; set; }
    [BindProperty] public string? ExpectedVersion { get; set; }
    [BindProperty] public string? Operation { get; set; }
    [BindProperty] public IFormFile? Photo { get; set; }
    public string? IconError { get; private set; }
    public bool IconWriteLocked { get; private set; }
    public bool WriteLocked { get; private set; }
    public string? PostedDraft { get; private set; }
    public List<Department> Departments { get; private set; } = [];
    public List<CompanyProject> Projects { get; private set; } = [];
    public List<CompanyUser> Users { get; private set; } = [];
    public List<ProjectMembership> Memberships { get; private set; } = [];
    public List<DepartmentLead> Leads { get; private set; } = [];
    public CompanyUser Actor { get; private set; } = null!;
    public string? Error { get; private set; }
    public bool CanManage(CompanyUser user) => Actor.IsMaster || !PermissionCatalog.IsAdministrator(user);
    public async Task OnGetAsync(long? id)
    {
        Response.Headers.CacheControl = "no-store";
        await Load();
        ExpectedUserId = Actor.Id.ToString(CultureInfo.InvariantCulture);
        if (Request.Query.TryGetValue("id", out var queryId) && (queryId.Count != 1 || !long.TryParse(queryId[0], NumberStyles.None, CultureInfo.InvariantCulture, out var parsedId) || parsedId <= 0))
        { Error = "관리 대상 주소를 확인해 주세요."; WriteLocked = true; Response.StatusCode = 400; return; }
        if (Tab == "projects" && id.HasValue)
        {
            var p = Projects.SingleOrDefault(x => x.Id == id); if (p is null) { Error = "프로젝트를 찾을 수 없습니다."; WriteLocked = true; Response.StatusCode = 404; return; }
            Form = new() { Id = p.Id, Name = p.Name, Color = p.Color, IsPrivate = p.IsPrivate, Archived = p.Archived, Version = p.Version, EmployeeIds = Memberships.Where(x => x.ProjectId == p.Id).Select(x => x.EmployeeId).ToArray() };
        }
        else if (id.HasValue)
        {
            var d = Departments.SingleOrDefault(x => x.Id == id); if (d is null) { Error = "부서를 찾을 수 없습니다."; WriteLocked = true; Response.StatusCode = 404; return; }
            Form = new() { Id = d.Id, Name = d.Name, HandlesScheduleFeedback = d.HandlesScheduleFeedback, Archived = d.Archived, Version = d.Version, EmployeeIds = Leads.Where(x => x.DepartmentId == d.Id).Select(x => x.EmployeeId).ToArray() };
        }
        await LoadIcon();
    }
    async Task LoadIcon()
    {
        if (Tab != "projects" || !Form.Id.HasValue) return;
        ProjectId = Form.Id.Value.ToString(CultureInfo.InvariantCulture);
        ExpectedVersion = await WorkspaceImageStore.VersionAsync(db, WorkspaceImageKind.Project, Form.Id.Value) ?? "";
    }
    public async Task<IActionResult> OnPostIconAsync()
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(v => v.Trim() == MediaType);
        var actor = await currentUser.GetRequiredAsync(); OrganizationService.RequireAdmin(actor);
        var owner = actor.Id.ToString(CultureInfo.InvariantCulture);
        var validId = long.TryParse(ProjectId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) && id > 0 && ProjectId == id.ToString(CultureInfo.InvariantCulture);
        var expected = ExpectedVersion ?? "";
        async Task<IActionResult> Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = MediaType };
            ModelState.Clear(); Tab = "projects"; await OnGetAsync(validId ? id : null);
            ExpectedVersion = expected; IconError = message + " 파일은 다시 선택해야 합니다. 현재 아이콘은 새 화면에서 확인해 주세요.";
            IconWriteLocked = outcome != "invalid"; Response.StatusCode = status; return Page();
        }
        if (ExpectedUserId != owner || Request.Form["ExpectedUserId"].Count != 1)
            return await Failure("conflict", "로그인 계정이 바뀌었습니다. 현재 계정으로 화면을 다시 열어 주세요.", 409);
        if (!validId || new[] { "ProjectId", "ExpectedVersion", "Operation" }.Any(key => Request.Form[key].Count != 1)
            || !System.Text.RegularExpressions.Regex.IsMatch(expected, "\\A(?:[a-f0-9]{32})?\\z") || Operation is not ("save" or "remove"))
            return await Failure("invalid", "프로젝트와 이미지 작업·기준 버전을 확인해 주세요.", 422);
        if (!await db.Projects.AnyAsync(p => p.Id == id)) return await Failure("conflict", "프로젝트가 없습니다. 최신 목록을 확인해 주세요.", 409);
        byte[]? image = null;
        if (Operation == "save") {
            if (Photo is null || Photo.Length > 524288 || Request.Form.Files.Count != 1) return await Failure("invalid", "저장할 256×256 PNG 아이콘을 선택해 주세요.", 422);
            try { using var stream = Photo.OpenReadStream(); image = await AvatarStore.ReadPngAsync(stream, HttpContext.RequestAborted); }
            catch (OperationCanceledException) { throw; }
            catch { return await Failure("invalid", "올바른 256×256 PNG 아이콘을 선택해 주세요.", 422); }
        }
        try {
            var version = await WorkspaceImageStore.ApplyAsync(db, WorkspaceImageKind.Project, id, image, expected);
            if (!enhanced) return RedirectToPage(new { tab = "projects", id });
            return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = "프로젝트 아이콘을 변경했습니다.",
                data = new { operation = Operation, userId = owner, projectId = ProjectId, previousVersion = expected, version = version ?? "", iconUrl = version is null ? null : $"/api/workspace/project-icon/{id}?v={version}" } }) { ContentType = MediaType };
        }
        catch (DbUpdateConcurrencyException) { return await Failure("conflict", "다른 곳에서 아이콘이 변경되었습니다. 현재 아이콘을 다시 확인해 주세요.", 409); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { logger.LogError(ex, "Project icon form write failed"); return await Failure("unknown", "아이콘 저장 결과를 확인하지 못했습니다. 서버에는 반영되었을 수 있으며 자동 재전송하지 않습니다.", 500); }
    }
    public async Task<IActionResult> OnPostAsync()
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(v => v.Trim() == MediaType);
        async Task<IActionResult> Failure(string outcome, string message, int status)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message }) { StatusCode = status, ContentType = MediaType };
            Error = message; WriteLocked = outcome != "invalid" || !ModelState.IsValid;
            // Keep the posted Form/ModelState and original version, never load a new edit baseline.
            PostedDraft = System.Text.Json.JsonSerializer.Serialize(new[] { "Tab", "Form.Id", "Form.Version", "Form.Name", "Form.Color", "Form.Archived", "Form.IsPrivate", "Form.HandlesScheduleFeedback", "Form.EmployeeIds" }
                .ToDictionary(key => key, key => Request.Form[key].ToArray()), new System.Text.Json.JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            db.ChangeTracker.Clear(); await Load(); await LoadIcon();
            var visible = Users.Where(u => !u.IsSharedAccount && !u.IsMaster && (Tab == "projects" ? u.IsActive || Form.EmployeeIds.Contains(u.Id) : u.DepartmentId == Form.Id && OrganizationService.EligibleLead(u))).Select(u => u.Id).ToHashSet();
            if (Form.EmployeeIds.Any(id => !visible.Contains(id))) WriteLocked = true;
            Response.StatusCode = status; return Page();
        }
        var actor = await currentUser.GetRequiredAsync();
        var actorId = actor.Id.ToString(CultureInfo.InvariantCulture);
        if (ExpectedUserId != actorId || Request.Form["ExpectedUserId"].Count != 1)
            return await Failure("conflict", "로그인 계정이 바뀌었습니다. 입력은 유지한 채 현재 계정으로 관리 화면을 다시 열어 주세요.", 409);
        try
        {
            if (!ModelState.IsValid || new[] { "Tab", "Form.Id", "Form.Version", "Form.Name" }.Any(key => Request.Form[key].Count != 1)
                || Tab is not ("projects" or "departments") || Form.Id is <= 0 || Form.Version < 0 || (!Form.Id.HasValue && Form.Version != 0))
                return await Failure("invalid", "관리 항목과 입력 값을 확인해 주세요.", 422);
            long id; int version;
            if (Tab == "projects") {
                var saved = await organization.SaveProjectAsync(actor, Form.Id, Form.Name, Form.Color, Form.Archived, Form.Version, Form.EmployeeIds, Form.IsPrivate);
                id = saved.Id; version = saved.Version;
            } else {
                var saved = await organization.SaveDepartmentAsync(actor, Form.Id, Form.Name, Form.Archived, Form.Version, Form.EmployeeIds, Form.HandlesScheduleFeedback);
                id = saved.Id; version = saved.Version;
            }
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome = "saved", message = "조직 정보를 저장했습니다.",
                data = new { tab = Tab, userId = actorId, id = id.ToString(CultureInfo.InvariantCulture), version = version.ToString(CultureInfo.InvariantCulture),
                    previousId = Form.Id?.ToString(CultureInfo.InvariantCulture) ?? "", previousVersion = Form.Version.ToString(CultureInfo.InvariantCulture) } }) { ContentType = MediaType };
            return RedirectToPage(new { tab = Tab });
        }
        catch (DbUpdateConcurrencyException) { return await Failure("conflict", "다른 곳에서 변경되었습니다. 최신 정보를 확인한 뒤 다시 저장해 주세요.", 409); }
        catch (OrganizationValidationException ex) { return await Failure("invalid", ex.Message, 422); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { logger.LogError(ex, "Organization form write failed"); return await Failure("unknown", "저장 결과를 확인하지 못했습니다. 서버에 반영되었을 수 있으므로 새 화면에서 최신 정보를 확인해 주세요. 자동으로 다시 저장하지 않습니다.", 500); }
    }
    async Task Load()
    {
        Actor = await currentUser.GetRequiredAsync(); OrganizationService.RequireAdmin(Actor);
        if (Tab != "projects") Tab = "departments";
        Departments = await db.Departments.AsNoTracking().OrderBy(x => x.Name).ToListAsync();
        Projects = await db.Projects.AsNoTracking().OrderBy(x => x.Name).ToListAsync();
        Users = await db.Users.AsNoTracking().OrderBy(x => x.Name).ToListAsync();
        Memberships = await db.ProjectMemberships.AsNoTracking().ToListAsync();
        Leads = await db.DepartmentLeads.AsNoTracking().ToListAsync();
    }
    public class EditForm
    {
        public long? Id { get; set; }
        public string Name { get; set; } = "";
        public string Color { get; set; } = "#3b65de";
        public bool Archived { get; set; }
        public bool IsPrivate { get; set; }
        public bool HandlesScheduleFeedback { get; set; }
        public int Version { get; set; }
        public long[] EmployeeIds { get; set; } = [];
    }
}
