using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using LeaveManager.Models;
using LeaveManager.Pages.Leave;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    const long ExternalEmployeeId = 9007199254740993L;
    const long ExternalId = 9007199254740995L;

    static async Task SeedExternal(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        db.Employees.Add(new Employee { Id = ExternalEmployeeId, Name = "외부 일정 검증 직원", Email = "external-calendar@example.test", HireDate = new(2025, 1, 1) });
        db.ExternalSchedules.Add(new ExternalSchedule { Id = ExternalId, EmployeeId = ExternalEmployeeId, StartDate = s.Start, EndDate = s.Start.AddDays(2), Category = "출장", Memo = "기존 메모" });
        await db.SaveChangesAsync();
    }
    static async Task<List<ExternalSchedule>> ExternalStored(ApplicationSetup s)
    {
        using var scope = s.Leave.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().ExternalSchedules.AsNoTracking().ToListAsync();
    }
    static async Task<HttpResponseMessage> ExternalPost(ApplicationSetup s, bool delete = false, long? id = null,
        Dictionary<string, string>? changes = null, bool enhanced = true, bool baseline = true, bool csrf = true, string? duplicate = null)
    {
        var fields = new Dictionary<string, string> {
            [delete ? "id" : "ExternalInput.Id"] = id?.ToString(CultureInfo.InvariantCulture) ?? "",
            ["ExternalInput.EmployeeId"] = ExternalEmployeeId.ToString(CultureInfo.InvariantCulture),
            ["ExternalInput.StartDate"] = s.Start.ToString("yyyy-MM-dd"), ["ExternalInput.EndDate"] = s.Start.AddDays(1).ToString("yyyy-MM-dd"),
            ["ExternalInput.Category"] = "  외근  ", ["ExternalInput.Memo"] = "  수정한 검증 메모  ",
            ["SelfOnly"] = "false", ["ShowOthers"] = "false", ["RequestLimit"] = "20", ["RequestPage"] = "1"
        };
        if (baseline) {
            fields["expectedEmployeeId"] = s.Owner;
            var prior = (await ExternalStored(s)).SingleOrDefault(x => x.Id == id);
            fields["expectedSnapshot"] = prior is null ? "" : IndexModel.ExternalScheduleFingerprint(prior);
        }
        if (changes is not null) foreach (var (key, value) in changes) fields[key] = value;
        if (csrf) {
            var html = await s.Client.GetStringAsync("/Leave");
            fields["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        }
        var data = fields.ToList();
        if (duplicate is not null) data.Add(new(duplicate, fields[duplicate]));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/Leave?handler=ExternalSchedule" + (delete ? "Delete" : "Save")) { Content = new FormUrlEncodedContent(data) };
        if (enhanced) request.Headers.Add("Accept", NotificationMedia);
        return await s.Client.SendAsync(request);
    }

    [Fact]
    public async Task ExternalScheduleRazorConnectsRealSnapshotsAndNativeForms()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            db.ExternalSchedules.Add(new ExternalSchedule { Id = ExternalId + 2, EmployeeId = ExternalEmployeeId, StartDate = s.Start, EndDate = s.Start, Category = "기타", Memo = "두 번째 일정" }); await db.SaveChangesAsync();
        }
        var html = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}");
        var item = (await ExternalStored(s)).Single(x => x.Id == ExternalId); var snapshot = IndexModel.ExternalScheduleFingerprint(item);
        Assert.Contains("data-snapshot=\"" + snapshot + "\"", html); Assert.Contains("leave-external-schedules.js", html);
        foreach (var id in new[] { "externalScheduleForm", "externalScheduleDeleteForm" }) {
            var form = Regex.Match(html, "<form[^>]*id=\"" + id + "\"[^>]*>(.*?)</form>", RegexOptions.Singleline).Groups[1].Value;
            Assert.Contains("name=\"expectedEmployeeId\"", form); Assert.Contains("name=\"expectedSnapshot\"", form); Assert.Contains("__RequestVerificationToken", form);
        }
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return;
        Directory.CreateDirectory(output); await File.WriteAllTextAsync(Path.Combine(output, "leave.external-schedules.html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.external-schedules.json"), JsonSerializer.Serialize(new { start = s.Start.ToString("yyyy-MM-dd"), snapshot, context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }

    [Fact]
    public async Task ExternalScheduleConfirmsCreateUpdateDeleteWithLosslessIdsAndRoundTripBaseline()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        var old = (await ExternalStored(s)).Single(); var previous = IndexModel.ExternalScheduleFingerprint(old);
        using var create = await ExternalPost(s);
        var created = (await NotificationReceipt(create)).GetProperty("data");
        Assert.Equal("create", created.GetProperty("mode").GetString());
        Assert.Equal("", created.GetProperty("previousSnapshot").GetString());
        Assert.Equal(s.Owner, created.GetProperty("actorEmployeeId").GetString());
        var newId = long.Parse(created.GetProperty("id").GetString()!, CultureInfo.InvariantCulture);
        Assert.True(newId > ExternalId);
        Assert.Equal(IndexModel.ExternalScheduleFingerprint((await ExternalStored(s)).Single(x => x.Id == newId)), created.GetProperty("snapshot").GetString());
        // The saved receipt's baseline must work on a later request (SQLite DateTime.Kind round trip).
        using var update = await ExternalPost(s, id: newId, changes: new() { ["expectedSnapshot"] = created.GetProperty("snapshot").GetString()!, ["ExternalInput.Memo"] = "두 번째 메모" });
        var updated = (await NotificationReceipt(update)).GetProperty("data");
        Assert.Equal("ExternalScheduleSave", updated.GetProperty("operation").GetString());
        Assert.Equal("update", updated.GetProperty("mode").GetString());
        Assert.Equal(ExternalEmployeeId.ToString(), updated.GetProperty("input").GetProperty("employeeId").GetString());
        Assert.Equal("외근", updated.GetProperty("input").GetProperty("category").GetString());
        Assert.Equal("두 번째 메모", updated.GetProperty("input").GetProperty("memo").GetString());
        Assert.Equal(s.Start.ToString("yyyy-MM-dd"), updated.GetProperty("input").GetProperty("startDate").GetString());
        Assert.Equal(s.Start.AddDays(1).ToString("yyyy-MM-dd"), updated.GetProperty("input").GetProperty("endDate").GetString());
        var route = updated.GetProperty("navigateTo").GetString(); Assert.StartsWith("/Leave/Index?", route); Assert.Contains("RequestLimit=20", route);
        using var delete = await ExternalPost(s, delete: true, id: newId, changes: new() { ["expectedSnapshot"] = updated.GetProperty("snapshot").GetString()! });
        var deleted = (await NotificationReceipt(delete)).GetProperty("data");
        Assert.Equal("ExternalScheduleDelete", deleted.GetProperty("operation").GetString()); Assert.Equal("delete", deleted.GetProperty("mode").GetString()); Assert.Equal("", deleted.GetProperty("snapshot").GetString());
        Assert.Equal("두 번째 메모", deleted.GetProperty("input").GetProperty("memo").GetString());
        Assert.Equal(previous, IndexModel.ExternalScheduleFingerprint(Assert.Single(await ExternalStored(s)))); Assert.Empty(await s.Stored());
        using var scope = s.Leave.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        Assert.Equal(new[] { "ExternalScheduleCreated", "ExternalScheduleUpdated", "ExternalScheduleDeleted" }, await db.AuditLogs.Where(x => x.TargetType == "ExternalSchedule").OrderBy(x => x.Id).Select(x => x.Action).ToArrayAsync());
    }

    [Fact]
    public async Task ExternalScheduleRejectsMalformedUpdateInsteadOfCreatingAndValidatesOnlyItsOwnFields()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        foreach (var changes in new Dictionary<string, string>[] {
            new() { ["ExternalInput.Id"] = "not-a-number" }, new() { ["ExternalInput.Id"] = "0" }, new() { ["ExternalInput.Id"] = "-1" },
            new() { ["ExternalInput.StartDate"] = "invalid" }, new() { ["ExternalInput.EndDate"] = s.Start.AddDays(-1).ToString("yyyy-MM-dd") },
            new() { ["ExternalInput.Category"] = "unknown" }, new() { ["ExternalInput.Memo"] = " " }, new() { ["ExternalInput.Memo"] = new string('a', 501) },
            new() { ["ExternalInput.EmployeeId"] = "0" }, new() { ["ExternalInput.EmployeeId"] = "9223372036854775808" }
        }) Assert.Equal(HttpStatusCode.UnprocessableEntity, (await ExternalPost(s, changes: changes)).StatusCode);
        foreach (var key in new[] { "ExternalInput.Id", "ExternalInput.EmployeeId", "ExternalInput.StartDate", "ExternalInput.EndDate", "ExternalInput.Category", "ExternalInput.Memo" })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await ExternalPost(s, duplicate: key)).StatusCode);
        Assert.Single(await ExternalStored(s));
        // Apply/force form validation must not reject a valid external schedule submitted on the same Razor page.
        using var good = await ExternalPost(s, changes: new() { ["Input.Portion"] = "not-portion", ["ForceInput.Date"] = "invalid" });
        await NotificationReceipt(good); Assert.Equal(2, (await ExternalStored(s)).Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExternalScheduleEnforcesCsrfActorAndCurrentSnapshot(bool delete)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        foreach (var key in new[] { "expectedEmployeeId", "expectedSnapshot" }) {
            Assert.Equal(HttpStatusCode.Conflict, (await ExternalPost(s, delete, ExternalId, changes: new() { [key] = "wrong" })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await ExternalPost(s, delete, ExternalId, duplicate: key)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.Conflict, (await ExternalPost(s, delete, ExternalId, baseline: false)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ExternalPost(s, delete, ExternalId, csrf: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await ExternalPost(s, delete, ExternalId + 100)).StatusCode);
        var old = IndexModel.ExternalScheduleFingerprint(Assert.Single(await ExternalStored(s)));
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.ExternalSchedules.FindAsync(ExternalId))!.Memo = "다른 관리자의 수정"; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await ExternalPost(s, delete, ExternalId, changes: new() { ["expectedSnapshot"] = old })).StatusCode);
        Assert.Equal("다른 관리자의 수정", Assert.Single(await ExternalStored(s)).Memo);
    }

    [Fact]
    public async Task ExternalScheduleKeepsAdminAndEmployeeVisibilityPolicy()
    {
        await using var employee = await ApplicationSetup.Create(); await SeedExternal(employee);
        Assert.Equal(HttpStatusCode.Forbidden, (await ExternalPost(employee)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ExternalPost(employee, true, ExternalId)).StatusCode);
        Assert.Single(await ExternalStored(employee));
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        foreach (var kind in new[] { "shared", "master", "private", "inactive" }) {
            using (var scope = s.Leave.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); var target = (await db.Employees.FindAsync(ExternalEmployeeId))!;
                target.IsSharedAccount = kind == "shared"; target.IsCompanyMaster = kind == "master"; target.IsPrivate = kind == "private"; target.IsActive = kind != "inactive"; await db.SaveChangesAsync();
            }
            // Historical external schedules permit inactive employees; private employees are admin-visible.
            Assert.Equal(kind is "shared" or "master" ? HttpStatusCode.UnprocessableEntity : HttpStatusCode.OK, (await ExternalPost(s)).StatusCode);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExternalScheduleAuditFailureIsUnknownAfterBusinessCommit(bool delete)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER external_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-external-canary'); END;");
        }
        using var failure = await ExternalPost(s, delete, ExternalId);
        Assert.Equal(HttpStatusCode.InternalServerError, failure.StatusCode); Assert.True(failure.Headers.CacheControl?.NoStore);
        var text = await failure.Content.ReadAsStringAsync(); Assert.DoesNotContain("private-external-canary", text);
        Assert.Equal("unknown", JsonDocument.Parse(text).RootElement.GetProperty("outcome").GetString());
        if (delete) Assert.Empty(await ExternalStored(s)); else Assert.Equal("수정한 검증 메모", Assert.Single(await ExternalStored(s)).Memo);
    }

    [Fact]
    public async Task ExternalScheduleMalformedDeleteAndSaveFailureCannotChangeOtherRows()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        foreach (var value in new[] { "", "bad-id", "0", "-1", "9223372036854775808" })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await ExternalPost(s, true, ExternalId, changes: new() { ["id"] = value })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await ExternalPost(s, true, ExternalId, duplicate: "id")).StatusCode);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER external_update_test_error BEFORE UPDATE ON ExternalSchedules BEGIN SELECT RAISE(ABORT,'private-save-canary'); END;");
        }
        using var response = await ExternalPost(s, id: ExternalId);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.DoesNotContain("private-save-canary", await response.Content.ReadAsStringAsync());
        Assert.Equal("기존 메모", Assert.Single(await ExternalStored(s)).Memo);
    }

    [Fact]
    public void ExternalScheduleFingerprintCoversBusinessAndVersionFieldsWithoutDateTimeKindDrift()
    {
        var item = new ExternalSchedule { Id = ExternalId, EmployeeId = ExternalEmployeeId, StartDate = new(2026, 9, 10), EndDate = new(2026, 9, 12), Category = "출장", Memo = "메모", CreatedByEmployeeId = 1, UpdatedByEmployeeId = 2 };
        var json = JsonSerializer.Serialize(item);
        var baseline = IndexModel.ExternalScheduleFingerprint(item);
        foreach (Action<ExternalSchedule> change in new Action<ExternalSchedule>[] {
            x => x.Id++, x => x.EmployeeId++, x => x.StartDate = x.StartDate.AddDays(1), x => x.EndDate = x.EndDate.AddDays(1),
            x => x.Category = "외근", x => x.Memo += "변경", x => x.CreatedByEmployeeId++, x => x.UpdatedByEmployeeId++,
            x => x.CreatedAtUtc = x.CreatedAtUtc.AddTicks(1), x => x.UpdatedAtUtc = x.UpdatedAtUtc.AddTicks(1)
        }) {
            var changed = JsonSerializer.Deserialize<ExternalSchedule>(json)!; change(changed);
            Assert.NotEqual(baseline, IndexModel.ExternalScheduleFingerprint(changed));
        }
        item.CreatedAtUtc = DateTime.SpecifyKind(item.CreatedAtUtc, DateTimeKind.Unspecified);
        item.UpdatedAtUtc = DateTime.SpecifyKind(item.UpdatedAtUtc, DateTimeKind.Unspecified);
        Assert.Equal(baseline, IndexModel.ExternalScheduleFingerprint(item));
    }

    [Fact]
    public async Task ExternalScheduleNativeCompatibilityAndEncodedFailureDraft()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        using var saved = await ExternalPost(s, id: ExternalId, enhanced: false, baseline: false); Assert.Equal(HttpStatusCode.Redirect, saved.StatusCode);
        using var deleted = await ExternalPost(s, true, ExternalId, enhanced: false, baseline: false); Assert.Equal(HttpStatusCode.Redirect, deleted.StatusCode);
        using var failed = await ExternalPost(s, enhanced: false, changes: new() { ["ExternalInput.Id"] = "bad-id", ["ExternalInput.Memo"] = "<script>window.injected=true</script>", ["privateCredential"] = "must-not-be-copied" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, failed.StatusCode); Assert.True(failed.Headers.CacheControl?.NoStore);
        var html = await failed.Content.ReadAsStringAsync(); Assert.DoesNotContain("<script>window.injected", html); Assert.DoesNotContain("must-not-be-copied", html);
        Assert.DoesNotContain("id=\"externalScheduleForm\"", html); Assert.DoesNotContain("id=\"externalScheduleDeleteForm\"", html);
        var raw = WebUtility.HtmlDecode(Regex.Match(html, "<pre>(.*?)</pre>", RegexOptions.Singleline).Groups[1].Value);
        Assert.DoesNotContain("__RequestVerificationToken", raw); Assert.DoesNotContain("expectedEmployeeId", raw);
        Assert.Equal("bad-id", JsonDocument.Parse(raw).RootElement.GetProperty("ExternalInput.Id")[0].GetString());
        Assert.Empty(await ExternalStored(s));
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return;
        Directory.CreateDirectory(output); await File.WriteAllTextAsync(Path.Combine(output, "leave.external-recovery.html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.external-recovery.json"), JsonSerializer.Serialize(new { context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }
}
