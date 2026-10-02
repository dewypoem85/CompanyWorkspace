using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    const string HolidayMedia = "application/vnd.company.workspace-form+json";
    const string HolidayJson = "[ {\"date\":\"2026-01-01\",\"name\":\"새 이름\"}, {\"date\":\"2026-03-01\",\"name\":\" A \"}, {\"date\":\"2026-03-01\",\"name\":\"B\"}, {\"date\":\"2026-03-01\",\"name\":\"A\"}, {\"date\":\"2027-01-01\",\"name\":\"제외\"} ]";

    sealed class HolidayFactory(ContractFactory<CompanyUser> portal) : LeaveFactory(portal)
    {
        public HttpStatusCode OnlineStatus { get; set; } = HttpStatusCode.OK;
        public string OnlineBody { get; set; } = "[{\"date\":\"2026-05-05\",\"localName\":\"어린이날\"}]";
        public Func<Task>? BeforeReply { get; set; }
        public int Reads { get; set; }
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.AddHttpClient(string.Empty).ConfigurePrimaryHttpMessageHandler(() => new HolidayRelay(this)));
        }
    }

    sealed class HolidayRelay(HolidayFactory owner) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("https://date.nager.at/api/v3/PublicHolidays/2026/KR", request.RequestUri!.ToString());
            owner.Reads++;
            if (owner.BeforeReply is {} callback) await callback();
            return new(owner.OnlineStatus) { Content = new StringContent(owner.OnlineBody) };
        }
    }

    sealed class HolidaySetup : IAsyncDisposable
    {
        public ContractFactory<CompanyUser> Portal { get; } = new();
        public HolidayFactory Leave { get; private set; } = null!;
        public HttpClient Client { get; private set; } = null!;
        public HttpClient PortalClient { get; private set; } = null!;

        public static async Task<HolidaySetup> Create()
        {
            var s = new HolidaySetup();
            s.PortalClient = s.Portal.CreateClient(Options);
            s.Leave = new(s.Portal);
            s.Client = s.Leave.CreateClient(Options);
            await Connect(s.Portal, s.PortalClient, s.Client, "admin");
            using var scope = s.Leave.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            db.Holidays.AddRange(new Holiday { Id = 9007199254740993, Date = new(2026, 1, 1), Name = "기존 <script>bad()</script>" },
                new Holiday { Id = 9007199254740994, Date = new(2027, 1, 1), Name = "다른 연도" });
            await db.SaveChangesAsync();
            return s;
        }

        public Task<string> Html() => Client.GetStringAsync("/Admin/Holidays?Year=2026");
        public static JsonElement Snapshot(string html) => JsonDocument.Parse(Regex.Match(html, "data-holiday-snapshot>(.*?)</script>", RegexOptions.Singleline).Groups[1].Value).RootElement.Clone();

        public async Task<HttpResponseMessage> Post(string operation, Dictionary<string, string>? changes = null, bool enhanced = true, bool csrf = true, bool baseline = true, KeyValuePair<string, string>[]? extraFields = null)
        {
            var html = await Html();
            var snapshot = Snapshot(html);
            var fields = new Dictionary<string, string>
            {
                ["Year"] = "2026", ["Input.Date"] = "2026-02-01", ["Input.Name"] = " 신규 휴일 ",
                ["Import.Year"] = "2026", ["Import.OverwriteExisting"] = "false", ["Import.JsonText"] = HolidayJson,
                ["id"] = "9007199254740993"
            };
            if (baseline)
            {
                fields["expectedEmployeeId"] = snapshot.GetProperty("actorEmployeeId").GetString()!;
                fields["expectedStateToken"] = snapshot.GetProperty("stateToken").GetString()!;
            }
            if (csrf) fields["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
            if (changes is not null) foreach (var field in changes) fields[field.Key] = field.Value;
            using var request = new HttpRequestMessage(HttpMethod.Post, "/Admin/Holidays?handler=" + operation) { Content = new FormUrlEncodedContent(fields.Concat(extraFields ?? [])) };
            if (enhanced) request.Headers.Add("Accept", HolidayMedia);
            return await Client.SendAsync(request);
        }

        public async Task<List<Holiday>> Stored()
        {
            using var scope = Leave.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Holidays.AsNoTracking().OrderBy(x => x.Date).ToListAsync();
        }
        public async ValueTask DisposeAsync() { Client.Dispose(); PortalClient.Dispose(); await Leave.DisposeAsync(); await Portal.DisposeAsync(); }
    }

    static async Task<JsonElement> HolidayReceipt(HttpResponseMessage response)
    {
        using (response)
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(HolidayMedia, response.Content.Headers.ContentType!.MediaType);
            Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
            var json = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("workspace-form-v1", json.GetProperty("protocol").GetString());
            Assert.Equal("saved", json.GetProperty("outcome").GetString());
            return json;
        }
    }

    [Fact]
    public async Task HolidayFormsPreserveCrossYearBaselineExactIdsAndUpsertRules()
    {
        await using var s = await HolidaySetup.Create();
        var html = await s.Html(); var initial = HolidaySetup.Snapshot(html);
        Assert.DoesNotContain("<script>bad()", html);
        Assert.Equal(2, initial.GetProperty("items").GetArrayLength());
        var add = await HolidayReceipt(await s.Post("Add"));
        var data = add.GetProperty("data");
        Assert.Equal(initial.GetProperty("stateToken").GetString(), data.GetProperty("previousStateToken").GetString());
        Assert.Equal("9007199254740995", data.GetProperty("snapshot").GetProperty("items")[1].GetProperty("id").GetString());
        Assert.Equal("신규 휴일", data.GetProperty("intent").GetProperty("name").GetString());
        var update = await HolidayReceipt(await s.Post("Add", new() { ["Input.Date"] = "2026-01-01", ["Input.Name"] = " 수정 " }));
        Assert.Equal("9007199254740993", update.GetProperty("data").GetProperty("snapshot").GetProperty("items")[0].GetProperty("id").GetString());
        var delete = await HolidayReceipt(await s.Post("Delete"));
        Assert.Equal("9007199254740993", delete.GetProperty("data").GetProperty("intent").GetProperty("id").GetString());
        Assert.Equal(2, (await s.Stored()).Count);
        Assert.Equal("다른 연도", (await s.Stored()).Last().Name);
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if (!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output, "leave.holiday.html"), html);
            await File.WriteAllTextAsync(Path.Combine(output, "leave.holiday.json"), JsonSerializer.Serialize(new { initial, add, update, delete,
                context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
        }
    }

    [Fact]
    public async Task HolidayJsonPreservesRawDigestNormalizationOverwriteAndCounts()
    {
        await using var s = await HolidaySetup.Create();
        var skipReceipt = await HolidayReceipt(await s.Post("ImportJson"));
        var skip = skipReceipt.GetProperty("data");
        Assert.Equal(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(HolidayJson))), skip.GetProperty("intent").GetProperty("jsonHash").GetString());
        Assert.Equal(1, skip.GetProperty("counts").GetProperty("created").GetInt32());
        Assert.Equal(1, skip.GetProperty("counts").GetProperty("skipped").GetInt32());
        Assert.Equal("A / B", skip.GetProperty("applied")[1].GetProperty("name").GetString());
        Assert.StartsWith("기존", (await s.Stored())[0].Name);
        var overwriteReceipt = await HolidayReceipt(await s.Post("ImportJson", new() { ["Import.OverwriteExisting"] = "true" }));
        var overwrite = overwriteReceipt.GetProperty("data");
        Assert.Equal(1, overwrite.GetProperty("counts").GetProperty("updated").GetInt32());
        Assert.Equal(1, overwrite.GetProperty("counts").GetProperty("skipped").GetInt32());
        Assert.Equal("새 이름", (await s.Stored())[0].Name);
        Assert.Equal("다른 연도", (await s.Stored()).Last().Name);
        var repeatedReceipt = await HolidayReceipt(await s.Post("ImportJson"));
        var repeated = repeatedReceipt.GetProperty("data");
        Assert.Equal(0, repeated.GetProperty("counts").GetProperty("created").GetInt32());
        Assert.Equal(0, repeated.GetProperty("counts").GetProperty("updated").GetInt32());
        Assert.Equal(2, repeated.GetProperty("counts").GetProperty("skipped").GetInt32());
        Assert.Equal(repeated.GetProperty("previousStateToken").GetString(), repeated.GetProperty("snapshot").GetProperty("stateToken").GetString());
        var onlineReceipt = await HolidayReceipt(await s.Post("ImportOnline"));
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if (!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output, "leave.holiday.imports.json"), JsonSerializer.Serialize(new { raw = HolidayJson, skipReceipt, overwriteReceipt, repeatedReceipt, onlineReceipt }));
        }
    }

    [Theory]
    [InlineData("expectedEmployeeId", "999", "Add", 409)]
    [InlineData("expectedStateToken", "old", "Delete", 409)]
    [InlineData("id", "invalid", "Delete", 422)]
    [InlineData("id", "99", "Delete", 409)]
    [InlineData("Input.Date", "2026-02-31", "Add", 422)]
    [InlineData("Input.Name", " ", "Add", 422)]
    [InlineData("Import.Year", "invalid", "ImportOnline", 422)]
    [InlineData("Import.Year", "2101", "ImportJson", 422)]
    [InlineData("Import.OverwriteExisting", "invalid", "ImportOnline", 422)]
    [InlineData("Import.JsonText", "{private-json-canary", "ImportJson", 422)]
    [InlineData("Import.JsonText", "[]", "ImportJson", 422)]
    public async Task HolidayRejectedIntentNeverWrites(string field, string value, string operation, int status)
    {
        await using var s = await HolidaySetup.Create();
        using var response = await s.Post(operation, new() { [field] = value });
        Assert.Equal(status, (int)response.StatusCode);
        Assert.DoesNotContain("private-json-canary", await response.Content.ReadAsStringAsync());
        Assert.Equal(2, (await s.Stored()).Count); Assert.Equal(0, s.Leave.Reads);
    }

    [Theory]
    [InlineData("http")]
    [InlineData("json")]
    [InlineData("stale")]
    public async Task HolidayOnlineReadFailureAndChangedBaselineDoNotWrite(string failure)
    {
        await using var s = await HolidaySetup.Create();
        if (failure == "http") s.Leave.OnlineStatus = HttpStatusCode.ServiceUnavailable;
        if (failure == "json") s.Leave.OnlineBody = "private-online-canary";
        if (failure == "stale") s.Leave.BeforeReply = async () =>
        {
            using var scope = s.Leave.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Holidays.FirstAsync()).Name = "다른 관리자의 변경"; await db.SaveChangesAsync();
        };
        using var response = await s.Post("ImportOnline");
        Assert.Equal(failure == "stale" ? 409 : 422, (int)response.StatusCode);
        Assert.DoesNotContain("private-online-canary", await response.Content.ReadAsStringAsync());
        Assert.Equal(2, (await s.Stored()).Count); Assert.Equal(1, s.Leave.Reads);
    }

    [Fact]
    public async Task HolidayOnlineRetainsKoreanOriginalDatesAndReportsAppliedNames()
    {
        await using var s = await HolidaySetup.Create();
        var data = (await HolidayReceipt(await s.Post("ImportOnline"))).GetProperty("data");
        Assert.Equal(JsonValueKind.Null, data.GetProperty("intent").GetProperty("jsonHash").ValueKind);
        Assert.Contains(data.GetProperty("applied").EnumerateArray(), x => x.GetProperty("date").GetString() == "2026-05-05" && x.GetProperty("name").GetString() == "어린이날");
        Assert.Contains(await s.Stored(), x => x.Date == new DateOnly(2026, 12, 25) && x.Name == "성탄절");
        Assert.Equal(1, s.Leave.Reads);
    }

    [Theory]
    [InlineData("Add", true)]
    [InlineData("Delete", true)]
    [InlineData("ImportJson", true)]
    [InlineData("ImportOnline", true)]
    [InlineData("ImportJson", false)]
    public async Task HolidayAuditFailureIsUnknownAfterDatabaseCommit(string operation, bool enhanced)
    {
        await using var s = await HolidaySetup.Create();
        using (var scope = s.Leave.Services.CreateScope()) await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER holiday_audit_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-holiday-audit'); END;");
        using var response = await s.Post(operation, enhanced: enhanced);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("private-holiday-audit", body);
        if (enhanced) { Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode); Assert.Contains("unknown", body); }
        else
        {
            response.EnsureSuccessStatusCode(); Assert.Matches("<fieldset[^>]*data-holiday-fields[^>]*disabled", body); Assert.Contains("data-holiday-recheck", body);
            Assert.Equal(HolidayJson, WebUtility.HtmlDecode(Regex.Match(body, "<textarea[^>]*name=\"Import.JsonText\"[^>]*>(.*?)</textarea>", RegexOptions.Singleline).Groups[1].Value).TrimStart('\r', '\n'));
            var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
            if (!string.IsNullOrEmpty(output))
            {
                Directory.CreateDirectory(output);
                await File.WriteAllTextAsync(Path.Combine(output, "leave.holiday.unknown.html"), body);
            }
        }
        Assert.NotEqual(2, (await s.Stored()).Count);
    }

    [Fact]
    public async Task HolidayNativeCompatibilityAndCsrfRemainEnforced()
    {
        await using var s = await HolidaySetup.Create();
        using (var denied = await s.Post("Add", csrf: false)) Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using (var missing = await s.Post("Add", baseline: false)) Assert.Equal(HttpStatusCode.Conflict, missing.StatusCode);
        using (var native = await s.Post("Add", enhanced: false, baseline: false))
        {
            native.EnsureSuccessStatusCode(); Assert.Contains("추가했습니다", WebUtility.HtmlDecode(await native.Content.ReadAsStringAsync()));
        }
        Assert.Equal(3, (await s.Stored()).Count);
    }

    [Theory]
    [InlineData("Input.Name", "Add")]
    [InlineData("Import.Year", "ImportJson")]
    [InlineData("expectedEmployeeId", "ImportOnline")]
    public async Task HolidayDuplicateScalarFieldsAreRejected(string field, string operation)
    {
        await using var s = await HolidaySetup.Create();
        using var response = await s.Post(operation, extraFields: [new(field, "2026")]);
        Assert.Equal(field == "expectedEmployeeId" ? 409 : 422, (int)response.StatusCode);
        Assert.Equal(2, (await s.Stored()).Count); Assert.Equal(0, s.Leave.Reads);
    }

    [Fact]
    public async Task HolidayCheckedCheckboxWithNativeHiddenFalseIsAccepted()
    {
        await using var s = await HolidaySetup.Create();
        var data = (await HolidayReceipt(await s.Post("ImportJson", new() { ["Import.OverwriteExisting"] = "true" }, extraFields: [new("Import.OverwriteExisting", "false")]))).GetProperty("data");
        Assert.True(data.GetProperty("intent").GetProperty("overwriteExisting").GetBoolean());
        Assert.Equal("새 이름", (await s.Stored())[0].Name);
    }

    [Fact]
    public async Task HolidayServerRejectsEmployeePostHandlers()
    {
        await using var portal = new ContractFactory<CompanyUser>(); using var portalClient = portal.CreateClient(Options);
        await using var leave = new LeaveFactory(portal); using var client = leave.CreateClient(Options);
        await Connect(portal, portalClient, client, "employee");
        foreach (var operation in new[] { "Add", "Delete", "ImportOnline", "ImportJson" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/Admin/Holidays?handler=" + operation) { Content = new FormUrlEncodedContent(new Dictionary<string, string>()) };
            request.Headers.Add("Accept", HolidayMedia); request.Headers.Add("X-Requested-With", "XMLHttpRequest");
            using var response = await client.SendAsync(request); Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }
}
