using System.Globalization;
using System.Text.RegularExpressions;
using CompanyPortal.Data;
using CompanyPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Pages.Settings;

[RequestSizeLimit(1048576)]
[RequestFormLimits(MultipartBodyLengthLimit = 1048576)]
public class ProfileModel(AppDbContext db, CurrentUserService current, ILogger<ProfileModel> logger) : PageModel
{
    const string MediaType = "application/vnd.company.workspace-form+json";
    [BindProperty] public string? ExpectedUserId { get; set; }
    [BindProperty] public string? ExpectedVersion { get; set; }
    [BindProperty] public string? Operation { get; set; }
    [BindProperty] public IFormFile? Photo { get; set; }
    public string? Error { get; private set; }
    public async Task OnGetAsync()
    {
        Response.Headers.CacheControl = "no-store";
        var user = await current.GetRequiredAsync();
        ExpectedUserId = user.Id.ToString(CultureInfo.InvariantCulture);
        ExpectedVersion = await AvatarStore.VersionAsync(db, user.Id) ?? "";
    }
    public async Task<IActionResult> OnPostAsync()
    {
        Response.Headers.CacheControl = "no-store";
        var enhanced = Request.Headers.Accept.ToString().Split(',').Any(v => v.Trim() == MediaType);
        IActionResult Result(string outcome, string message, int status, object? data = null)
        {
            if (enhanced) return new JsonResult(new { protocol = "workspace-form-v1", outcome, message, data }) { StatusCode = status, ContentType = MediaType };
            Error = message + " 사진 파일은 다시 선택해야 합니다. 최신 사진은 새로고침하여 확인하세요.";
            Response.StatusCode = status; return Page();
        }
        var user = await current.GetRequiredAsync();
        var id = user.Id.ToString(CultureInfo.InvariantCulture);
        if (ExpectedUserId != id || Request.Form["ExpectedUserId"].Count != 1)
            return Result("conflict", "사진을 수정하는 계정이 변경되었습니다. 현재 계정의 설정을 다시 열어 주세요.", 409);
        var expected = ExpectedVersion ?? "";
        if (!ModelState.IsValid || Request.Form["ExpectedVersion"].Count != 1 || !Regex.IsMatch(expected, "\\A(?:[a-f0-9]{32})?\\z") || Operation is not ("save" or "remove") || Request.Form["Operation"].Count != 1)
            return Result("invalid", "사진 작업과 기준 버전을 확인해 주세요.", 422);
        byte[]? image = null;
        if (Operation == "save")
        {
            if (Photo is null || Photo.Length > 524288) return Result("invalid", "저장할 256×256 PNG 사진을 선택해 주세요.", 422);
            try { using var stream = Photo.OpenReadStream(); image = await AvatarStore.ReadPngAsync(stream, HttpContext.RequestAborted); }
            catch (OperationCanceledException) { throw; }
            catch { return Result("invalid", "올바른 256×256 PNG 사진을 선택해 주세요.", 422); }
        }
        try
        {
            var version = await AvatarStore.ApplyAsync(db, user.Id, image, expected);
            if (!enhanced) return RedirectToPage();
            return Result("saved", Operation == "save" ? "프로필 사진을 저장했습니다." : "기본 프로필 사진으로 변경했습니다.", 200,
                new { operation = Operation, userId = id, version = version ?? "", avatarUrl = version is null ? null : $"/api/workspace/avatar/{id}?v={version}" });
        }
        catch (DbUpdateConcurrencyException ex) { return Result("conflict", ex.Message, 409); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { logger.LogError(ex, "Profile form write failed"); return Result("unknown", "저장 결과를 확인하지 못했습니다. 현재 사진을 다시 확인해 주세요.", 500); }
    }
}
