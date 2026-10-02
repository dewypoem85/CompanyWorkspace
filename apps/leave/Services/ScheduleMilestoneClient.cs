using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LeaveManager.Services;

public interface IScheduleMilestoneReader
{
    Task<ScheduleMilestoneReadResult> ReadAsync(long? companyUserId, DateOnly from, DateOnly to, CancellationToken cancellationToken);
}

public sealed class ScheduleMilestoneClient(
    IHttpClientFactory clients,
    IConfiguration configuration,
    ILogger<ScheduleMilestoneClient> logger) : IScheduleMilestoneReader
{
    public async Task<ScheduleMilestoneReadResult> ReadAsync(long? companyUserId, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        if (!companyUserId.HasValue || companyUserId <= 0) return ScheduleMilestoneReadResult.Empty;
        var baseUrl = (configuration["Schedule:InternalUrl"] ?? "").Trim().TrimEnd('/');
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
            return ScheduleMilestoneReadResult.Empty;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                new Uri(baseUri, $"/api/internal/leave/milestones?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", CreateToken(companyUserId.Value));
            using var response = await clients.CreateClient("ScheduleInternal").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Schedule milestone read failed with status {StatusCode}", (int)response.StatusCode);
                return ScheduleMilestoneReadResult.Unavailable;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, new JsonDocumentOptions { MaxDepth = 12 }, cancellationToken);
            if (!document.RootElement.TryGetProperty("items", out var rows) || rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 5000)
                return ScheduleMilestoneReadResult.Unavailable;

            var items = new List<CalendarScheduleMilestone>(rows.GetArrayLength());
            foreach (var row in rows.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object
                    || !TryRequiredString(row, "milestoneId", 32, out var id)
                    || !long.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var numericId) || numericId <= 0
                    || !row.TryGetProperty("occurrenceIndex", out var occurrenceIndexElement) || !occurrenceIndexElement.TryGetInt32(out var occurrenceIndex) || occurrenceIndex is < 0 or > 20
                    || !TryRequiredString(row, "type", 20, out var type) || type is not ("general" or "review" or "update" or "prototype")
                    || !TryRequiredString(row, "title", 200, out var title)
                    || !TryRequiredString(row, "date", 10, out var dateText)
                    || !DateOnly.TryParseExact(dateText, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                    || date < from || date > to
                    || !TryOptionalString(row, "projectId", 32, out var projectId)
                    || projectId is not null && (!long.TryParse(projectId, NumberStyles.None, CultureInfo.InvariantCulture, out var numericProjectId) || numericProjectId <= 0)
                    || !TryOptionalString(row, "projectName", 200, out var projectName)
                    || (projectId is null) != (projectName is null))
                    return ScheduleMilestoneReadResult.Unavailable;

                items.Add(new(id, occurrenceIndex, type, title, date, projectId, projectName));
            }

            return new(true, items);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Schedule milestone read timed out");
            return ScheduleMilestoneReadResult.Unavailable;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Schedule milestone read failed");
            return ScheduleMilestoneReadResult.Unavailable;
        }
    }

    private string CreateToken(long companyUserId)
    {
        var secret = (configuration["CompanyPortal:SsoSharedSecret"] ?? "").Trim();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var body = Encode(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = "company-leave",
            aud = "leave-milestones",
            sub = companyUserId.ToString(CultureInfo.InvariantCulture),
            iat = now,
            exp = now + 60,
            jti = Guid.NewGuid().ToString("N")
        }));
        var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body));
        return body + "." + Encode(signature);
    }

    private static bool TryRequiredString(JsonElement row, string name, int maxLength, out string value)
    {
        value = "";
        if (!row.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String) return false;
        value = element.GetString() ?? "";
        return value.Length is > 0 && value.Length <= maxLength;
    }

    private static bool TryOptionalString(JsonElement row, string name, int maxLength, out string? value)
    {
        value = null;
        if (!row.TryGetProperty(name, out var element) || element.ValueKind == JsonValueKind.Null) return true;
        if (element.ValueKind != JsonValueKind.String) return false;
        value = element.GetString();
        return value is not null && value.Length is > 0 && value.Length <= maxLength;
    }

    private static string Encode(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record ScheduleMilestoneReadResult(bool Available, IReadOnlyList<CalendarScheduleMilestone> Items)
{
    public static ScheduleMilestoneReadResult Empty { get; } = new(true, []);
    public static ScheduleMilestoneReadResult Unavailable { get; } = new(false, []);
}

public sealed record CalendarScheduleMilestone(
    string MilestoneId,
    int OccurrenceIndex,
    string Type,
    string Title,
    DateOnly Date,
    string? ProjectId,
    string? ProjectName)
{
    public string TypeLabel => Type switch
    {
        "review" => "검수",
        "update" => "업데이트",
        "prototype" => "프로토타입",
        _ => "주요 일정"
    };
}
