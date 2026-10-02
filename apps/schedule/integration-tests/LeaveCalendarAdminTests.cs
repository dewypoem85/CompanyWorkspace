using System.Globalization;
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
    public async Task CalendarAdminRazorConnectsActorCompleteRequestAndCommonForms()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        var html = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}");
        var target = (await s.Stored()).Single(x => x.Id == 9007199254740995L);
        Assert.Contains("data-admin-target=\"", html); Assert.Contains("leave-calendar-admin.js", html); Assert.DoesNotContain("prompt('강제 삭제", html);
        Assert.Contains("<dialog class=\"cw-modal day-detail-modal\" id=\"dayDetailModal\" aria-labelledby=\"dayDetailTitle\">", html);
        Assert.Contains("data-day-detail-trigger", html); Assert.Contains("window.CompanyDialog.attach(detailModal,", html);
        Assert.DoesNotContain("day-detail-backdrop", html); Assert.DoesNotContain("role=\"dialog\"", html);
        foreach (var id in new[] { "adminForceAddForm", "adminForceDeleteForm" }) {
            var form = Regex.Match(html, "<form[^>]*id=\"" + id + "\"[^>]*>(.*?)</form>", RegexOptions.Singleline).Groups[1].Value;
            Assert.Contains("name=\"expectedEmployeeId\" value=\"" + s.Owner + "\"", form); Assert.Contains("name=\"expectedSnapshot\"", form); Assert.Contains("name=\"RequestPage\"", form); Assert.Contains("__RequestVerificationToken", form);
        }
        var chips = Regex.Matches(html, "<div[^>]*data-admin-target=\"([^\"]+)\"").Select(x => WebUtility.HtmlDecode(x.Groups[1].Value)).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => JsonDocument.Parse(x).RootElement).ToList();
        var chip = chips.First(x => x.GetProperty("id").GetString() == "9007199254740995");
        Assert.Equal(s.Owner, chip.GetProperty("employeeId").GetString()); Assert.Equal(LeaveRequestSnapshot.Compute(target), chip.GetProperty("snapshot").GetString()); Assert.Equal(2, chip.GetProperty("dates").GetArrayLength());
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"] = "false";
        var optional = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}");
        Assert.Contains("data-reason-required=\"false\"", optional);
        var input = Regex.Match(optional, "<input[^>]*name=\"ForceInput.Reason\"[^>]*>").Value; Assert.NotEmpty(input); Assert.DoesNotContain("required=", input);
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return;
        var selfOnly = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}&SelfOnly=true&SaveCalendarPreference=true");
        var preview = await s.Client.GetStringAsync($"/Leave?Year={s.Start.Year}&Month={s.Start.Month}&ViewEmployeeId={ExternalEmployeeId}");
        Assert.Contains("aria-label=\"자기것만 보기\" checked", selfOnly);
        Assert.Contains("관리자 대신보기 모드", preview);
        Directory.CreateDirectory(output); await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-admin.html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-admin.optional.html"), optional);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-admin.self-only.html"), selfOnly);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-admin.preview.html"), preview);
        await File.WriteAllTextAsync(Path.Combine(output, "leave.calendar-admin.json"), JsonSerializer.Serialize(new { start = s.Start.ToString("yyyy-MM-dd"), chip, context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }

    static async Task<HttpResponseMessage> CalendarAdminPost(ApplicationSetup s, bool deleting = false, long id = 9007199254740995,
        Dictionary<string, string>? changes = null, bool enhanced = true, bool baseline = true, bool csrf = true, string? duplicate = null)
    {
        var fields = new Dictionary<string, string> {
            ["ForceInput.EmployeeId"] = ExternalEmployeeId.ToString(CultureInfo.InvariantCulture), ["ForceInput.Date"] = s.Start.ToString("yyyy-MM-dd"),
            ["ForceInput.Portion"] = "FullDay", ["ForceInput.Reason"] = "  누락 기록 보정  ",
            ["ForceDeleteRequestId"] = id.ToString(CultureInfo.InvariantCulture), ["ForceDeleteReason"] = "  중복 기록 삭제  ",
            ["Year"] = s.Start.Year.ToString(), ["Month"] = s.Start.Month.ToString(), ["CalendarView"] = "month",
            ["SelfOnly"] = "false", ["ShowOthers"] = "false", ["RequestLimit"] = "20", ["RequestPage"] = "1"
        };
        if (baseline) {
            fields["expectedEmployeeId"] = s.Owner;
            var request = (await s.Stored()).SingleOrDefault(x => x.Id == id);
            fields["expectedSnapshot"] = deleting && request is not null ? LeaveRequestSnapshot.Compute(request) : "";
        }
        if (changes is not null) foreach (var pair in changes) fields[pair.Key] = pair.Value;
        if (csrf) {
            var html = await s.Client.GetStringAsync("/Leave");
            fields["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        }
        var data = fields.ToList(); if (duplicate is not null) data.Add(new(duplicate, fields[duplicate]));
        using var message = new HttpRequestMessage(HttpMethod.Post, "/Leave?handler=AdminForce" + (deleting ? "Delete" : "Add")) { Content = new FormUrlEncodedContent(data) };
        if (enhanced) message.Headers.Add("Accept", NotificationMedia);
        return await s.Client.SendAsync(message);
    }

    [Theory]
    [InlineData("FullDay", "1")]
    [InlineData("Morning", "0.5")]
    [InlineData("Afternoon", "0.5")]
    [InlineData("특수휴가", "0")]
    [InlineData("기타", "0")]
    public async Task CalendarAdminCreateConfirmsApprovedPastDateAndRoundTripBaseline(string portion, string days)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        var date = s.Start.AddYears(-1).ToString("yyyy-MM-dd");
        using var added = await CalendarAdminPost(s, changes: new() { ["ForceInput.Date"] = date, ["ForceInput.Portion"] = portion });
        var receipt = (await NotificationReceipt(added)).GetProperty("data");
        var id = long.Parse(receipt.GetProperty("id").GetString()!, CultureInfo.InvariantCulture);
        Assert.True(id > 9007199254740997L);
        var request = (await s.Stored()).Single(x => x.Id == id);
        Assert.Equal("AdminForceAdd", receipt.GetProperty("operation").GetString()); Assert.Equal(s.Owner, receipt.GetProperty("actorEmployeeId").GetString());
        Assert.Equal(ExternalEmployeeId.ToString(), receipt.GetProperty("targetEmployeeId").GetString());
        Assert.Equal("Approved", receipt.GetProperty("status").GetString()); Assert.Equal(LeaveRequestStatus.Approved, request.Status);
        Assert.Equal(long.Parse(s.Owner), request.DecidedByEmployeeId); Assert.NotNull(request.DecidedAtUtc);
        Assert.Equal("누락 기록 보정", receipt.GetProperty("reason").GetString()); Assert.Equal("누락 기록 보정", request.Reason);
        Assert.Equal(days, receipt.GetProperty("calculatedDays").GetString()); Assert.Equal(decimal.Parse(days, CultureInfo.InvariantCulture), request.CalculatedDays);
        Assert.Equal(1, receipt.GetProperty("dates").GetArrayLength()); Assert.Equal(date, receipt.GetProperty("dates")[0].GetProperty("date").GetString());
        Assert.Equal(portion, receipt.GetProperty("dates")[0].GetProperty("portion").GetString());
        Assert.Equal("", receipt.GetProperty("previousSnapshot").GetString()); Assert.Equal(JsonValueKind.Null, receipt.GetProperty("previousStatus").ValueKind);
        var snapshot = receipt.GetProperty("snapshot").GetString(); Assert.Equal(LeaveRequestSnapshot.Compute(request), snapshot);
        Assert.StartsWith("/Leave/Index?", receipt.GetProperty("navigateTo").GetString()); Assert.Contains("RequestLimit=20", receipt.GetProperty("navigateTo").GetString());
        using var deleted = await CalendarAdminPost(s, true, id, new() { ["expectedSnapshot"] = snapshot! });
        var result = (await NotificationReceipt(deleted)).GetProperty("data");
        Assert.Equal("AdminForceDelete", result.GetProperty("operation").GetString()); Assert.Equal("deleted", result.GetProperty("status").GetString());
        Assert.Equal("Approved", result.GetProperty("previousStatus").GetString()); Assert.Equal(snapshot, result.GetProperty("previousSnapshot").GetString());
        Assert.Equal("", result.GetProperty("snapshot").GetString()); Assert.Equal("중복 기록 삭제", result.GetProperty("reason").GetString());
        Assert.DoesNotContain(await s.Stored(), x => x.Id == id);
        using var scope = s.Leave.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        Assert.Equal(new[] { "LeaveRequestForceCreated", "LeaveRequestForceDeleted" }, await db.AuditLogs.Where(x => x.TargetType == "LeaveRequest" && x.TargetId == id.ToString()).OrderBy(x => x.Id).Select(x => x.Action).ToArrayAsync());
    }

    [Fact]
    public async Task CalendarAdminBirthdayUsesNormalLeaveDay()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        var date = s.Start.AddYears(-1);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.SingleAsync(x => x.Id == ExternalEmployeeId)).BirthDate = new DateOnly(2000, date.Month, date.Day);
            await db.SaveChangesAsync();
        }
        using var added = await CalendarAdminPost(s, changes: new() { ["ForceInput.Date"] = date.ToString("yyyy-MM-dd") });
        var receipt = (await NotificationReceipt(added)).GetProperty("data");
        var id = long.Parse(receipt.GetProperty("id").GetString()!, CultureInfo.InvariantCulture);
        var request = (await s.Stored()).Single(x => x.Id == id);
        Assert.Equal("1", receipt.GetProperty("calculatedDays").GetString());
        Assert.Equal(1m, request.CalculatedDays);
        Assert.False(Assert.Single(request.Dates).IsBirthdayLeave);
    }

    [Fact]
    public async Task CalendarAdminCanAddAuditedBirthdayPolicyOverrideWithoutUsingBalance()
    {
        await using var s=await ApplicationSetup.Create("admin"); await SeedExternal(s);
        var date=s.Start.AddYears(-1);
        using(var scope=s.Leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();var employee=await db.Employees.SingleAsync(x=>x.Id==ExternalEmployeeId);
            employee.HireDate=date.AddYears(1);employee.BirthDate=new DateOnly(2000,date.Month,date.Day);await db.SaveChangesAsync();
        }
        using var added=await CalendarAdminPost(s,changes:new(){{"ForceInput.Date",date.ToString("yyyy-MM-dd")},{"ForceInput.Portion","Birthday"}});
        var receipt=(await NotificationReceipt(added)).GetProperty("data");var id=long.Parse(receipt.GetProperty("id").GetString()!,CultureInfo.InvariantCulture);
        var request=(await s.Stored()).Single(x=>x.Id==id);var requestDate=Assert.Single(request.Dates);
        Assert.Equal("0",receipt.GetProperty("calculatedDays").GetString());Assert.Equal(0m,request.CalculatedDays);Assert.True(request.IsBirthdayPolicyOverride);
        Assert.Equal(date,request.BirthdayBenefitDate);Assert.True(requestDate.IsBirthdayLeave);Assert.Equal(LeaveDayPortion.Birthday,requestDate.Portion);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CalendarAdminRejectsIdentityMalformedFieldsPreviewAndCsrf(bool deleting)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        Assert.Equal(HttpStatusCode.BadRequest, (await CalendarAdminPost(s, deleting, csrf: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, deleting, baseline: false)).StatusCode);
        foreach (var key in new[] { "expectedEmployeeId", "expectedSnapshot" }) {
            Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, deleting, changes: new() { [key] = "different" })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, deleting, duplicate: key)).StatusCode);
        }
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, deleting, changes: new() { ["ViewEmployeeId"] = ExternalEmployeeId.ToString() })).StatusCode);
        var fields = deleting ? new[] { "ForceDeleteRequestId", "ForceDeleteReason" } : new[] { "ForceInput.EmployeeId", "ForceInput.Date", "ForceInput.Portion", "ForceInput.Reason" };
        foreach (var key in fields) Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, deleting, duplicate: key)).StatusCode);
        var target = deleting ? "ForceDeleteRequestId" : "ForceInput.EmployeeId";
        foreach (var value in new[] { "", "bad-id", "0", "-1", "9223372036854775808" })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, deleting, changes: new() { [target] = value })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, deleting, changes: new() { [deleting ? "ForceDeleteReason" : "ForceInput.Reason"] = " " })).StatusCode);
        if (!deleting) foreach (var changes in new Dictionary<string, string>[] { new() { ["ForceInput.Date"] = "invalid" }, new() { ["ForceInput.Date"] = "0001-01-01" }, new() { ["ForceInput.Portion"] = "999" } })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, changes: changes)).StatusCode);
        Assert.Equal(3, (await s.Stored()).Count);
        // Unrelated Apply/ExternalInput binding errors must not invalidate this real native form.
        using var valid = await CalendarAdminPost(s, deleting, changes: new() { ["Input.StartDate"] = "invalid", ["ExternalInput.StartDate"] = "invalid" });
        await NotificationReceipt(valid);
    }

    [Fact]
    public async Task CalendarAdminCreatePreservesConflictPolicyAndRejectsNonEmployees()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        foreach (var kind in new[] { "shared", "master", "inactive", "private" }) {
            using (var scope = s.Leave.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>(); var employee = (await db.Employees.FindAsync(ExternalEmployeeId))!;
                employee.IsSharedAccount = kind == "shared"; employee.IsCompanyMaster = kind == "master"; employee.IsActive = kind != "inactive"; employee.IsPrivate = kind == "private"; await db.SaveChangesAsync();
            }
            using var response = await CalendarAdminPost(s, changes: new() { ["ForceInput.Portion"] = "Morning" });
            Assert.Equal(kind == "private" ? HttpStatusCode.OK : HttpStatusCode.UnprocessableEntity, response.StatusCode);
        }
        foreach (var portion in new[] { "Morning", "FullDay", "특수휴가", "기타" })
            Assert.Equal(HttpStatusCode.UnprocessableEntity, (await CalendarAdminPost(s, changes: new() { ["ForceInput.Portion"] = portion })).StatusCode);
        await NotificationReceipt(await CalendarAdminPost(s, changes: new() { ["ForceInput.Portion"] = "Afternoon" }));
        Assert.Equal(2, (await s.Stored()).Count);
    }

    [Fact]
    public async Task CalendarAdminDeleteChecksWholeRequestSnapshotAndAllStatuses()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedSelfActions(s);
        var old = LeaveRequestSnapshot.Compute((await s.Stored()).Single(x => x.Id == 9007199254740995L));
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var outsideMonth = await db.LeaveRequestDates.Where(x => x.LeaveRequestId == 9007199254740995L).OrderByDescending(x => x.Date).FirstAsync();
            outsideMonth.Date = outsideMonth.Date.AddDays(1); await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, true, changes: new() { ["expectedSnapshot"] = old })).StatusCode);
        foreach (var state in Enum.GetValues<LeaveRequestStatus>()) {
            var id = 9007199254741001L + (int)state;
            using (var scope = s.Leave.Services.CreateScope()) {
                var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
                db.LeaveRequests.Add(new() { Id = id, EmployeeId = long.Parse(s.Owner), Status = state, CalculatedDays = 2, Dates = [new() { Date = s.Start, Portion = LeaveDayPortion.FullDay }, new() { Date = s.Start.AddMonths(1), Portion = LeaveDayPortion.FullDay }] }); await db.SaveChangesAsync();
            }
            var receipt = (await NotificationReceipt(await CalendarAdminPost(s, true, id))).GetProperty("data");
            Assert.Equal(state.ToString(), receipt.GetProperty("previousStatus").GetString()); Assert.Equal(2, receipt.GetProperty("dates").GetArrayLength());
            Assert.DoesNotContain(await s.Stored(), x => x.Id == id);
            Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, true, id)).StatusCode);
        }
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task CalendarAdminWriteFailuresRemainUnknownBeforeOrAfterCommit(bool deleting, bool afterCommit)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            if (afterCommit) await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER calendar_admin_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-force-canary'); END;");
            else if (deleting) await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER calendar_admin_test_error BEFORE DELETE ON LeaveRequests BEGIN SELECT RAISE(ABORT,'private-force-canary'); END;");
            else await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER calendar_admin_test_error BEFORE INSERT ON LeaveRequests BEGIN SELECT RAISE(ABORT,'private-force-canary'); END;");
        }
        using var response = await CalendarAdminPost(s, deleting);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode); Assert.True(response.Headers.CacheControl?.NoStore);
        var text = await response.Content.ReadAsStringAsync(); Assert.DoesNotContain("private-force-canary", text);
        Assert.Equal("unknown", JsonDocument.Parse(text).RootElement.GetProperty("outcome").GetString());
        Assert.Equal(afterCommit ? deleting ? 2 : 4 : 3, (await s.Stored()).Count);
    }

    [Fact]
    public async Task CalendarAdminDeleteRestoresAdvanceRepaymentsAndRetainsSecurityPolicy()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        const long id = 9007199254740995;
        long grantId;
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var target = (await db.LeaveRequests.FindAsync(id))!; target.IsAdvance = true; target.AdvanceDays = 1; target.AdvanceRepaymentDays = 1; target.MonthlyAdvanceRepaymentDays = 1;
            var grant = new LeaveGrant { EmployeeId = target.EmployeeId, GrantType = LeaveGrantType.Monthly, GrantedDate = s.Start, ExpiresDate = s.Start.AddYears(1), GrantedDays = 1 };
            db.LeaveGrants.Add(grant); await db.SaveChangesAsync(); grantId = grant.Id;
            db.LeaveAllocations.Add(new() { LeaveRequestId = id, LeaveGrantId = grant.Id, Days = 1 });
            db.LeaveSettlements.Add(new() { EmployeeId = target.EmployeeId, SourceGrantId = grant.Id, Type = LeaveSettlementType.AdvanceRepayment, Days = 1, ProcessedDate = s.Start, ProcessedByEmployeeId = long.Parse(s.Owner), AdvanceLeaveRequestId = id });
            var localAdmin = (await db.Employees.FindAsync(ExternalEmployeeId))!; localAdmin.Role = EmployeeRole.Admin; await db.SaveChangesAsync();
            // Exercise the unchanged domain policy independently of Portal's admin -> Leave Master projection.
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => scope.ServiceProvider.GetRequiredService<LeaveRequestService>().ForceDeleteAsync(id, localAdmin.Id, "권한 검증"));
            Assert.True(await db.LeaveRequests.AnyAsync(x => x.Id == id)); Assert.Single(await db.LeaveSettlements.ToListAsync());
        }
        await NotificationReceipt(await CalendarAdminPost(s, true));
        using var check = s.Leave.Services.CreateScope(); var stored = check.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        Assert.Empty(await stored.LeaveSettlements.Where(x => x.AdvanceLeaveRequestId == id).ToListAsync());
        Assert.Empty(await stored.LeaveAllocations.Where(x => x.LeaveRequestId == id).ToListAsync());
        Assert.Empty(await stored.LeaveRequestDates.Where(x => x.LeaveRequestId == id).ToListAsync());
        Assert.Equal(1m, (await stored.LeaveGrants.SingleAsync(x => x.Id == grantId)).GrantedDays);
    }

    [Fact]
    public async Task CalendarAdminOptionalReasonPolicyKeepsItsNormalizedFallback()
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s);
        s.Leave.Services.GetRequiredService<IConfiguration>()["Security:RequireReasonsForSensitiveAdminActions"] = "false";
        var added = (await NotificationReceipt(await CalendarAdminPost(s, changes: new() { ["ForceInput.Reason"] = " " }))).GetProperty("data");
        Assert.Equal("사유 미입력", added.GetProperty("reason").GetString());
        var id = long.Parse(added.GetProperty("id").GetString()!);
        var removed = (await NotificationReceipt(await CalendarAdminPost(s, true, id, new() { ["ForceDeleteReason"] = " " }))).GetProperty("data");
        Assert.Equal("사유 미입력", removed.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task CalendarAdminRejectsOrdinaryEmployeeAndProtectsCompanyMasterRequest()
    {
        await using (var employee = await ApplicationSetup.Create()) {
            foreach (var deleting in new[] { false, true }) Assert.Equal(HttpStatusCode.Forbidden, (await CalendarAdminPost(employee, deleting)).StatusCode);
            Assert.Empty(await employee.Stored());
        }
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        using (var scope = s.Leave.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.FindAsync(ExternalEmployeeId))!.IsCompanyMaster = true;
            (await db.LeaveRequests.FindAsync(9007199254740995L))!.EmployeeId = ExternalEmployeeId; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Conflict, (await CalendarAdminPost(s, true)).StatusCode); Assert.Equal(3, (await s.Stored()).Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CalendarAdminNativeCompatibilityRetainsEncodedFailedInput(bool deleting)
    {
        await using var s = await ApplicationSetup.Create("admin"); await SeedExternal(s); await SeedSelfActions(s);
        using var saved = await CalendarAdminPost(s, deleting, enhanced: false, baseline: false); Assert.Equal(HttpStatusCode.Redirect, saved.StatusCode);
        var key = deleting ? "ForceDeleteRequestId" : "ForceInput.EmployeeId"; var reason = deleting ? "ForceDeleteReason" : "ForceInput.Reason";
        using var failed = await CalendarAdminPost(s, deleting, enhanced: false, changes: new() { [key] = "bad-id", [reason] = "<script>window.injected=true</script>", ["privateCredential"] = "never-copy-this" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, failed.StatusCode); Assert.True(failed.Headers.CacheControl?.NoStore);
        var html = await failed.Content.ReadAsStringAsync(); Assert.DoesNotContain("<script>window.injected", html); Assert.DoesNotContain("never-copy-this", html);
        Assert.DoesNotContain("id=\"adminForceAddForm\"", html); Assert.DoesNotContain("id=\"adminForceDeleteForm\"", html);
        Assert.Contains("const canAdminEditCalendar = false", html);
        var raw = WebUtility.HtmlDecode(Regex.Match(html, "<pre>(.*?)</pre>", RegexOptions.Singleline).Groups[1].Value);
        var retained = JsonDocument.Parse(raw).RootElement; Assert.Equal("bad-id", retained.GetProperty(key)[0].GetString());
        Assert.Equal("<script>window.injected=true</script>", retained.GetProperty(reason)[0].GetString());
        Assert.Equal(deleting ? 2 : 4, retained.EnumerateObject().Count()); Assert.DoesNotContain("__RequestVerificationToken", raw);
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS"); if (string.IsNullOrEmpty(output)) return;
        Directory.CreateDirectory(output); var name = "leave.admin-force-recovery-" + (deleting ? "delete" : "add");
        await File.WriteAllTextAsync(Path.Combine(output, name + ".html"), html);
        await File.WriteAllTextAsync(Path.Combine(output, name + ".json"), JsonSerializer.Serialize(new { key, reason, context = await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"), navigation = await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation") }));
    }
}
