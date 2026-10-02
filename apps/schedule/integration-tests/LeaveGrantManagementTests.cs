using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    [Fact]
    public async Task GrantManagementCommonEditorRendersRealRowsAndExportsCatalogFixtures()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        const long otherId = 9007199254741011;
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            db.Employees.Add(new() { Id = otherId, Name = "다른 검증 직원", Email = "other-grant@example.test", HireDate = new(2024, 3, 1), IsPrivate = true });
            db.LeaveGrants.AddRange(new LeaveGrant { Id = SettlementGrantId, EmployeeId = ExternalEmployeeId, GrantType = LeaveGrantType.Manual, GrantedDate = GrantManagementDate, ExpiresDate = new(2025, 2, 27), GrantedDays = 10.5m, Note = "기존 보정 메모" },
                new LeaveGrant { Id = SettlementGrantId + 2, EmployeeId = ExternalEmployeeId, GrantType = LeaveGrantType.Imported, GrantedDate = GrantManagementDate, ExpiresDate = new(2025, 2, 27), GrantedDays = -2.5m, Note = "기존 추가 메모" },
                new LeaveGrant { Id = SettlementGrantId + 4, EmployeeId = otherId, GrantType = LeaveGrantType.Manual, GrantedDate = new(2024, 3, 1), ExpiresDate = new(2025, 2, 28), GrantedDays = 3.5m, Note = "다른 직원 발생분" });
            await db.SaveChangesAsync();
        }
        var html = await s.Client.GetStringAsync($"/Admin/Adjustments?employeeId={ExternalEmployeeId}");
        foreach (var marker in new[] { "leave-grants.js", "leave-grants-contract.js", "cw-form-fields", "cw-form-control", "cw-data-table", "data-grant-initial", "data-grant-row-template", "data-grant-filter", "data-grant-form=\"Adjust\"", "data-grant-form=\"AddGrant\"", "data-grant-form=\"DeleteGrant\"" }) Assert.Contains(marker, html);
        Assert.DoesNotContain("return confirm(", html); Assert.DoesNotContain("this.form.submit()", html);
        var catalog = await GrantCatalog(s); var other = await s.Client.GetFromJsonAsync<JsonElement>($"/Admin/Adjustments?handler=Baseline&employeeId={otherId}");
        Assert.Equal(2, catalog.GetProperty("grants").GetArrayLength()); Assert.True(catalog.GetProperty("canDelete").GetBoolean()); Assert.True(catalog.GetProperty("reasonRequired").GetBoolean());
        Assert.All(catalog.GetProperty("grants").EnumerateArray(), row => { Assert.Equal("0", row.GetProperty("allocated").GetString()); Assert.Equal("0", row.GetProperty("settled").GetString()); Assert.Equal(row.GetProperty("grant").GetProperty("days").GetString(), row.GetProperty("remaining").GetString()); });
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"] = "false";
        var optional = await s.Client.GetStringAsync($"/Admin/Adjustments?employeeId={ExternalEmployeeId}"); Assert.DoesNotContain("required=", Regex.Match(optional, "<input[^>]*name=\"Note\"[^>]*>").Value);
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return; Directory.CreateDirectory(output);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.grants.html"), html); await File.WriteAllTextAsync(Path.Combine(output, "leave.grants.optional.html"), optional);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.grants.json"), JsonSerializer.Serialize(new { catalog, other, employee = ExternalEmployeeId.ToString(), otherEmployee = otherId.ToString(), grant = SettlementGrantId.ToString(), otherGrant = (SettlementGrantId + 4).ToString(), context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }
    [Fact]
    public async Task GrantManagementInitialCatalogEscapesStoredTextWithoutLosingValues()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        const string text = "</script><script data-grant-probe>alert('test')</script> & \"직원\"";
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.SingleAsync(x => x.Id == ExternalEmployeeId)).Name = text;
            db.LeaveGrants.Add(new() { Id = SettlementGrantId, EmployeeId = ExternalEmployeeId, GrantType = LeaveGrantType.Manual, GrantedDate = GrantManagementDate, ExpiresDate = new(2025, 2, 27), GrantedDays = 1.5m, Note = text });
            await db.SaveChangesAsync();
        }
        var html = await s.Client.GetStringAsync($"/Admin/Adjustments?employeeId={ExternalEmployeeId}");
        Assert.DoesNotContain("<script data-grant-probe>", html);
        var match = Regex.Match(html, "<script[^>]*data-grant-initial[^>]*>(.*?)</script>", RegexOptions.Singleline);
        Assert.True(match.Success); Assert.DoesNotContain("<", match.Groups[1].Value);
        using var json = JsonDocument.Parse(match.Groups[1].Value);
        Assert.Equal(text, json.RootElement.GetProperty("employeeName").GetString());
        var grant = json.RootElement.GetProperty("grants")[0].GetProperty("grant");
        Assert.Equal(SettlementGrantId.ToString(), grant.GetProperty("id").GetString());
        Assert.Equal(text, grant.GetProperty("note").GetString());
    }
    static readonly DateOnly GrantManagementDate = new(2024, 2, 29);
    static async Task<JsonElement> GrantCatalog(ApplicationSetup s)
    {
        using var response = await s.Client.GetAsync($"/Admin/Adjustments?handler=Baseline&employeeId={ExternalEmployeeId}");
        response.EnsureSuccessStatusCode(); Assert.True(response.Headers.CacheControl?.NoStore);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }
    static async Task<List<LeaveGrant>> ManagedGrants(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().LeaveGrants.AsNoTracking()
            .Where(x => x.EmployeeId == ExternalEmployeeId && x.GrantedDate == GrantManagementDate).ToListAsync();
    }
    static async Task<HttpResponseMessage> GrantPost(ApplicationSetup s, string operation = "Adjust", Dictionary<string,string>? changes = null,
        JsonElement? catalog = null, bool enhanced = true, bool baseline = true, bool csrf = true, string? duplicate = null)
    {
        var values = operation switch {
            "Adjust" => new Dictionary<string,string> { ["EmployeeId"] = ExternalEmployeeId.ToString(), ["Days"] = "-1.50", ["EffectiveDate"] = "2024-02-29", ["Note"] = "  과거 기록 보정  " },
            "AddGrant" => new() { ["AddEmployeeId"] = ExternalEmployeeId.ToString(), ["AddGrantType"] = "Imported", ["AddDays"] = "-2.50", ["AddGrantedDate"] = "2024-02-29", ["AddExpiresDate"] = "", ["AddNote"] = "  과거 기록 추가  " },
            _ => new() { ["grantId"] = (await ManagedGrants(s)).Single().Id.ToString(), ["DeleteGrantReason"] = "  잘못 생성한 기록  " }
        };
        if (changes is not null) foreach (var pair in changes) values[pair.Key] = pair.Value;
        if (baseline) {
            var data = catalog ?? await GrantCatalog(s);
            values.TryAdd("expectedEmployeeId", s.Owner); values.TryAdd("expectedEmployeeSnapshot", data.GetProperty("employeeSnapshot").GetString()!);
            var rows = data.GetProperty("grants").EnumerateArray().Where(row => {
                var grant = row.GetProperty("grant");
                return operation == "DeleteGrant" ? grant.GetProperty("id").GetString() == values["grantId"] :
                    grant.GetProperty("type").GetString() == (operation == "Adjust" ? "Manual" : values["AddGrantType"]) &&
                    grant.GetProperty("grantedDate").GetString() == values[operation == "Adjust" ? "EffectiveDate" : "AddGrantedDate"];
            }).ToArray();
            values.TryAdd("expectedSnapshot", rows.Length == 0 ? "" : rows.Single().GetProperty("snapshot").GetString()!);
        }
        if (csrf) {
            var html = await s.Client.GetStringAsync("/Leave");
            values["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        }
        var fields = values.ToList(); if (duplicate is not null) fields.Add(new(duplicate, values[duplicate]));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Admin/Adjustments" + (operation == "Adjust" ? "" : "?handler=" + operation)) { Content = new FormUrlEncodedContent(fields) };
        if (enhanced) request.Headers.Add("Accept", NotificationMedia);
        return await s.Client.SendAsync(request);
    }
    [Fact]
    public async Task GrantManagementAdjustmentCreatesAndAggregatesSignedHistoricalDays()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using (var scope = s.Leave.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); var employee = await db.Employees.FindAsync(ExternalEmployeeId); employee!.IsActive = false; employee.IsPrivate = true; await db.SaveChangesAsync(); }
        var original = await GrantCatalog(s);
        using var response = await GrantPost(s, catalog: original);
        var data = (await NotificationReceipt(response)).GetProperty("data"); var grant = Assert.Single(await ManagedGrants(s));
        Assert.Equal(-1.5m, grant.GrantedDays); Assert.Equal(new DateOnly(2025, 2, 27), grant.ExpiresDate);
        Assert.Equal("Adjust", data.GetProperty("operation").GetString()); Assert.Equal(s.Owner, data.GetProperty("actorEmployeeId").GetString());
        Assert.Equal(ExternalEmployeeId.ToString(), data.GetProperty("employeeId").GetString()); Assert.Equal("", data.GetProperty("previousSnapshot").GetString());
        Assert.Equal("0", data.GetProperty("beforeDays").GetString()); Assert.Equal("-1.5", data.GetProperty("inputDays").GetString()); Assert.Equal("과거 기록 보정", data.GetProperty("reason").GetString());
        Assert.Equal(grant.Id.ToString(), data.GetProperty("grant").GetProperty("id").GetString()); Assert.Equal(grant.Note, data.GetProperty("grant").GetProperty("note").GetString());
        Assert.Equal($"/Admin/Adjustments?employeeId={ExternalEmployeeId}", data.GetProperty("navigateTo").GetString());
        Assert.Equal(original.GetProperty("employeeSnapshot").GetString(), data.GetProperty("employeeSnapshot").GetString());
        var next = await GrantCatalog(s); Assert.Equal(data.GetProperty("snapshot").GetString(), next.GetProperty("grants")[0].GetProperty("snapshot").GetString());
        Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, catalog: original)).StatusCode);
        using var second = await GrantPost(s, changes: new() { ["Days"] = "2" }); (await NotificationReceipt(second)).GetProperty("data");
        var updated = Assert.Single(await ManagedGrants(s)); Assert.Equal(grant.Id, updated.Id); Assert.Equal(.5m, updated.GrantedDays); Assert.StartsWith(grant.Note + Environment.NewLine, updated.Note);
        using var auditScope = s.Leave.Services.CreateScope(); var audits = await auditScope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().AuditLogs.Where(x => x.Action == "LeaveCountAdjusted").ToListAsync(); Assert.Equal(2, audits.Count);
    }
    [Theory]
    [InlineData("Manual")][InlineData("Monthly")][InlineData("Annual")][InlineData("CarriedOver")][InlineData("Imported")]
    public async Task GrantManagementAddPreservesAllTypesAndNegativeValues(string type)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using var response = await GrantPost(s, "AddGrant", new() { ["AddGrantType"] = type });
        var data = (await NotificationReceipt(response)).GetProperty("data"); var grant = Assert.Single(await ManagedGrants(s));
        Assert.Equal(type, grant.GrantType.ToString()); Assert.Equal(-2.5m, grant.GrantedDays); Assert.Equal(new DateOnly(2025, 2, 27), grant.ExpiresDate);
        Assert.Equal("AddGrant", data.GetProperty("operation").GetString()); Assert.Equal(type, data.GetProperty("grant").GetProperty("type").GetString()); Assert.False(data.GetProperty("grant").GetProperty("isImported").GetBoolean()); Assert.Equal(JsonValueKind.Null, data.GetProperty("grant").GetProperty("sourceGrantId").ValueKind);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GrantPost(s, "AddGrant", new() { ["AddGrantType"] = type })).StatusCode); Assert.Single(await ManagedGrants(s));
    }
    [Fact]
    public async Task GrantManagementRejectsNewBirthdayGrant()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using var response = await GrantPost(s, "AddGrant", new() { ["AddGrantType"] = "Birthday", ["AddDays"] = "1" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Empty(await ManagedGrants(s));
    }
    [Fact]
    public async Task GrantManagementDeleteConfirmsExactLargeIdAndDeletedBeforeImage()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using (var scope = s.Leave.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); db.LeaveGrants.Add(new() { Id = SettlementGrantId, EmployeeId = ExternalEmployeeId, GrantType = LeaveGrantType.Manual, GrantedDate = GrantManagementDate, ExpiresDate = GrantManagementDate.AddYears(1), GrantedDays = -3.5m, Note = "삭제 전 메모" }); await db.SaveChangesAsync(); }
        var catalog = await GrantCatalog(s); using var response = await GrantPost(s, "DeleteGrant", catalog: catalog);
        var data = (await NotificationReceipt(response)).GetProperty("data"); Assert.Empty(await ManagedGrants(s));
        Assert.Equal("DeleteGrant", data.GetProperty("operation").GetString()); Assert.Equal(SettlementGrantId.ToString(), data.GetProperty("grant").GetProperty("id").GetString()); Assert.Equal("삭제 전 메모", data.GetProperty("grant").GetProperty("note").GetString());
        Assert.Equal(catalog.GetProperty("grants")[0].GetProperty("snapshot").GetString(), data.GetProperty("previousSnapshot").GetString()); Assert.Equal("", data.GetProperty("snapshot").GetString());
        using var scope2 = s.Leave.Services.CreateScope(); Assert.Contains(await scope2.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().AuditLogs.ToListAsync(), x => x.Action == "LeaveGrantDeleted" && x.TargetId == SettlementGrantId.ToString() && x.Reason == "잘못 생성한 기록");
    }
    [Theory]
    [InlineData("allocation")][InlineData("settlement")]
    public async Task GrantManagementDeleteRetainsAllocationAndSettlementRestriction(string kind)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); (await GrantPost(s)).EnsureSuccessStatusCode(); var id = (await ManagedGrants(s)).Single().Id; var previous = await GrantCatalog(s);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            if (kind == "allocation") { var request = new LeaveRequest { EmployeeId = ExternalEmployeeId, Status = LeaveRequestStatus.Cancelled, Reason = "과거 배정", WorkPlan = "검증" }; db.LeaveRequests.Add(request); await db.SaveChangesAsync(); db.LeaveAllocations.Add(new() { LeaveRequestId = request.Id, LeaveGrantId = id, Days = .5m }); }
            else db.LeaveSettlements.Add(new() { EmployeeId = ExternalEmployeeId, SourceGrantId = id, Type = LeaveSettlementType.Expiration, Days = .5m, ProcessedDate = AppTime.Today, ProcessedByEmployeeId = long.Parse(s.Owner) });
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, "DeleteGrant", catalog: previous)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GrantPost(s, "DeleteGrant")).StatusCode); Assert.Single(await ManagedGrants(s));
    }
    [Fact]
    public async Task GrantManagementValidatesOwnFieldsIdentityMultiplicityAndCsrfBeforeWriting()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        Assert.Equal(HttpStatusCode.BadRequest, (await GrantPost(s, csrf: false)).StatusCode); Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, baseline: false)).StatusCode);
        foreach (var key in new[] { "expectedEmployeeId", "expectedEmployeeSnapshot", "expectedSnapshot" }) { Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, changes: new() { [key] = "bad" })).StatusCode); Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, duplicate: key)).StatusCode); }
        foreach (var key in new[] { "EmployeeId", "Days", "EffectiveDate", "Note" }) Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GrantPost(s, duplicate: key)).StatusCode);
        foreach (var changes in new Dictionary<string,string>[] { new() { ["EmployeeId"] = "bad" }, new() { ["EmployeeId"] = "9223372036854775808" }, new() { ["Days"] = "bad" }, new() { ["Days"] = "0" }, new() { ["Days"] = "0.1" }, new() { ["Note"] = " " }, new() { ["EffectiveDate"] = "bad" }, new() { ["EffectiveDate"] = "9999-01-01" } })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GrantPost(s, changes: changes)).StatusCode);
        foreach (var changes in new Dictionary<string,string>[] { new() { ["AddGrantType"] = "999" }, new() { ["AddGrantType"] = "bad" }, new() { ["AddGrantedDate"] = "" }, new() { ["AddExpiresDate"] = "bad" }, new() { ["AddExpiresDate"] = "2023-01-01" }, new() { ["AddGrantedDate"] = "9999-01-01" }, new() { ["AddDays"] = "0.1" } })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GrantPost(s, "AddGrant", changes)).StatusCode);
        Assert.Empty(await ManagedGrants(s));
        // Unrelated form fields must not invalidate this operation's model binding.
        (await GrantPost(s, changes: new() { ["AddDays"] = "not-a-number" })).EnsureSuccessStatusCode(); Assert.Single(await ManagedGrants(s));
    }
    [Fact]
    public async Task GrantManagementEmployeeChangeInvalidatesPreviouslyReadBaseline()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); var catalog = await GrantCatalog(s);
        using (var scope = s.Leave.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); (await db.Employees.FindAsync(ExternalEmployeeId))!.HireDate = new(2025, 3, 1); await db.SaveChangesAsync(); }
        Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, catalog: catalog)).StatusCode); Assert.Empty(await ManagedGrants(s));
        (await GrantPost(s)).EnsureSuccessStatusCode();
    }
    [Theory]
    [InlineData("Adjust")][InlineData("AddGrant")][InlineData("DeleteGrant")]
    public async Task GrantManagementAuditFailureIsUnknownAfterActualBusinessWrite(string operation)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        if (operation == "DeleteGrant") (await GrantPost(s)).EnsureSuccessStatusCode();
        using (var scope = s.Leave.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER grant_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-grant-canary'); END;"); }
        using var response = await GrantPost(s, operation); Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync(); Assert.DoesNotContain("private-grant-canary", body); Assert.Equal("unknown", JsonDocument.Parse(body).RootElement.GetProperty("outcome").GetString());
        if (operation == "DeleteGrant") Assert.Empty(await ManagedGrants(s)); else Assert.Single(await ManagedGrants(s));
    }
    [Fact]
    public async Task GrantManagementNativeRecoveryEncodesAllowlistedDraftAndPreservesOptionalReasonPolicy()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using var response = await GrantPost(s, changes: new() { ["EffectiveDate"] = "9999-01-01", ["Note"] = "<script>injected()</script>", ["unlistedSecret"] = "must-not-echo" }, enhanced: false, baseline: false);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode); var html = await response.Content.ReadAsStringAsync(); Assert.Contains("data-locked=\"true\"", html); Assert.DoesNotContain("<script>injected()", html); Assert.DoesNotContain("must-not-echo", html); Assert.DoesNotContain("class=\"form adjustment-form\"", html);
        var raw = WebUtility.HtmlDecode(Regex.Match(html, "<pre class=\"adjustment-raw-draft\">(.*?)</pre>", RegexOptions.Singleline).Groups[1].Value); Assert.DoesNotContain("__RequestVerificationToken", raw); Assert.Equal("<script>injected()</script>", JsonDocument.Parse(raw).RootElement.GetProperty("Note")[0].GetString());
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"] = "false";
        using var success = await GrantPost(s, changes: new() { ["Note"] = " " }, enhanced: false, baseline: false); success.EnsureSuccessStatusCode(); Assert.Contains("사유 미입력", Assert.Single(await ManagedGrants(s)).Note);
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return; Directory.CreateDirectory(output); await File.WriteAllTextAsync(Path.Combine(output, "leave.adjustment-recovery.html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.adjustment-recovery.json"), JsonSerializer.Serialize(new { context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }
    [Fact]
    public async Task GrantManagementBaselineAndWritesRespectPageAuthorizationAndExcludedTargets()
    {
        await using var user = await ApplicationSetup.Create(); await SeedExternal(user);
        Assert.False((await user.Client.GetAsync($"/Admin/Adjustments?handler=Baseline&employeeId={ExternalEmployeeId}")).IsSuccessStatusCode);
        Assert.False((await GrantPost(user, enhanced: false, baseline: false)).IsSuccessStatusCode); Assert.Empty(await ManagedGrants(user));
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); var catalog = await GrantCatalog(s);
        foreach (var master in new[] { false, true }) {
            using (var scope = s.Leave.Services.CreateScope()) { var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); var e = (await db.Employees.FindAsync(ExternalEmployeeId))!; e.IsSharedAccount = !master; e.IsCompanyMaster = master; await db.SaveChangesAsync(); }
            Assert.Equal(HttpStatusCode.NotFound, (await s.Client.GetAsync($"/Admin/Adjustments?handler=Baseline&employeeId={ExternalEmployeeId}")).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await GrantPost(s, catalog: catalog)).StatusCode);
        }
        Assert.Empty(await ManagedGrants(s));
    }
}
