using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Services;
using CompanyPortal.Workspace;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace CompanyPortal.Pages.Admin;

public class UsersModel(AppDbContext db, CurrentUserService currentUser, OrganizationService organization) : PageModel
{
    private const string FormMediaType = "application/vnd.company.workspace-form+json";
    private bool WantsFormResult => Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == FormMediaType);
    private IActionResult FormResult(string outcome, string message, int status, object? data = null)
    {
        Response.Headers.CacheControl = "no-store";
        return new JsonResult(new { protocol = "workspace-form-v1", outcome, message, data }) { StatusCode = status, ContentType = FormMediaType };
    }
    private sealed class AccountConflictException(string message) : Exception(message);

    // Convert the shared field contract to native form values; long IDs and version ticks stay strings.
    private static Dictionary<string, string[]> FormValues(AccountInput input) => AccountFields.All.ToDictionary(f => f.Key, f =>
        typeof(AccountInput).GetProperty(f.Key)!.GetValue(input) switch
        {
            null => new[] { "" },
            string[] values => values,
            long[] values => values.Select(x => x.ToString(System.Globalization.CultureInfo.InvariantCulture)).ToArray(),
            bool value => new[] { value ? "true" : "false" },
            DateOnly date => new[] { date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) },
            var value => new[] { Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "" }
        });
    public List<Department> Departments { get; private set; } = [];
    public List<CompanyProject> Projects { get; private set; } = [];
    public List<ProjectMembership> Memberships { get; private set; } = [];
    public string ProjectNames(long employeeId) => string.Join(" · ", Projects.Where(p => Memberships.Any(m => m.EmployeeId == employeeId && m.ProjectId == p.Id)).Select(p => p.Name));
    public List<CompanyUser> Users { get; private set; } = [];
    public sealed record PermissionOption(string AccessPermission, string Name, string Description);
    public IReadOnlyList<PermissionOption> ConfigurableSystems => CompanySystemCatalog.Configurable
        .Select(s => new PermissionOption(s.AccessPermission, s.Name, s.Description))
        .Append(new PermissionOption(PermissionCatalog.IapPublish, "상품 배포", "스토어 신규 등록·가격표 확정·상품별 일회성 변경 승인"))
        .ToArray();
    public bool ActorIsMaster { get; private set; }
    public string? Error { get; private set; }
    public AccountInput AddInput { get; private set; } = new();
    public bool HtmlSaveBlocked { get; private set; }
    public bool HtmlAddBlocked { get; private set; }
    public List<HtmlDraft> HtmlDrafts { get; } = [];
    public sealed record HtmlDraft(string Label, Dictionary<string, string[]> Fields, bool Restored, string? Version = null);
    public sealed record DraftBaseline(string Id, string UpdatedAtTicks, Dictionary<string, string[]> Fields);
    private readonly Dictionary<long, (BulkUserUpdateInput Input, DraftBaseline Baseline)> recoveredEdits = [];
    public AccountInput EditInputFor(CompanyUser user) => recoveredEdits.TryGetValue(user.Id, out var draft) ? draft.Input : InputFor(user);
    public long EditVersionFor(CompanyUser user) => recoveredEdits.TryGetValue(user.Id, out var draft) ? draft.Input.UpdatedAtTicks : user.UpdatedAtUtc.Ticks;
    public bool HasRecoveredDraft(long id) => recoveredEdits.ContainsKey(id);
    public string BaselineFor(CompanyUser user) => JsonSerializer.Serialize(recoveredEdits.TryGetValue(user.Id, out var draft) ? draft.Baseline :
        new DraftBaseline(user.Id.ToString(), user.UpdatedAtUtc.Ticks.ToString(), FormValues(InputFor(user))));
    private bool BaselineIncludes(AccountInput input, string field, long id) => recoveredEdits.Values.Any(d =>
        ReferenceEquals(d.Input, input) && d.Baseline.Fields[field].Contains(id.ToString()));
    public IEnumerable<Department> DepartmentChoicesFor(AccountInput input) => Departments.Where(d =>
        !d.Archived || d.Id == input.DepartmentId || BaselineIncludes(input, "DepartmentId", d.Id));
    public IEnumerable<CompanyProject> ProjectChoicesFor(AccountInput input) => Projects.Where(p =>
        !p.Archived || (input.ProjectIds ?? []).Contains(p.Id) || BaselineIncludes(input, "ProjectIds", p.Id));
    public static Dictionary<string, string[]> AddDefaults => FormValues(new AccountInput());
    public AccountInput InputFor(CompanyUser user) => new()
    {
        Name = user.Name, Email = user.Email, DepartmentId = user.DepartmentId,
        ProjectIds = Memberships.Where(m => m.EmployeeId == user.Id).Select(m => m.ProjectId).ToArray(),
        HireDate = user.HireDate, BirthDate = user.BirthDate?.ToString("MM-dd", System.Globalization.CultureInfo.InvariantCulture) ?? "", IsActive = user.IsActive, IsPrivate = user.IsPrivate,
        AccountType = user.IsSharedAccount ? "shared" : "employee",
        Role = user.IsMaster ? "master" : user.IsAdmin ? "admin" : "employee",
        Permissions = Selected(user).Where(permission => PermissionCatalog.Configurable.Contains(permission)).ToArray()
    };
    public int? SavedCount { get; private set; }
    public int EmployeeCount => Users.Count(x => !x.IsSharedAccount);
    public int SharedAccountCount => Users.Count(x => x.IsSharedAccount);
    public int ActiveUserCount => Users.Count(x => x.IsActive);
    public int AdministratorCount => Users.Count(PermissionCatalog.IsAdministrator);
    public int CsAccessCount => Users.Count(x => x.IsActive && PermissionCatalog.Has(x, PermissionCatalog.CsAccess));
    public int StatisticsAccessCount => Users.Count(x => x.IsActive && PermissionCatalog.Has(x, PermissionCatalog.StatisticsAccess));
    public int SheetAccessCount => Users.Count(x => x.IsActive && PermissionCatalog.Has(x, PermissionCatalog.SheetAccess));

    public async Task OnGetAsync(int? saved)
    {
        SavedCount = saved;
        await LoadAsync();
    }

    public async Task<IActionResult> OnGetReviewAsync(long[] ids)
    {
        Response.Headers.CacheControl = "no-store";
        if (!ModelState.IsValid || ids.Length == 0 || ids.Length > 500 || ids.Any(id => id <= 0) || ids.Distinct().Count() != ids.Length)
            return FormResult("invalid", "비교할 직원 목록을 확인해 주세요.", 422);
        var actor = await currentUser.GetRequiredAsync();
        await using var transaction = await db.Database.BeginTransactionAsync(HttpContext.RequestAborted);
        Users = await db.Users.OrderBy(user => user.Id).ToListAsync(HttpContext.RequestAborted);
        var targets = Users.Where(user => ids.Contains(user.Id)).ToArray();
        if (targets.Length != ids.Length) return FormResult("conflict", "삭제된 계정이 있습니다. 현재 초안을 보존한 채 최신 목록을 확인해 주세요.", 409);
        if (!actor.IsMaster && targets.Any(PermissionCatalog.IsAdministrator)) return FormResult("denied", "현재 권한으로 수정할 수 없는 계정이 있습니다.", 403);
        Memberships = await db.ProjectMemberships.ToListAsync(HttpContext.RequestAborted);
        var selectedDepartments = targets.Where(user => user.DepartmentId.HasValue).Select(user => user.DepartmentId!.Value).ToArray();
        var departments = await db.Departments.Where(d => !d.Archived || selectedDepartments.Contains(d.Id)).ToListAsync(HttpContext.RequestAborted);
        var selectedProjects = Memberships.Where(m => ids.Contains(m.EmployeeId)).Select(m => m.ProjectId).ToArray();
        var projects = await db.Projects.Where(p => !p.Archived || selectedProjects.Contains(p.Id)).ToListAsync(HttpContext.RequestAborted);
        var accounts = targets.Select(user => new { id = user.Id.ToString(), updatedAtTicks = user.UpdatedAtUtc.Ticks.ToString(), fields = FormValues(InputFor(user)) }).ToArray();
        return FormResult("snapshot", "현재 저장 내용을 조회했습니다.", 200, new { accounts, metrics = Metrics(),
            choices = new Dictionary<string, object> { ["DepartmentId"] = departments.Select(d => new { value = d.Id.ToString(), label = d.Name }),
                ["ProjectIds"] = projects.Select(p => new { value = p.Id.ToString(), label = p.Name + (p.IsPrivate ? " · 비공개" : "") + (p.Archived ? " · 보관됨" : "") }) } });
    }

    private Dictionary<string, int> Metrics() => new() { [nameof(EmployeeCount)] = EmployeeCount, [nameof(SharedAccountCount)] = SharedAccountCount,
        [nameof(ActiveUserCount)] = ActiveUserCount, [nameof(AdministratorCount)] = AdministratorCount,
        [nameof(CsAccessCount)] = CsAccessCount, [nameof(StatisticsAccessCount)] = StatisticsAccessCount, [nameof(SheetAccessCount)] = SheetAccessCount };

    public async Task<IActionResult> OnPostAddAsync([Bind(Prefix = "")] AccountInput input, bool isAdmin = false, bool isMaster = false)
    {
        AddInput = input;
        var committing = false;
        try
        {
            ValidateBinding();
            ApplyLegacyRole(input, isAdmin, isMaster);
            var actor = await currentUser.GetRequiredAsync();
            var change = Prepare(input, actor);
            if (await db.Users.AnyAsync(x => x.Email == change.Email))
                throw new InvalidOperationException("이미 등록된 이메일입니다.");
            var user = new CompanyUser();
            Apply(user, change);
            db.Users.Add(user);
            Dictionary<string, string[]>? savedFields = null;
            await SaveAndQueueLeaveProjectionAsync(user, !change.IsSharedAccount, change.DepartmentId, change.ProjectIds, async () =>
            {
                if (WantsFormResult)
                {
                    // Capture canonical membership values within the same transaction as the new account.
                    Memberships = await db.ProjectMemberships.Where(m => m.EmployeeId == user.Id).ToListAsync(HttpContext.RequestAborted);
                    savedFields = FormValues(InputFor(user));
                }
                committing = true;
            });
            if (WantsFormResult) return FormResult("saved", $"{user.Name} 계정을 등록했습니다. 아래 목록과 현황은 새로고침 후 반영됩니다.", 200,
                new { account = new { id = user.Id.ToString(), updatedAtTicks = user.UpdatedAtUtc.Ticks.ToString(), fields = savedFields } });
            return RedirectToPage();
        }
        catch (Exception ex)
        {
            db.ChangeTracker.Clear();
            if (WantsFormResult)
            {
                if (!committing && ex is InvalidOperationException) return FormResult("invalid", ex.Message, 422);
                HttpContext.RequestServices.GetRequiredService<ILogger<UsersModel>>().LogError(ex, "Account creation result could not be confirmed");
                return FormResult("unknown", "계정 등록 결과를 확인하지 못했습니다.", 500);
            }
            HtmlAddBlocked = committing || ex is not InvalidOperationException;
            Error = HtmlAddBlocked ? "계정 등록 결과를 확인하지 못했습니다. 반복 등록하지 말고 새 탭에서 등록 여부를 확인해 주세요." : ex.Message;
            Response.Headers.CacheControl = "no-store";
            await LoadAsync();
            var restored = !HtmlAddBlocked && ModelState.IsValid && CanRepresent(FormValues(input));
            HtmlDrafts.Add(new("새 계정 등록", PostedFields(""), restored));
            if (!restored) { AddInput = new(); HtmlAddBlocked = true; }
            return Page();
        }
    }

    public async Task<IActionResult> OnPostUpdateAsync(long id, [Bind(Prefix = "")] AccountInput input, bool isAdmin = false, bool isMaster = false)
    {
        try
        {
            ValidateBinding();
            ApplyLegacyRole(input, isAdmin, isMaster);
            var actor = await currentUser.GetRequiredAsync();
            var user = await db.Users.SingleAsync(x => x.Id == id);
            if (!actor.IsMaster && PermissionCatalog.IsAdministrator(user))
                throw new InvalidOperationException("관리자는 다른 관리자나 마스터 계정을 변경할 수 없습니다.");
            var change = Prepare(input, actor, user);
            if (user.Id == actor.Id && (!change.IsActive || !change.IsMaster))
                throw new InvalidOperationException("현재 로그인한 마스터 자신의 계정을 비활성화하거나 마스터 권한을 해제할 수 없습니다.");
            if (user.IsMaster && user.IsActive && (!change.IsActive || !change.IsMaster) &&
                !await db.Users.AnyAsync(x => x.Id != id && x.IsActive && x.IsMaster))
                throw new InvalidOperationException("마지막 활성 마스터 계정은 비활성화하거나 강등할 수 없습니다.");
            if (await db.Users.AnyAsync(x => x.Id != id && x.Email == change.Email))
                throw new InvalidOperationException("이미 등록된 이메일입니다.");
            var wasShared = user.IsSharedAccount;
            Apply(user, change);
            user.UpdatedAtUtc = DateTime.UtcNow;
            await SaveAndQueueLeaveProjectionAsync(user, !wasShared || !change.IsSharedAccount, change.DepartmentId, change.ProjectIds);
            return RedirectToPage();
        }
        catch (Exception)
        {
            db.ChangeTracker.Clear();
            Error = "단건 수정 결과를 확인해 주세요. 전송한 입력은 아래에 보존했습니다. 기존 목록의 버전을 임의로 갱신해 재전송하지 마세요.";
            Response.Headers.CacheControl = "no-store";
            await LoadAsync();
            HtmlDrafts.Add(new("단건 계정 수정 · #" + id, PostedFields(""), false));
            return Page();
        }
    }
    public async Task<IActionResult> OnPostBulkUpdateAsync(List<BulkUserUpdateInput>? updates)
    {
        var committing = false;
        try
        {
            var actor = await currentUser.GetRequiredAsync();
            ValidateBinding();
            if (updates is null || updates.Count == 0)
                throw new InvalidOperationException("저장할 직원 정보가 없습니다.");
            if (updates.Count > 500)
                throw new InvalidOperationException("한 번에 저장할 수 있는 직원 수를 초과했습니다.");
            if (updates.Select(x => x.Id).Distinct().Count() != updates.Count)
                throw new InvalidOperationException("중복된 직원 정보가 포함되어 있습니다.");

            await using var transaction = await db.Database.BeginTransactionAsync(HttpContext.RequestAborted);
            var allUsers = await db.Users.OrderBy(x => x.Id).ToListAsync(HttpContext.RequestAborted);
            var usersById = allUsers.ToDictionary(x => x.Id);
            var proposed = new Dictionary<long, ProposedUser>();

            foreach (var input in updates)
            {
                if (!usersById.TryGetValue(input.Id, out var user))
                    throw new AccountConflictException($"직원 ID #{input.Id}를 찾을 수 없습니다. 다른 탭에서 최신 목록을 확인하세요.");
                if (!actor.IsMaster && PermissionCatalog.IsAdministrator(user))
                    throw new InvalidOperationException("관리자는 다른 관리자나 마스터 계정을 변경할 수 없습니다.");
                if (user.UpdatedAtUtc.Ticks != input.UpdatedAtTicks)
                    throw new AccountConflictException($"{user.Name}님의 정보가 다른 곳에서 변경되었습니다. 다른 탭에서 최신 정보와 현재 초안을 비교하세요. 오래된 버전으로 덮어쓰지 않습니다.");

                proposed[user.Id] = Prepare(input, actor, user);
            }

            var finalEmails = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var user in allUsers)
            {
                var email = proposed.TryGetValue(user.Id, out var change) ? change.Email : user.Email;
                if (!finalEmails.Add(email))
                    throw new InvalidOperationException($"중복된 이메일이 있습니다: {email}");
            }

            if (proposed.TryGetValue(actor.Id, out var actorChange)
                && actor.IsMaster
                && (!actorChange.IsActive || !actorChange.IsMaster))
            {
                throw new InvalidOperationException("현재 로그인한 마스터 자신의 계정을 비활성화하거나 마스터 권한을 해제할 수 없습니다.");
            }

            var activeMasterCount = allUsers.Count(user =>
            {
                if (proposed.TryGetValue(user.Id, out var change))
                    return change.IsActive && change.IsMaster;
                return user.IsActive && user.IsMaster;
            });
            if (activeMasterCount == 0)
                throw new InvalidOperationException("마지막 활성 마스터 계정은 비활성화하거나 강등할 수 없습니다.");

            var changedUsers = new List<(CompanyUser User, bool QueueLeaveProjection)>();
            var updatedAt = DateTime.UtcNow;
            foreach (var (id, change) in proposed)
            {
                var user = usersById[id];
                var basicChanged = !Matches(user, change);
                var wasSharedAccount = user.IsSharedAccount;
                Apply(user, change);
                var organizationChanged = await organization.ApplyEmployeeAsync(actor, user, change.DepartmentId, change.ProjectIds);
                if (!basicChanged && !organizationChanged) continue;
                user.UpdatedAtUtc = updatedAt;
                changedUsers.Add((user, !wasSharedAccount || !change.IsSharedAccount));
            }

            await db.SaveChangesAsync(HttpContext.RequestAborted);
            foreach (var (user, queueLeaveProjection) in changedUsers)
                if (queueLeaveProjection)
                    await LeaveProjectionOutboxStore.EnqueueAsync(db, user.Id, HttpContext.RequestAborted);
            // Build the acknowledgement from the persisted values inside the transaction, not the unnormalized input.
            Memberships = await db.ProjectMemberships.ToListAsync(HttpContext.RequestAborted);
            Users = allUsers;
            var accounts = proposed.Keys.Select(id => new { id = id.ToString(), updatedAtTicks = usersById[id].UpdatedAtUtc.Ticks.ToString(), fields = FormValues(InputFor(usersById[id])) }).ToArray();
            var metrics = Metrics();
            committing = true;
            await transaction.CommitAsync(HttpContext.RequestAborted);
            if (WantsFormResult) return FormResult("saved", $"{changedUsers.Count}명의 변경사항을 저장했습니다.", 200, new { accounts, metrics });
            return RedirectToPage(new { saved = changedUsers.Count });
        }
        catch (Exception ex)
        {
            db.ChangeTracker.Clear();
            if (WantsFormResult)
            {
                if (ex is AccountConflictException) return FormResult("conflict", ex.Message, 409);
                if (!committing && ex is InvalidOperationException) return FormResult("invalid", ex.Message, 422);
                HttpContext.RequestServices.GetRequiredService<ILogger<UsersModel>>().LogError(ex, "Bulk account save failed");
                return FormResult("unknown", "저장 결과를 확인하지 못했습니다.", 500);
            }
            HtmlSaveBlocked = committing || ex is not InvalidOperationException && ex is not AccountConflictException;
            Error = HtmlSaveBlocked ? "저장 결과를 확인하지 못했습니다. 초안을 보존한 채 새 탭에서 저장 여부를 확인해 주세요. 반복 저장하지 않습니다." : ex.Message;
            await RecoverHtmlDraftsAsync(updates);
            return Page();
        }
    }

    public IReadOnlySet<string> Selected(CompanyUser user)
        => PermissionCatalog.Parse(user.Permissions);

    public bool CanManage(CompanyUser user)
        => ActorIsMaster || !PermissionCatalog.IsAdministrator(user);

    public static string RoleName(CompanyUser user)
        => user.IsSharedAccount ? "공용 테스트" : user.IsMaster ? "마스터" : user.IsAdmin ? "관리자" : "직원";

    public static string AccountTypeName(CompanyUser user)
        => user.IsSharedAccount ? "공용 테스트" : "직원";

    private async Task LoadAsync()
    {
        var actor = await currentUser.GetRequiredAsync();
        ActorIsMaster = actor.IsMaster;
        Departments = await db.Departments.OrderBy(x => x.Name).ToListAsync();
        Projects = await db.Projects.OrderBy(x => x.Name).ToListAsync();
        Memberships = await db.ProjectMemberships.ToListAsync();
        Users = await db.Users
            .OrderByDescending(x => x.IsMaster)
            .ThenByDescending(x => x.IsAdmin)
            .ThenBy(x => x.IsSharedAccount)
            .ThenByDescending(x => x.IsActive)
            .ThenBy(x => x.Name)
            .ToListAsync();
    }

    private static void EnsureRoleCanBeAssigned(CompanyUser actor, bool isAdmin, bool isMaster)
    {
        if (!actor.IsMaster && (isAdmin || isMaster))
            throw new InvalidOperationException("관리자·마스터 역할은 회사 마스터만 지정할 수 있습니다.");
    }

    private static void EnsureAccountTypeCanHaveRole(bool isSharedAccount, bool isAdmin, bool isMaster)
    {
        if (isSharedAccount && (isAdmin || isMaster))
            throw new InvalidOperationException("공용 테스트 계정에는 관리자나 마스터 역할을 지정할 수 없습니다.");
    }

    private static bool ParseAccountType(string? value)
        => value?.Trim().ToLowerInvariant() switch
        {
            null or "" or "employee" => false,
            "shared" => true,
            _ => throw new InvalidOperationException("계정 유형 값이 올바르지 않습니다.")
        };

    private static (bool IsAdmin, bool IsMaster) ParseRole(string? value)
        => value?.Trim().ToLowerInvariant() switch
        {
            "employee" => (false, false),
            "admin" => (true, false),
            "master" => (true, true),
            _ => throw new InvalidOperationException("회사 역할 값이 올바르지 않습니다.")
        };

    private static bool Matches(CompanyUser user, ProposedUser change)
        => user.Name == change.Name
           && user.Email == change.Email
           && user.DepartmentId == change.DepartmentId
           && user.HireDate == change.HireDate
           && user.BirthDate == change.BirthDate
           && user.IsActive == change.IsActive
           && user.IsPrivate == change.IsPrivate
           && user.IsSharedAccount == change.IsSharedAccount
           && user.IsAdmin == (change.IsAdmin || change.IsMaster)
           && user.IsMaster == change.IsMaster
           && user.Permissions == change.Permissions;

    private async Task SaveAndQueueLeaveProjectionAsync(CompanyUser user, bool queueLeaveProjection, long? departmentId, long[]? projectIds, Func<Task>? beforeCommit = null)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(HttpContext.RequestAborted);
        await organization.ApplyEmployeeAsync(await currentUser.GetRequiredAsync(), user, departmentId, projectIds);
        await db.SaveChangesAsync(HttpContext.RequestAborted);
        if (queueLeaveProjection)
            await LeaveProjectionOutboxStore.EnqueueAsync(db, user.Id, HttpContext.RequestAborted);
        if (beforeCommit is not null) await beforeCommit();
        await transaction.CommitAsync(HttpContext.RequestAborted);
    }

    private static DateOnly NormalizeHireDate(DateOnly? value, bool isSharedAccount, DateOnly? existing = null)
    {
        if (isSharedAccount)
            return existing ?? value ?? DateOnly.FromDateTime(DateTime.UtcNow);
        if (value is null || value == default)
            throw new InvalidOperationException("직원 계정은 입사일을 입력해야 합니다.");
        return value.Value;
    }

    private static bool TryParseBirthMonthDay(string? value, out DateOnly result)
    {
        result = default;
        var text = value?.Trim();
        return text?.Length == 5
            && DateOnly.TryParseExact("2000-" + text, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out result);
    }

    private static DateOnly? NormalizeBirthDate(string? value, bool isSharedAccount)
    {
        if (isSharedAccount || string.IsNullOrWhiteSpace(value)) return null;
        if (!TryParseBirthMonthDay(value, out var birthDate))
            throw new InvalidOperationException("생일은 MM-DD 형식의 올바른 월·일로 입력하세요.");
        return birthDate;
    }

    private static string NormalizeEmail(string value)
    {
        var email = value?.Trim().ToLowerInvariant() ?? "";
        if (string.IsNullOrWhiteSpace(email) || !new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(email) || email.Length > AccountFields.All.Single(f => f.Key == "Email").MaxLength)
            throw new InvalidOperationException("이메일을 확인하세요.");
        return email;
    }

    private static string RequireName(string value)
    {
        var name = value?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(name) || name.Length > AccountFields.All.Single(f => f.Key == "Name").MaxLength) throw new InvalidOperationException("이름은 1~100자로 입력하세요.");
        return name;
    }

    public sealed class BulkUserUpdateInput : AccountInput
    {
        public long Id { get; set; }
        public long UpdatedAtTicks { get; set; }
        // Display/reset baseline only. It never authorizes writes or replaces the version checked by the server.
        public string? Baseline { get; set; }
    }

    private Dictionary<string, string[]> PostedFields(string prefix) => AccountFields.All.ToDictionary(f => f.Key,
        f => Request.Form[prefix + f.Key].Select(value => value ?? "").ToArray());

    private bool CanRepresent(Dictionary<string, string[]>? fields)
    {
        if (fields is null || fields.Count != AccountFields.All.Length || AccountFields.All.Any(f => !fields.ContainsKey(f.Key))) return false;
        foreach (var field in AccountFields.All)
        {
            var values = fields[field.Key];
            if (values is null || values.Any(v => v is null) || values.Distinct().Count() != values.Length) return false;
            if (field.Key is not ("ProjectIds" or "Permissions") && values.Length != 1) return false;
            if (field.MaxLength is int max && values.Any(v => v.Length > max)) return false;
            if (field.Key == "AccountType" && !new[] { "employee", "shared" }.Contains(values[0])) return false;
            if (field.Key == "Role" && !(ActorIsMaster ? new[] { "employee", "admin", "master" } : new[] { "employee" }).Contains(values[0])) return false;
            if (field.Key is "IsActive" or "IsPrivate" && !new[] { "true", "false" }.Contains(values[0])) return false;
            if (field.Key == "HireDate" && values[0] != "" && !DateOnly.TryParseExact(values[0], "yyyy-MM-dd", out _)) return false;
            if (field.Key == "BirthDate" && values[0] != "" && !TryParseBirthMonthDay(values[0], out _)) return false;
            if (field.Key == "DepartmentId" && values[0] != "" && !Departments.Any(d => d.Id.ToString() == values[0])) return false;
            if (field.Key == "ProjectIds" && values.Any(v => !Projects.Any(p => p.Id.ToString() == v))) return false;
            if (field.Key == "Permissions" && values.Any(v => !ConfigurableSystems.Any(s => s.AccessPermission == v))) return false;
        }
        return true;
    }

    private async Task RecoverHtmlDraftsAsync(List<BulkUserUpdateInput>? updates)
    {
        Response.Headers.CacheControl = "no-store";
        await LoadAsync();
        var indexes = Request.Form["updates.Index"].ToArray();
        if (indexes.Length == 0)
            indexes = Request.Form.Keys.Select(k => System.Text.RegularExpressions.Regex.Match(k, @"^updates\[(\d+)\]\.Id$"))
                .Where(m => m.Success).Select(m => m.Groups[1].Value).Take(500).ToArray();
        foreach (var index in indexes.Distinct().Take(500))
        {
            var prefix = $"updates[{index}].";
            var idText = Request.Form[prefix + "Id"].ToString();
            var input = updates?.SingleOrDefault(u => u.Id.ToString() == idText && updates.Count(x => x.Id == u.Id) == 1);
            var user = Users.SingleOrDefault(u => u.Id.ToString() == idText);
            var restored = false;
            if (!HtmlSaveBlocked && ModelState.IsValid && input is not null && user is not null && CanManage(user) && CanRepresent(FormValues(input)))
            {
                try
                {
                    var baseline = JsonSerializer.Deserialize<DraftBaseline>(input.Baseline ?? "null");
                    if (baseline is not null && baseline.Id == idText && baseline.UpdatedAtTicks == input.UpdatedAtTicks.ToString()
                        && input.UpdatedAtTicks > 0 && CanRepresent(baseline.Fields))
                    {
                        recoveredEdits[user.Id] = (input, baseline);
                        restored = true;
                    }
                }
                catch (JsonException) { /* Legacy/malformed baselines remain copyable, never silently rebased. */ }
            }
            HtmlDrafts.Add(new("전송한 계정 · #" + idText, PostedFields(prefix), restored, Request.Form[prefix + "UpdatedAtTicks"].ToString()));
        }
    }

    private void ValidateBinding()
    {
        if (!ModelState.IsValid) throw new InvalidOperationException("입력 형식이 올바르지 않습니다. 날짜와 선택 값을 확인해 주세요.");
    }

    // Compatibility for existing Add/Update clients; new forms post the shared Role field.
    private void ApplyLegacyRole(AccountInput input, bool admin, bool master)
    {
        if (!Request.Form.ContainsKey("Role") && (admin || master)) input.Role = master ? "master" : "admin";
    }

    private static ProposedUser Prepare(AccountInput input, CompanyUser actor, CompanyUser? existing = null)
    {
        var shared = ParseAccountType(input.AccountType);
        var role = ParseRole(input.Role);
        EnsureRoleCanBeAssigned(actor, role.IsAdmin, role.IsMaster);
        EnsureAccountTypeCanHaveRole(shared, role.IsAdmin, role.IsMaster);
        return new(RequireName(input.Name), NormalizeEmail(input.Email), input.DepartmentId, input.ProjectIds ?? [],
            NormalizeHireDate(input.HireDate, shared, existing?.HireDate), NormalizeBirthDate(input.BirthDate, shared), input.IsActive, input.IsPrivate,
            shared, !shared && role.IsAdmin, !shared && role.IsMaster, PermissionCatalog.Normalize(input.Permissions));
    }

    private static void Apply(CompanyUser user, ProposedUser change)
    {
        user.Name = change.Name;
        user.Email = change.Email;
        user.HireDate = change.HireDate;
        user.BirthDate = change.BirthDate;
        user.IsActive = change.IsActive;
        user.IsPrivate = change.IsPrivate;
        user.IsSharedAccount = change.IsSharedAccount;
        user.IsAdmin = change.IsAdmin || change.IsMaster;
        user.IsMaster = change.IsMaster;
        user.Permissions = change.Permissions;
    }

    private sealed record ProposedUser(
        string Name,
        string Email,
        long? DepartmentId, long[] ProjectIds,
        DateOnly HireDate,
        DateOnly? BirthDate,
        bool IsActive,
        bool IsPrivate,
        bool IsSharedAccount,
        bool IsAdmin,
        bool IsMaster,
        string Permissions);
}
