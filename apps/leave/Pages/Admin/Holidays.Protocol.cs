using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LeaveManager.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Pages.Admin;

public partial class HolidaysModel
{
    const string FormMediaType = "application/vnd.company.workspace-form+json";
    bool Enhanced => Request.Headers.Accept.ToString().Split(',').Any(x => x.Trim() == FormMediaType);
    public bool Locked { get; private set; }
    public string ActorId { get; private set; } = "";
    public string StateToken { get; private set; } = "";
    List<Holiday> AllHolidays { get; set; } = [];
    static string IdText(long id) => id.ToString(CultureInfo.InvariantCulture);
    static string DateText(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    static object Row(Holiday row) => new { id = IdText(row.Id), date = DateText(row.Date), name = row.Name };

    public object Snapshot() => new { actorEmployeeId = ActorId, stateToken = StateToken, items = AllHolidays.Select(Row) };

    async Task LoadSnapshotAsync()
    {
        Response.Headers.CacheControl = "no-store";
        ActorId = IdText((await current.GetRequiredAsync()).Id);
        // Forms may target a year other than the displayed list. One baseline covers all their dates.
        AllHolidays = await db.Holidays.AsNoTracking().OrderBy(x => x.Date).ThenBy(x => x.Id).ToListAsync();
        StateToken = Hash(JsonSerializer.Serialize(AllHolidays.Select(Row)));
    }

    async Task<IActionResult?> CheckTargetAsync()
    {
        await LoadSnapshotAsync();
        var actor = Request.Form["expectedEmployeeId"];
        var token = Request.Form["expectedStateToken"];
        if (!Enhanced && actor.Count == 0 && token.Count == 0) return null;
        if (actor.Count == 1 && token.Count == 1 && actor[0] == ActorId && token[0] == StateToken) return null;
        return await FailAsync("conflict", "계정 또는 공휴일 목록이 변경되었습니다. 현재 목록을 다시 확인하세요.", 409);
    }

    bool ValidField(string name) => Request.Form[name].Count == 1 && (!ModelState.TryGetValue(name, out var value) || value.Errors.Count == 0);
    bool ValidImport()
    {
        var overwrite = Request.Form["Import.OverwriteExisting"];
        return ValidField("Import.Year") && Import.Year is >= 2000 and <= 2100
            && (overwrite.Count == 1 && (overwrite[0] == "true" || overwrite[0] == "false")
                || overwrite.Count == 2 && overwrite[0] == "true" && overwrite[1] == "false");
    }

    object ImportIntent(bool json) => new { year = Import.Year, overwriteExisting = Import.OverwriteExisting, jsonHash = json ? Hash(Import.JsonText!) : null };

    static List<ParsedHoliday> NormalizeHolidays(IReadOnlyList<ParsedHoliday> parsed, int year) => parsed
        .Where(x => x.Date.Year == year && !string.IsNullOrWhiteSpace(x.Name))
        .GroupBy(x => x.Date)
        .Select(g => new ParsedHoliday(g.Key, string.Join(" / ", g.Select(x => x.Name.Trim()).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())))
        .OrderBy(x => x.Date)
        .ToList();

    IActionResult FormResult(string outcome, string message, int status, object? data = null)
    {
        Response.Headers.CacheControl = "no-store";
        return new JsonResult(new { protocol = "workspace-form-v1", outcome, message, data }) { StatusCode = status, ContentType = FormMediaType };
    }

    async Task<IActionResult> FailAsync(string outcome, string message, int status)
    {
        if (Enhanced) return FormResult(outcome, message, status);
        Locked = outcome != "invalid";
        Success = null;
        Error = message;
        await LoadAsync();
        return Page();
    }

    async Task<IActionResult> UnknownAsync(Exception ex)
    {
        logger.LogWarning(ex, "공휴일 저장 결과 미확정");
        return await FailAsync("unknown", "공휴일 처리 결과를 확인하지 못했습니다. 이미 반영되었을 수 있으므로 다시 저장하지 말고 현재 목록을 확인하세요.", 502);
    }

    async Task<IActionResult> SavedAsync(string operation, string previous, object intent, IReadOnlyList<ParsedHoliday>? applied, ImportResult? result, string message)
    {
        await LoadSnapshotAsync();
        return FormResult("saved", message, 200, new
        {
            operation, previousStateToken = previous, intent, snapshot = Snapshot(),
            applied = applied?.Select(x => new { date = DateText(x.Date), name = x.Name }),
            counts = result is null ? null : new { created = result.Created, updated = result.Updated, skipped = result.Skipped },
            navigateTo = "/Admin/Holidays?Year=" + Year.ToString(CultureInfo.InvariantCulture)
        });
    }
}
