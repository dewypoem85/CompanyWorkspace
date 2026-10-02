namespace LeaveManager.Services;

public static class AppTime
{
    private static readonly TimeZoneInfo KoreaTimeZone = LoadKoreaTimeZone();

    public static DateTime UtcNow => DateTime.UtcNow;
    public static DateTime KstNow => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, KoreaTimeZone);
    public static DateOnly Today => DateOnly.FromDateTime(KstNow);

    public static DateTime ToKst(DateTime utc)
    {
        var normalized = utc.Kind == DateTimeKind.Utc ? utc : DateTime.SpecifyKind(utc, DateTimeKind.Utc);
        return TimeZoneInfo.ConvertTimeFromUtc(normalized, KoreaTimeZone);
    }

    private static TimeZoneInfo LoadKoreaTimeZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Seoul"); }
        catch
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("Korea Standard Time"); }
            catch { return TimeZoneInfo.CreateCustomTimeZone("KST", TimeSpan.FromHours(9), "KST", "KST"); }
        }
    }
}
