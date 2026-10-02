using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Text.Json;

namespace LeaveManager.Pages.Admin;

public partial class HolidaysModel(AppDbContext db, CurrentEmployeeService current, AuditService audit, IHttpClientFactory httpClientFactory, ILogger<HolidaysModel> logger) : PageModel
{
    private const string NagerPublicHolidayUrlFormat = "https://date.nager.at/api/v3/PublicHolidays/{0}/KR";

    [BindProperty(SupportsGet = true)] public int Year { get; set; }
    [BindProperty] public HolidayInput Input { get; set; } = new();
    [BindProperty] public HolidayImportInput Import { get; set; } = new();
    public List<Holiday> Holidays { get; set; } = [];
    public string? Error { get; set; }
    public string? Success { get; set; }

    public async Task OnGet()
    {
        await LoadAsync();
    }

    public async Task<IActionResult> OnPostAdd()
    {
        if (await CheckTargetAsync() is {} rejected) return rejected;
        var previous = StateToken;
        var actor = await current.GetRequiredAsync();
        if (!ValidField("Input.Date") || !ValidField("Input.Name") || Input.Date == default
            || string.IsNullOrWhiteSpace(Input.Name) || Input.Name.Length > 100)
            return await FailAsync("invalid", "날짜와 100자 이내 공휴일명을 입력하세요.", 422);

        var intent = new { date = DateText(Input.Date), name = Input.Name.Trim() };
        try
        {
            var existing = await db.Holidays.SingleOrDefaultAsync(x => x.Date == Input.Date);
            if (existing is null)
            {
                var holiday = new Holiday
                {
                    Date = Input.Date,
                    Name = Input.Name.Trim(),
                    CreatedByEmployeeId = actor.Id
                };
                db.Holidays.Add(holiday);
                await db.SaveChangesAsync();
                await audit.WriteAsync(actor.Id, "HolidayCreated", "Holiday", holiday.Id, new { holiday.Date, holiday.Name });
                Success = "공휴일을 추가했습니다.";
            }
            else
            {
                var before = new { existing.Date, existing.Name };
                existing.Name = Input.Name.Trim();
                await db.SaveChangesAsync();
                await audit.WriteAsync(actor.Id, "HolidayUpdated", "Holiday", existing.Id, new { Before = before, After = new { existing.Date, existing.Name } });
                Success = "같은 날짜의 공휴일명을 수정했습니다.";
            }

            Year = Input.Date.Year;
            if (Enhanced) return await SavedAsync("Add", previous, intent, null, null, Success!);
            Input = new HolidayInput { Date = Input.Date == DateOnly.MaxValue ? Input.Date : Input.Date.AddDays(1) };
            Import.Year = Year;
            await LoadAsync();
            return Page();
        }
        catch (Exception ex) { return await UnknownAsync(ex); }
    }

    public async Task<IActionResult> OnPostDelete(long id)
    {
        if (await CheckTargetAsync() is {} rejected) return rejected;
        var previous = StateToken;
        if (!ValidField("id") || id <= 0) return await FailAsync("invalid", "삭제할 공휴일 번호를 확인하세요.", 422);
        var actor = await current.GetRequiredAsync();
        try
        {
            var holiday = await db.Holidays.SingleOrDefaultAsync(x => x.Id == id);
            if (holiday is null) return await FailAsync("conflict", "삭제할 공휴일을 찾지 못했습니다. 현재 목록을 확인하세요.", 409);
            var before = new { holiday.Id, holiday.Date, holiday.Name };
            Year = holiday.Date.Year;
            db.Holidays.Remove(holiday);
            await db.SaveChangesAsync();
            await audit.WriteAsync(actor.Id, "HolidayDeleted", "Holiday", id, before);
            Success = "공휴일을 삭제했습니다.";
            if (Enhanced) return await SavedAsync("Delete", previous, new { id = IdText(id) }, null, null, Success);
            await LoadAsync();
            return Page();
        }
        catch (Exception ex) { return await UnknownAsync(ex); }
    }

    public async Task<IActionResult> OnPostImportOnline()
    {
        if (await CheckTargetAsync() is {} rejected) return rejected;
        var previous = StateToken;
        var actor = await current.GetRequiredAsync();
        if (Enhanced && !ValidImport()) return await FailAsync("invalid", "가져올 연도와 덮어쓰기 설정을 확인하세요.", 422);
        NormalizeImportYear();
        Year = Import.Year;

        List<ParsedHoliday> parsed;
        try
        {
            var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(12);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("LeaveManager/1.0");

            var url = string.Format(CultureInfo.InvariantCulture, NagerPublicHolidayUrlFormat, Import.Year);
            using var response = await client.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                return await FailAsync("invalid", $"공휴일 API 조회에 실패했습니다. HTTP {(int)response.StatusCode}. 공휴일은 저장하지 않았습니다.", 422);

            parsed = NormalizeHolidays(ExpandKoreanSubstituteHolidays(ParseHolidayJson(body, Import.Year), Import.Year), Import.Year);
            if (parsed.Count == 0)
                return await FailAsync("invalid", "불러온 데이터에서 등록 가능한 공휴일을 찾지 못했습니다. 저장하지 않았습니다.", 422);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "공휴일 외부 조회 실패: 저장 전");
            return await FailAsync("invalid", "공휴일 조회에 실패했습니다. 네트워크 또는 응답 형식을 확인하세요. 공휴일은 저장하지 않았습니다.", 422);
        }

        // External reads can be slow. Recheck the submitted list before the first write.
        if (await CheckTargetAsync() is {} changed) return changed;
        try
        {
            var result = await UpsertHolidaysAsync(parsed, actor.Id, Import.OverwriteExisting);
            await audit.WriteAsync(actor.Id, "HolidayImportedOnline", "Holiday", Import.Year, new
            {
                Import.Year,
                Source = "Nager.Date",
                Imported = result.Created,
                Updated = result.Updated,
                Skipped = result.Skipped,
                Import.OverwriteExisting
            });
            Success = BuildImportMessage("온라인", result);
            if (Enhanced) return await SavedAsync("ImportOnline", previous, ImportIntent(false), parsed, result, Success);
        }
        catch (Exception ex) { return await UnknownAsync(ex); }

        await LoadAsync();
        return Page();
    }

    public async Task<IActionResult> OnPostImportJson()
    {
        if (await CheckTargetAsync() is {} rejected) return rejected;
        var previous = StateToken;
        var actor = await current.GetRequiredAsync();
        if (Enhanced && !ValidImport()) return await FailAsync("invalid", "가져올 연도와 덮어쓰기 설정을 확인하세요.", 422);
        NormalizeImportYear();
        Year = Import.Year;

        if (!ValidField("Import.JsonText") || string.IsNullOrWhiteSpace(Import.JsonText) || Import.JsonText.Length > 20000)
            return await FailAsync("invalid", "20,000자 이내 JSON 내용을 입력하세요.", 422);

        List<ParsedHoliday> parsed;
        try
        {
            parsed = NormalizeHolidays(ParseHolidayJson(Import.JsonText, Import.Year), Import.Year);
            if (parsed.Count == 0)
                return await FailAsync("invalid", "JSON에서 등록 가능한 공휴일을 찾지 못했습니다. date/name 또는 date/localName 형식을 확인하세요.", 422);
        }
        catch (JsonException)
        {
            return await FailAsync("invalid", "JSON 형식이 올바르지 않습니다. 원문을 확인하세요. 공휴일은 저장하지 않았습니다.", 422);
        }
        try
        {
            var result = await UpsertHolidaysAsync(parsed, actor.Id, Import.OverwriteExisting);
            await audit.WriteAsync(actor.Id, "HolidayImportedJson", "Holiday", Import.Year, new
            {
                Import.Year,
                Imported = result.Created,
                Updated = result.Updated,
                Skipped = result.Skipped,
                Import.OverwriteExisting
            });
            Success = BuildImportMessage("JSON", result);
            if (Enhanced) return await SavedAsync("ImportJson", previous, ImportIntent(true), parsed, result, Success);
            Import.JsonText = "";
        }
        catch (Exception ex) { return await UnknownAsync(ex); }

        await LoadAsync();
        return Page();
    }

    private async Task<ImportResult> UpsertHolidaysAsync(IReadOnlyList<ParsedHoliday> parsed, long actorId, bool overwriteExisting)
    {
        var start = new DateOnly(Year, 1, 1);
        var end = new DateOnly(Year, 12, 31);
        var existing = await db.Holidays
            .Where(x => x.Date >= start && x.Date <= end)
            .ToDictionaryAsync(x => x.Date);

        var result = new ImportResult();
        var normalized = NormalizeHolidays(parsed, Year);

        foreach (var item in normalized)
        {
            if (existing.TryGetValue(item.Date, out var holiday))
            {
                if (!overwriteExisting)
                {
                    result.Skipped++;
                    continue;
                }

                if (!string.Equals(holiday.Name, item.Name, StringComparison.Ordinal))
                {
                    holiday.Name = item.Name;
                    result.Updated++;
                }
                else
                {
                    result.Skipped++;
                }
                continue;
            }

            db.Holidays.Add(new Holiday
            {
                Date = item.Date,
                Name = item.Name,
                CreatedByEmployeeId = actorId
            });
            result.Created++;
        }

        await db.SaveChangesAsync();
        return result;
    }


    private static List<ParsedHoliday> ExpandKoreanSubstituteHolidays(IReadOnlyList<ParsedHoliday> imported, int year)
    {
        var result = BuildKoreanOriginalHolidays(year);
        var originalDatesByKey = result
            .GroupBy(x => NormalizeHolidayKey(x.Name))
            .ToDictionary(g => g.Key, g => g.Select(x => x.Date).ToHashSet());

        foreach (var item in imported)
        {
            if (item.Date.Year != year || string.IsNullOrWhiteSpace(item.Name)) continue;

            var canonicalName = CanonicalHolidayName(item.Name);
            var key = NormalizeHolidayKey(canonicalName);
            if (originalDatesByKey.TryGetValue(key, out var originalDates) && !originalDates.Contains(item.Date))
            {
                result.Add(new ParsedHoliday(item.Date, EnsureSubstituteName(canonicalName)));
            }
            else
            {
                result.Add(new ParsedHoliday(item.Date, canonicalName));
            }
        }

        return result
            .GroupBy(x => new { x.Date, Key = NormalizeHolidayKey(x.Name) })
            .Select(g => g.First())
            .OrderBy(x => x.Date)
            .ThenBy(x => x.Name)
            .ToList();
    }

    private static List<ParsedHoliday> BuildKoreanOriginalHolidays(int year)
    {
        var holidays = new List<ParsedHoliday>
        {
            new(new DateOnly(year, 1, 1), "신정"),
            new(new DateOnly(year, 3, 1), "삼일절"),
            new(new DateOnly(year, 5, 5), "어린이날"),
            new(new DateOnly(year, 6, 6), "현충일"),
            new(new DateOnly(year, 8, 15), "광복절"),
            new(new DateOnly(year, 10, 3), "개천절"),
            new(new DateOnly(year, 10, 9), "한글날"),
            new(new DateOnly(year, 12, 25), "성탄절")
        };

        TryAddKoreanLunarHoliday(holidays, year - 1, 12, null, "설날");
        TryAddKoreanLunarHoliday(holidays, year, 1, 1, "설날");
        TryAddKoreanLunarHoliday(holidays, year, 1, 2, "설날");
        TryAddKoreanLunarHoliday(holidays, year, 4, 8, "부처님오신날");
        TryAddKoreanLunarHoliday(holidays, year, 8, 14, "추석");
        TryAddKoreanLunarHoliday(holidays, year, 8, 15, "추석");
        TryAddKoreanLunarHoliday(holidays, year, 8, 16, "추석");

        return holidays
            .Where(x => x.Date.Year == year)
            .OrderBy(x => x.Date)
            .ThenBy(x => x.Name)
            .ToList();
    }

    private static void TryAddKoreanLunarHoliday(List<ParsedHoliday> holidays, int lunarYear, int lunarMonth, int? lunarDay, string name)
    {
        try
        {
            var calendar = new KoreanLunisolarCalendar();
            var calendarMonth = GetKoreanLunarCalendarMonth(calendar, lunarYear, lunarMonth);
            var day = lunarDay ?? calendar.GetDaysInMonth(lunarYear, calendarMonth);
            var solar = calendar.ToDateTime(lunarYear, calendarMonth, day, 0, 0, 0, 0);
            holidays.Add(new ParsedHoliday(DateOnly.FromDateTime(solar), name));
        }
        catch
        {
            // 한국 음력 변환 범위를 벗어나거나 예외가 발생하면 해당 원 공휴일만 건너뜁니다.
        }
    }

    private static int GetKoreanLunarCalendarMonth(KoreanLunisolarCalendar calendar, int lunarYear, int lunarMonth)
    {
        var leapMonth = calendar.GetLeapMonth(lunarYear);
        return leapMonth > 0 && lunarMonth >= leapMonth ? lunarMonth + 1 : lunarMonth;
    }

    private static string EnsureSubstituteName(string name)
    {
        var trimmed = name.Trim();
        return IsSubstituteName(trimmed) ? trimmed : $"{trimmed} 대체휴무";
    }

    private static bool IsSubstituteName(string name)
    {
        var raw = name.Trim().ToLowerInvariant();
        return raw.Contains("대체", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("substitute", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("observed", StringComparison.OrdinalIgnoreCase);
    }

    private static string CanonicalHolidayName(string name)
    {
        var trimmed = name.Trim();
        var key = NormalizeHolidayKey(trimmed);
        return key switch
        {
            "newyearsday" or "newyear" or "신정" or "새해" => "신정",
            "seollal" or "koreannewyear" or "lunarnewyear" or "설날" => "설날",
            "independencemovementday" or "march1stmovementday" or "삼일절" => "삼일절",
            "childrensday" or "어린이날" => "어린이날",
            "buddhasbirthday" or "birthdayofbuddha" or "부처님오신날" or "석가탄신일" => "부처님오신날",
            "memorialday" or "현충일" => "현충일",
            "liberationday" or "nationalliberationday" or "광복절" => "광복절",
            "chuseok" or "추석" => "추석",
            "nationalfoundationday" or "개천절" => "개천절",
            "hangeulday" or "hangulday" or "한글날" => "한글날",
            "christmasday" or "christmas" or "성탄절" or "기독탄신일" => "성탄절",
            _ => trimmed
        };
    }

    private static string NormalizeHolidayKey(string name)
    {
        var chars = name.Trim().ToLowerInvariant()
            .Replace("대체공휴일", "")
            .Replace("대체휴일", "")
            .Replace("대체휴무", "")
            .Replace("공휴일", "")
            .Replace("substitute holiday", "")
            .Replace("substitute", "")
            .Replace("observed", "")
            .Where(char.IsLetterOrDigit)
            .ToArray();
        return new string(chars);
    }

    private static List<ParsedHoliday> ParseHolidayJson(string json, int year)
    {
        using var doc = JsonDocument.Parse(json);
        var result = new List<ParsedHoliday>();
        ParseElement(doc.RootElement, result, year);
        return result;
    }

    private static void ParseElement(JsonElement element, List<ParsedHoliday> result, int year)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray()) ParseElement(item, result, year);
            return;
        }

        if (element.ValueKind != JsonValueKind.Object) return;

        if (TryParseHolidayObject(element, year, out var holiday))
        {
            result.Add(holiday);
            return;
        }

        foreach (var containerName in new[] { "response", "holidays", "items", "item", "data", "result", "body" })
        {
            if (TryGetPropertyIgnoreCase(element, containerName, out var child))
            {
                ParseElement(child, result, year);
            }
        }

        // { "2026-01-01": "신정", "2026-03-01": "삼일절" } 형식도 지원합니다.
        foreach (var prop in element.EnumerateObject())
        {
            if (TryParseDate(prop.Name, out var date) && date.Year == year)
            {
                var name = prop.Value.ValueKind == JsonValueKind.String ? prop.Value.GetString() : prop.Value.ToString();
                if (!string.IsNullOrWhiteSpace(name)) result.Add(new ParsedHoliday(date, name.Trim()));
            }
        }
    }

    private static bool TryParseHolidayObject(JsonElement item, int year, out ParsedHoliday holiday)
    {
        holiday = default;
        if (!TryReadDate(item, out var date) || date.Year != year) return false;
        var name = ReadFirstString(item, "localName", "dateName", "holidayName", "name", "title", "summary");
        if (string.IsNullOrWhiteSpace(name)) return false;
        holiday = new ParsedHoliday(date, name.Trim());
        return true;
    }

    private static bool TryReadDate(JsonElement item, out DateOnly date)
    {
        foreach (var propertyName in new[] { "date", "Date", "holidayDate", "locdate", "dateString", "startDate" })
        {
            if (!TryGetPropertyIgnoreCase(item, propertyName, out var property)) continue;
            if (property.ValueKind == JsonValueKind.String && TryParseDate(property.GetString(), out date)) return true;
            if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var n) && TryParseDate(n.ToString(CultureInfo.InvariantCulture), out date)) return true;
        }

        date = default;
        return false;
    }

    private static bool TryParseDate(string? value, out DateOnly date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var text = value.Trim();

        if (DateOnly.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) return true;
        if (DateOnly.TryParseExact(text, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) return true;
        if (DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date)) return true;
        return false;
    }

    private static string? ReadFirstString(JsonElement item, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            if (TryGetPropertyIgnoreCase(item, propertyName, out var property) && property.ValueKind == JsonValueKind.String)
            {
                var value = property.GetString();
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        return null;
    }

    private static bool TryGetPropertyIgnoreCase(JsonElement element, string propertyName, out JsonElement value)
    {
        foreach (var prop in element.EnumerateObject())
        {
            if (string.Equals(prop.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                value = prop.Value;
                return true;
            }
        }
        value = default;
        return false;
    }

    private void NormalizeImportYear()
    {
        var today = AppTime.Today;
        if (Import.Year < 2000 || Import.Year > 2100) Import.Year = Year is >= 2000 and <= 2100 ? Year : today.Year;
    }

    private static string BuildImportMessage(string source, ImportResult result)
        => $"{source} 공휴일을 반영했습니다. 추가 {result.Created}건, 수정 {result.Updated}건, 건너뜀 {result.Skipped}건.";

    private async Task LoadAsync()
    {
        await LoadSnapshotAsync();
        var today = AppTime.Today;
        if (Year < 2000 || Year > 2100) Year = today.Year;
        if (Input.Date == default) Input.Date = today;
        if (Import.Year < 2000 || Import.Year > 2100) Import.Year = Year;

        var start = new DateOnly(Year, 1, 1);
        var end = new DateOnly(Year, 12, 31);
        Holidays = AllHolidays
            .Where(x => x.Date >= start && x.Date <= end)
            .OrderBy(x => x.Date)
            .ToList();
    }

    private readonly record struct ParsedHoliday(DateOnly Date, string Name);

    private sealed class ImportResult
    {
        public int Created { get; set; }
        public int Updated { get; set; }
        public int Skipped { get; set; }
    }
}

public class HolidayInput
{
    [Required] public DateOnly Date { get; set; }
    [Required, MaxLength(100)] public string Name { get; set; } = "";
}

public class HolidayImportInput
{
    [Range(2000, 2100)] public int Year { get; set; }
    public bool OverwriteExisting { get; set; }
    [MaxLength(20000)] public string? JsonText { get; set; }
}
