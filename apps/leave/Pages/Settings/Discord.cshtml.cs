using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Json;
using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace LeaveManager.Pages.Settings;

public class DiscordModel(
    CurrentEmployeeService current,
    DiscordDirectMessageService discordDm,
    AppDbContext db,
    IWebHostEnvironment environment,
    ILogger<DiscordModel> logger) : PageModel
{
    public Employee Employee { get; set; } = default!;
    public bool IsOAuthConfigured => discordDm.IsOAuthConfigured;
    public bool IsBotConfigured => discordDm.IsBotConfigured;
    public bool IsConfigured => discordDm.IsConfigured;
    public string RedirectUri => discordDm.RedirectUri;
    public IReadOnlyList<DiscordDmNotificationOption> Options { get; set; } = [];
    public IReadOnlySet<string> SelectedTypes { get; set; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    [TempData] public string? StatusMessage { get; set; }
    [TempData] public string? ErrorMessage { get; set; }

    private const string FormMediaType = "application/vnd.company.workspace-form+json";
    private bool WantsFormResult => Request.Headers.Accept.ToString().Split(',').Any(x=>x.Trim()==FormMediaType);
    public string StateToken => Token(Employee);
    private static string Token(Employee employee) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
        employee.Id,employee.DiscordUserId,employee.DiscordUsername,employee.DiscordLinkedAtUtc,
        employee.DiscordDmEnabled,employee.DiscordDmNotificationTypes,employee.Role
    }))));
    public object Snapshot(Employee employee) => new {
        employeeId=employee.Id.ToString(CultureInfo.InvariantCulture),stateToken=Token(employee),
        discordUserId=employee.DiscordUserId,discordUsername=employee.DiscordUsername,
        enabled=employee.DiscordDmEnabled,
        selectedTypes=DiscordDmNotificationCatalog.ParseSelected(employee.DiscordDmNotificationTypes).Order().ToArray()
    };
    private IActionResult FormResult(string outcome,string message,int status,object? data=null) {
        Response.Headers.CacheControl="no-store";
        return new JsonResult(new {protocol="workspace-form-v1",outcome,message,data}) {StatusCode=status,ContentType=FormMediaType};
    }
    private IActionResult? CheckTarget(Employee employee,long? expectedEmployeeId,string? expectedStateToken) {
        // Stale-page detection only; this is not an atomic database concurrency token.
        Response.Headers.CacheControl="no-store";
        if(ModelState.IsValid && (expectedEmployeeId==employee.Id && expectedStateToken==Token(employee)
            || !WantsFormResult && expectedEmployeeId is null && expectedStateToken is null)) return null;
        const string message="계정 또는 Discord 설정이 변경되었습니다. 현재 설정을 다시 확인해 주세요.";
        if(WantsFormResult)return FormResult("conflict",message,409);
        ErrorMessage=message;return RedirectToPage();
    }
    private IActionResult Saved(string operation,Employee employee,string message) =>
        FormResult("saved",message,200,new {operation,snapshot=Snapshot(employee)});

    public async Task OnGet()
    {
        Response.Headers.CacheControl="no-store";
        await LoadAsync();
    }

    public async Task<IActionResult> OnPostLink(long? expectedEmployeeId,string? expectedStateToken)
    {
        await LoadAsync();
        if(CheckTarget(Employee,expectedEmployeeId,expectedStateToken) is {} rejected)return rejected;
        if (!IsOAuthConfigured)
        {
            ErrorMessage = "Discord OAuth 설정이 없습니다. .env 설정을 먼저 확인하세요.";
            return RedirectToPage();
        }

        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        Response.Cookies.Append("LeaveManager.DiscordOAuthState", state, new CookieOptions
        {
            HttpOnly = true,
            Secure = !environment.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
            Path = "/",
            MaxAge = TimeSpan.FromMinutes(10),
            IsEssential = true
        });

        return Redirect(discordDm.BuildAuthorizationUrl(state));
    }

    public async Task<IActionResult> OnPostSave(bool discordDmEnabled, string[] selectedTypes,long? expectedEmployeeId,string? expectedStateToken)
    {
        var employee = await current.GetRequiredAsync();
        if(CheckTarget(employee,expectedEmployeeId,expectedStateToken) is {} rejected)return rejected;
        var normalized = DiscordDmNotificationCatalog.NormalizeSelected(selectedTypes, employee.Role);
        employee.DiscordDmEnabled = discordDmEnabled && !string.IsNullOrWhiteSpace(employee.DiscordUserId);
        employee.DiscordDmNotificationTypes = normalized;
        await db.SaveChangesAsync();

        if(WantsFormResult)return Saved("Save",employee,"Discord 개인 DM 알림 설정을 저장했습니다.");

        StatusMessage = employee.DiscordDmEnabled
            ? "Discord 개인 DM 알림 설정을 저장했습니다."
            : "Discord 개인 DM 알림을 껐습니다.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostUnlink(long? expectedEmployeeId,string? expectedStateToken)
    {
        var employee = await current.GetRequiredAsync();
        if(CheckTarget(employee,expectedEmployeeId,expectedStateToken) is {} rejected)return rejected;
        employee.DiscordUserId = null;
        employee.DiscordUsername = null;
        employee.DiscordLinkedAtUtc = null;
        employee.DiscordDmEnabled = false;
        employee.DiscordDmNotificationTypes = null;
        await db.SaveChangesAsync();
        if(WantsFormResult)return Saved("Unlink",employee,"Discord 연동을 해제했습니다.");
        StatusMessage = "Discord 연동을 해제했습니다.";
        return RedirectToPage();
    }

    public async Task<IActionResult> OnPostTest(long? expectedEmployeeId,string? expectedStateToken)
    {
        var employee = await current.GetRequiredAsync();
        if(CheckTarget(employee,expectedEmployeeId,expectedStateToken) is {} rejected)return rejected;
        try
        {
            await discordDm.SendTestAsync(employee);
            if(WantsFormResult)return Saved("Test",employee,"Discord에서 테스트 DM 발송 요청을 수락했습니다. 실제 수신은 Discord에서 확인하세요.");
            StatusMessage = "Discord 테스트 DM을 보냈습니다.";
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Discord 테스트 DM 발송 실패: EmployeeId={EmployeeId}", employee.Id);
            if(WantsFormResult)return FormResult("unknown","DM 발송 결과를 확인하지 못했습니다. Discord에서 수신 여부를 확인하세요. 자동으로 재전송하지 않습니다.",502);
            ErrorMessage = "Discord 테스트 DM 발송에 실패했습니다. 연동 상태와 서버 설정을 확인하세요.";
        }
        return RedirectToPage();
    }

    private async Task LoadAsync()
    {
        Employee = await current.GetRequiredAsync();
        Options = DiscordDmNotificationCatalog.GetAllowed(Employee.Role);
        SelectedTypes = DiscordDmNotificationCatalog.ParseSelected(Employee.DiscordDmNotificationTypes);
    }
}
