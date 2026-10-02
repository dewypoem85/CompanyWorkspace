using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Workspace;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class AccountFormTests
{
    static string InputValue(string html, string name) => WebUtility.HtmlDecode(Regex.Match(html,
        "name=\"" + Regex.Escape(name) + "\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);
    static string RowIndex(string html, long id) => Regex.Match(html,
        "name=\"updates\\[(\\d+)\\]\\.Id\" value=\"" + id + "\"").Groups[1].Value;
    static async Task WriteRecoveryFixture(string name, string html)
    {
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if (string.IsNullOrEmpty(output)) return;
        Directory.CreateDirectory(output);
        await File.WriteAllTextAsync(Path.Combine(output, "account-recovery-" + name + ".html"), html);
    }

    [Theory]
    [InlineData("duplicate")]
    [InlineData("conflict")]
    public async Task HtmlBulkFailureRetainsDraftAndOriginalVersionWithoutRebasing(string failure)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (owner, _) = await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(); Assert.Equal(HttpStatusCode.Redirect, (await Post(client, "Add", fields)).StatusCode);
        var original = await User(factory, fields["Email"]);
        var initial = await client.GetStringAsync("/Admin/Users");
        var baseline = InputValue(initial, $"updates[{RowIndex(initial, original.Id)}].Baseline");
        Assert.NotEmpty(baseline);
        var updates = fields.Where(f => f.Key != "__RequestVerificationToken").ToDictionary(f => "updates[7]." + f.Key, f => f.Value);
        updates["updates.Index"] = "7"; updates["updates[7].Id"] = original.Id.ToString();
        updates["updates[7].UpdatedAtTicks"] = original.UpdatedAtUtc.Ticks.ToString(); updates["updates[7].Baseline"] = baseline;
        updates["updates[7].Name"] = "  복원한 직원 초안  "; updates["updates[7].IsPrivate"] = "false";
        updates["updates[7].Permissions"] = "statistics.access";
        if (failure == "duplicate") updates["updates[7].Email"] = owner.Email;
        else using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>(); var latest = await db.Users.SingleAsync(u => u.Id == original.Id);
            latest.Name = "다른 곳에서 저장한 이름"; latest.UpdatedAtUtc = original.UpdatedAtUtc.AddSeconds(1); await db.SaveChangesAsync();
        }
        var response = await Post(client, "BulkUpdate", updates); Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl!.NoStore);
        var html = await response.Content.ReadAsStringAsync(); var index = RowIndex(html, original.Id);
        Assert.Contains("data-html-draft-recovery", html); Assert.Contains("data-recovered=\"true\"", html);
        Assert.Equal(updates["updates[7].Name"], InputValue(html, $"updates[{index}].Name"));
        Assert.Equal(original.UpdatedAtUtc.Ticks.ToString(), InputValue(html, $"updates[{index}].UpdatedAtTicks"));
        Assert.Equal(baseline, InputValue(html, $"updates[{index}].Baseline"));
        Assert.Equal("", InputValue(html, "Name")); // Bulk drafts must not populate the separate registration form.
        var persisted = await User(factory, original.Email);
        Assert.Equal(failure == "conflict" ? "다른 곳에서 저장한 이름" : original.Name, persisted.Name);
        Assert.Equal(failure == "conflict" ? original.UpdatedAtUtc.AddSeconds(1) : original.UpdatedAtUtc, persisted.UpdatedAtUtc);
        Assert.Equal(original.Permissions, persisted.Permissions); Assert.True(persisted.IsPrivate);
        await WriteRecoveryFixture(failure, html);
        updates["updates[7].Email"] = original.Email;
        response = await Post(client, "BulkUpdate", updates);
        Assert.Equal(failure == "conflict" ? HttpStatusCode.OK : HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal(failure == "conflict" ? persisted.Name : "복원한 직원 초안", (await User(factory, original.Email)).Name);
    }

    [Theory]
    [InlineData("date")]
    [InlineData("baseline")]
    [InlineData("missing-baseline")]
    [InlineData("protected")]
    public async Task HtmlUnrepresentableOrUnauthorizedDraftsRemainEscapedCopyOnly(string failure)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (owner, _) = await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(); await Post(client, "Add", fields); var original = await User(factory, fields["Email"]);
        var initial = await client.GetStringAsync("/Admin/Users");
        var baseline = InputValue(initial, $"updates[{RowIndex(initial, original.Id)}].Baseline");
        var updates = fields.Where(f => f.Key != "__RequestVerificationToken").ToDictionary(f => "updates[0]." + f.Key, f => f.Value);
        updates["updates[0].Id"] = original.Id.ToString(); updates["updates[0].UpdatedAtTicks"] = original.UpdatedAtUtc.Ticks.ToString();
        updates["updates[0].Baseline"] = failure == "baseline" ? "{\"Fields\":null}" : baseline;
        if (failure == "missing-baseline") updates.Remove("updates[0].Baseline");
        updates["updates[0].Name"] = "<script>window.STOLEN=true</script>";
        updates["updates[0].Email"] = owner.Email;
        updates["updates[0].SecretNotInContract"] = "DO_NOT_REFLECT_SECRET_CANARY";
        if (failure == "date") updates["updates[0].HireDate"] = "invalid-date-RAW";
        if (failure == "protected")
        {
            using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var target = await db.Users.SingleAsync(u => u.Id == original.Id); target.IsAdmin = true; await db.SaveChangesAsync();
            using var admin = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            await WorkspaceTests.Login(factory, admin, false, true);
            var denied = await Post(admin, "BulkUpdate", updates); var body = await denied.Content.ReadAsStringAsync();
            Assert.DoesNotContain("data-recovered=\"true\"", body); Assert.Contains("data-html-draft-recovery", body);
        }
        else
        {
            var response = await Post(client, "BulkUpdate", updates); var html = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("data-html-draft-recovery", html);
            Assert.DoesNotContain("data-recovered=\"true\"", html); Assert.DoesNotContain(updates["updates[0].Name"], html);
            Assert.Contains(updates["updates[0].Name"], WebUtility.HtmlDecode(html)); Assert.DoesNotContain("DO_NOT_REFLECT_SECRET_CANARY", html);
            if (failure == "date") { Assert.Contains("invalid-date-RAW", html); await WriteRecoveryFixture("invalid", html); }
        }
        Assert.Equal(original.Name, (await User(factory, original.Email)).Name);
        Assert.Equal(original.UpdatedAtUtc, (await User(factory, original.Email)).UpdatedAtUtc);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task HtmlAddFailureKeepsOwnDraftAndBlocksUnconfirmedOrInvalidBinding(bool invalidBinding)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (owner, _) = await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(owner.Email); fields["Name"] = "신규 등록 초안";
        if (invalidBinding) fields["HireDate"] = "invalid-date-RAW";
        var response = await Post(client, "Add", fields); var html = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.Contains("data-html-draft-recovery", html); Assert.Contains("신규 등록 초안", WebUtility.HtmlDecode(html));
        Assert.Equal(invalidBinding ? "" : fields["Name"], InputValue(html, "Name"));
        Assert.Equal(owner.Name, (await User(factory, owner.Email)).Name);
        if (invalidBinding) { Assert.Contains("invalid-date-RAW", html); await WriteRecoveryFixture("add-invalid", html); }
    }

    [Theory]
    [InlineData("Add")]
    [InlineData("BulkUpdate")]
    public async Task HtmlUnconfirmedWriteKeepsRawDraftWithoutRepeatingOrLeakingServerErrors(string handler)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(); await Post(client, "Add", fields); var original = await User(factory, fields["Email"]);
        var initial = await client.GetStringAsync("/Admin/Users");
        var payload = handler == "Add" ? Fields("unconfirmed@example.test") : fields.Where(f => f.Key != "__RequestVerificationToken").ToDictionary(f => "updates[0]." + f.Key, f => f.Value);
        var prefix = handler == "Add" ? "" : "updates[0]."; payload[prefix + "Name"] = "결과 미확정 초안";
        if (handler == "BulkUpdate")
        {
            payload[prefix + "Id"] = original.Id.ToString(); payload[prefix + "UpdatedAtTicks"] = original.UpdatedAtUtc.Ticks.ToString();
            payload[prefix + "Baseline"] = InputValue(initial, $"updates[{RowIndex(initial, original.Id)}].Baseline");
        }
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync(handler == "Add"
                ? "CREATE TRIGGER fail_test_write BEFORE INSERT ON Users BEGIN SELECT RAISE(ABORT, 'DO_NOT_REFLECT_DATABASE_CANARY'); END"
                : "CREATE TRIGGER fail_test_write BEFORE UPDATE ON Users BEGIN SELECT RAISE(ABORT, 'DO_NOT_REFLECT_DATABASE_CANARY'); END");
        }
        var response = await Post(client, handler, payload); var html = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Contains("data-html-blocked=\"true\"", html);
        Assert.Contains("결과 미확정 초안", WebUtility.HtmlDecode(html)); Assert.DoesNotContain("DO_NOT_REFLECT_DATABASE_CANARY", html);
        Assert.DoesNotContain("data-recovered=\"true\"", html); Assert.Equal(original.Name, (await User(factory, original.Email)).Name);
        Assert.Equal(original.UpdatedAtUtc, (await User(factory, original.Email)).UpdatedAtUtc);
        using (var scope = factory.Services.CreateScope()) Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.Email == "unconfirmed@example.test"));
        await WriteRecoveryFixture(handler == "Add" ? "add-unknown" : "bulk-unknown", html);
    }

    [Fact]
    public async Task HtmlRecoveryRetainsArchivedChoicesNeededToResetTheOriginalBaseline()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (owner, _) = await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(); await Post(client, "Add", fields); var original = await User(factory, fields["Email"]);
        long departmentId, projectId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var d = new Department { Name = "보관 부서", Archived = true }; var p = new CompanyProject { Name = "보관 프로젝트", Archived = true };
            db.Departments.Add(d); db.Projects.Add(p); await db.SaveChangesAsync(); departmentId = d.Id; projectId = p.Id;
            (await db.Users.SingleAsync(u => u.Id == original.Id)).DepartmentId = d.Id;
            db.ProjectMemberships.Add(new() { EmployeeId = original.Id, ProjectId = p.Id }); await db.SaveChangesAsync();
        }
        var initial = await client.GetStringAsync("/Admin/Users");
        var updates = fields.Where(f => f.Key != "__RequestVerificationToken").ToDictionary(f => "updates[0]." + f.Key, f => f.Value);
        updates["updates[0].Id"] = original.Id.ToString(); updates["updates[0].UpdatedAtTicks"] = original.UpdatedAtUtc.Ticks.ToString();
        updates["updates[0].Baseline"] = InputValue(initial, $"updates[{RowIndex(initial, original.Id)}].Baseline");
        updates["updates[0].Email"] = owner.Email; updates["updates[0].DepartmentId"] = "";
        var html = await (await Post(client, "BulkUpdate", updates)).Content.ReadAsStringAsync(); var index = RowIndex(html, original.Id);
        Assert.Contains("data-recovered=\"true\"", html);
        var detail = Regex.Match(html, "data-user-details=\"user-" + original.Id + "\".*?</tr>", RegexOptions.Singleline).Value;
        Assert.Contains("보관 부서", WebUtility.HtmlDecode(detail)); Assert.Contains("보관 프로젝트", WebUtility.HtmlDecode(detail));
        Assert.Contains($"name=\"updates[{index}].ProjectIds\" value=\"{projectId}\"", detail);
        Assert.DoesNotContain($"value=\"{projectId}\" checked", detail);
        Assert.Equal(departmentId, (await User(factory, original.Email)).DepartmentId);
    }

    [Theory]
    [InlineData("employee", "employee")]
    [InlineData("employee", "admin")]
    [InlineData("employee", "master")]
    [InlineData("shared", "employee")]
    public async Task AsyncCreateAcknowledgesPersistedSharedFieldsAndDoesNotRepeatDuplicateEmails(string type, string role)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true,true);FormClient(client);
        long departmentId,projectId;
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var department=new Department{Name="등록 부서"};var project=new CompanyProject{Name="등록 프로젝트",IsPrivate=true};
            db.Departments.Add(department);db.Projects.Add(project);await db.SaveChangesAsync();departmentId=department.Id;projectId=project.Id;
        }
        var fields=Fields("  NEW-ACCOUNT@EXAMPLE.TEST  ");
        fields["Name"]="  등록 직원  ";fields["AccountType"]=type;fields["Role"]=role;fields["IsActive"]="false";
        fields["DepartmentId"]=departmentId.ToString();fields["ProjectIds"]=projectId.ToString();fields["Permissions"]="iap.publish";
        if(type=="shared")fields.Remove("HireDate");
        var response=await Post(client,"Add",fields);
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.Equal(FormMediaType,response.Content.Headers.ContentType!.MediaType);Assert.True(response.Headers.CacheControl!.NoStore);
        var reply=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("workspace-form-v1",reply.GetProperty("protocol").GetString());Assert.Equal("saved",reply.GetProperty("outcome").GetString());
        var saved=await User(factory,"new-account@example.test");var account=reply.GetProperty("data").GetProperty("account");var values=account.GetProperty("fields");
        Assert.Equal(saved.Id.ToString(),account.GetProperty("id").GetString());Assert.Equal(saved.UpdatedAtUtc.Ticks.ToString(),account.GetProperty("updatedAtTicks").GetString());
        Assert.Equal(AccountFields.All.Select(f=>f.Key).Order(),values.EnumerateObject().Select(f=>f.Name).Order());
        Assert.All(values.EnumerateObject(),f=>Assert.All(f.Value.EnumerateArray(),v=>Assert.Equal(JsonValueKind.String,v.ValueKind)));
        Assert.Equal("등록 직원",values.GetProperty("Name")[0].GetString());Assert.Equal(saved.Email,values.GetProperty("Email")[0].GetString());
        Assert.Equal(type,values.GetProperty("AccountType")[0].GetString());Assert.Equal(role,values.GetProperty("Role")[0].GetString());
        Assert.Equal("false",values.GetProperty("IsActive")[0].GetString());Assert.Equal("true",values.GetProperty("IsPrivate")[0].GetString());
        Assert.Equal(saved.HireDate.ToString("yyyy-MM-dd"),values.GetProperty("HireDate")[0].GetString());
        Assert.Equal(type=="shared"?"":departmentId.ToString(),values.GetProperty("DepartmentId")[0].GetString());
        var expectedProjects=type=="shared"||role=="master"?Array.Empty<string>():new[]{projectId.ToString()};
        Assert.Equal(expectedProjects,values.GetProperty("ProjectIds").EnumerateArray().Select(v=>v.GetString()));
        Assert.Equal(new[]{"iap.access","iap.publish"},values.GetProperty("Permissions").EnumerateArray().Select(v=>v.GetString()));
        response=await Post(client,"Add",fields);Assert.Equal(HttpStatusCode.UnprocessableEntity,response.StatusCode);
        Assert.Equal("invalid",(await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("outcome").GetString());
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();Assert.Equal(1,await db.Users.CountAsync(u=>u.Email==saved.Email));
            Assert.Equal(expectedProjects,await db.ProjectMemberships.Where(m=>m.EmployeeId==saved.Id).Select(m=>m.ProjectId.ToString()).ToArrayAsync());
            Assert.Equal(type!="shared",await db.LeaveProjectionOutbox.AnyAsync(x=>x.CompanyUserId==saved.Id));
        }
        Assert.Equal(saved.UpdatedAtUtc,(await User(factory,saved.Email)).UpdatedAtUtc);
    }

    [Theory]
    [InlineData("HireDate","invalid-date")]
    [InlineData("BirthDate","invalid-date")]
    [InlineData("DepartmentId","9999999")]
    [InlineData("ProjectIds","9999999")]
    [InlineData("Role","master")]
    public async Task AsyncCreateRejectsInvalidFieldsWithoutSavingOrBypassingAntiforgery(string key,string value)
    {
        await using var factory=new ContractFactory<CompanyUser>();
        using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true);FormClient(client);
        var fields=Fields();fields[key]=value;var response=await Post(client,"Add",fields);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,response.StatusCode);
        Assert.Equal("invalid",(await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("outcome").GetString());
        using(var scope=factory.Services.CreateScope())Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u=>u.Email==fields["Email"]));
        fields.Remove("__RequestVerificationToken");Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync("/Admin/Users?handler=Add",new FormUrlEncodedContent(fields))).StatusCode);
        using var guest=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});FormClient(guest);
        Assert.Equal(HttpStatusCode.Unauthorized,(await guest.PostAsync("/Admin/Users?handler=Add",new FormUrlEncodedContent(fields))).StatusCode);
    }

    [Fact]
    public async Task AsyncCreateRollsBackTheNewAccountWhenMembershipWriteFailsAfterIdAllocation()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true);FormClient(client);long projectId;
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();var project=new CompanyProject{Name="트랜잭션 검증"};db.Projects.Add(project);await db.SaveChangesAsync();projectId=project.Id;
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_test_membership BEFORE INSERT ON ProjectMemberships BEGIN SELECT RAISE(ABORT, 'isolated test failure'); END");
        }
        var fields=Fields();fields["ProjectIds"]=projectId.ToString();var response=await Post(client,"Add",fields);
        Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);Assert.Equal("unknown",(await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("outcome").GetString());
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();Assert.False(await db.Users.AnyAsync(u=>u.Email==fields["Email"]));
            Assert.False(await db.ProjectMemberships.AnyAsync(m=>m.ProjectId==projectId));Assert.Equal(1,(await db.Projects.SingleAsync(p=>p.Id==projectId)).Version);
        }
    }

    const string FormMediaType = "application/vnd.company.workspace-form+json";
    static void FormClient(HttpClient client)
    {
        client.DefaultRequestHeaders.Accept.ParseAdd(FormMediaType);
        client.DefaultRequestHeaders.Add("X-Requested-With", "XMLHttpRequest");
    }

    [Fact]
    public async Task AsyncBulkAcknowledgesCanonicalValuesAndKeepsStaleVersionsAtomic()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields();
        Assert.Equal(HttpStatusCode.Redirect, (await Post(client,"Add",fields)).StatusCode);
        var original = await User(factory, fields["Email"]);
        FormClient(client);
        fields.Remove("__RequestVerificationToken"); fields["Name"] = "  수정 직원  ";
        var updates = fields.ToDictionary(x => "updates[4]." + x.Key, x => x.Value);
        updates["updates.Index"] = "4";
        updates["updates[4].Id"] = original.Id.ToString(); updates["updates[4].UpdatedAtTicks"] = original.UpdatedAtUtc.Ticks.ToString();
        var response = await Post(client,"BulkUpdate",updates);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(FormMediaType, response.Content.Headers.ContentType!.MediaType);
        Assert.True(response.Headers.CacheControl!.NoStore);
        var reply = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("workspace-form-v1", reply.GetProperty("protocol").GetString());
        Assert.Equal("saved", reply.GetProperty("outcome").GetString());
        var changed = await User(factory, fields["Email"]);
        var account = reply.GetProperty("data").GetProperty("accounts")[0];
        Assert.Equal(changed.Id.ToString(),account.GetProperty("id").GetString());
        Assert.Equal(changed.UpdatedAtUtc.Ticks.ToString(),account.GetProperty("updatedAtTicks").GetString());
        var values = account.GetProperty("fields");
        foreach (var field in AccountFields.All) Assert.Equal(JsonValueKind.Array, values.GetProperty(field.Key).ValueKind);
        Assert.Equal("수정 직원",values.GetProperty("Name")[0].GetString());
        Assert.Equal("true",values.GetProperty("IsPrivate")[0].GetString());
        Assert.Equal("2024-05-07",values.GetProperty("HireDate")[0].GetString());
        // No automatic version rebasing: exactly the same old request is rejected.
        updates["updates[4].Name"] = "오래된 초안";
        response = await Post(client,"BulkUpdate",updates);
        Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);
        reply = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("conflict",reply.GetProperty("outcome").GetString());
        Assert.Equal(changed.UpdatedAtUtc,(await User(factory,changed.Email)).UpdatedAtUtc);
        Assert.Equal("수정 직원",(await User(factory,changed.Email)).Name);
        // Known input validation is distinct from an unconfirmed transport/server failure.
        updates["updates[4].UpdatedAtTicks"] = changed.UpdatedAtUtc.Ticks.ToString();
        updates["updates[4].HireDate"] = "not-a-date";
        response = await Post(client,"BulkUpdate",updates);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,response.StatusCode);
        reply = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid",reply.GetProperty("outcome").GetString());
        Assert.Equal(changed.UpdatedAtUtc,(await User(factory,changed.Email)).UpdatedAtUtc);
        updates.Remove("__RequestVerificationToken");
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsync("/Admin/Users?handler=BulkUpdate",new FormUrlEncodedContent(updates))).StatusCode);
    }

    [Fact]
    public async Task AsyncBulkCannotBypassSessionOrAdministratorPolicy()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var guest = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        using var employee = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,employee,false,false);
        FormClient(guest); FormClient(employee);
        var payload = new FormUrlEncodedContent(new Dictionary<string,string>());
        Assert.Equal(HttpStatusCode.Unauthorized,(await guest.PostAsync("/Admin/Users?handler=BulkUpdate",payload)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await employee.PostAsync("/Admin/Users?handler=BulkUpdate",payload)).StatusCode);
    }

    [Fact]
    public async Task ReviewReadsCurrentContractValuesButCannotEditOrExposeProtectedTargets()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var master = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        using var admin = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        using var guest = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        var (owner, _) = await WorkspaceTests.Login(factory,master,false,true,true);
        await WorkspaceTests.Login(factory,admin,false,true);
        var fields=Fields();Assert.Equal(HttpStatusCode.Redirect,(await Post(master,"Add",fields)).StatusCode);
        var user=await User(factory,fields["Email"]);
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();var legacy=await db.Users.SingleAsync(x=>x.Id==user.Id);
            legacy.Permissions+=",leave.access";await db.SaveChangesAsync();
        }
        FormClient(master);FormClient(admin);FormClient(guest);
        var path="/Admin/Users?handler=Review&ids="+user.Id;
        var response=await admin.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.True(response.Headers.CacheControl!.NoStore);
        var reply=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("snapshot",reply.GetProperty("outcome").GetString());
        var accounts=reply.GetProperty("data").GetProperty("accounts");Assert.Equal(1,accounts.GetArrayLength());
        Assert.Equal(user.Id.ToString(),accounts[0].GetProperty("id").GetString());
        Assert.Equal(user.UpdatedAtUtc.Ticks.ToString(),accounts[0].GetProperty("updatedAtTicks").GetString());
        foreach(var field in AccountFields.All)Assert.Equal(JsonValueKind.Array,accounts[0].GetProperty("fields").GetProperty(field.Key).ValueKind);
        Assert.DoesNotContain("leave.access",accounts[0].GetProperty("fields").GetProperty("Permissions").EnumerateArray().Select(x=>x.GetString()));
        Assert.Contains("leave.access",(await User(factory,user.Email)).Permissions);
        Assert.Equal(user.UpdatedAtUtc,(await User(factory,user.Email)).UpdatedAtUtc);
        Assert.Equal(HttpStatusCode.Forbidden,(await admin.GetAsync("/Admin/Users?handler=Review&ids="+owner.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await guest.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await master.GetAsync(path+"&ids="+user.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await master.GetAsync("/Admin/Users?handler=Review&ids=999999999")).StatusCode);
        // A reviewed version is still optimistic: another writer after review must win over an old resave.
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();var latest=await db.Users.SingleAsync(x=>x.Id==user.Id);
            latest.Name="비교 이후의 변경";latest.UpdatedAtUtc=DateTime.UtcNow;await db.SaveChangesAsync();
        }
        var updates=fields.Where(x=>x.Key!="__RequestVerificationToken").ToDictionary(x=>"updates[0]."+x.Key,x=>x.Value);
        updates["updates[0].Id"]=user.Id.ToString();updates["updates[0].UpdatedAtTicks"]=user.UpdatedAtUtc.Ticks.ToString();
        updates["updates[0].Name"]="검토한 초안";
        Assert.Equal(HttpStatusCode.Conflict,(await Post(master,"BulkUpdate",updates)).StatusCode);
        Assert.Equal("비교 이후의 변경",(await User(factory,user.Email)).Name);
        var fresh=await (await master.GetAsync(path)).Content.ReadFromJsonAsync<JsonElement>();
        updates["updates[0].UpdatedAtTicks"]=fresh.GetProperty("data").GetProperty("accounts")[0].GetProperty("updatedAtTicks").GetString()!;
        Assert.Equal(HttpStatusCode.OK,(await Post(master,"BulkUpdate",updates)).StatusCode);
        Assert.Equal("검토한 초안",(await User(factory,user.Email)).Name);
    }

    [Fact]
    public async Task AsyncBulkRollsBackAllRowsWhenALaterOrganizationChangeFails()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true,true);
        var first = Fields("first@example.test"); var second = Fields("second@example.test");
        Assert.Equal(HttpStatusCode.Redirect,(await Post(client,"Add",first)).StatusCode);
        Assert.Equal(HttpStatusCode.Redirect,(await Post(client,"Add",second)).StatusCode);
        var firstUser = await User(factory,first["Email"]); var secondUser = await User(factory,second["Email"]);
        var updates = new Dictionary<string,string>();
        foreach (var (fields, user, index) in new[] {(first,firstUser,0),(second,secondUser,1)})
        {
            foreach (var (key,value) in fields.Where(x=>x.Key!="__RequestVerificationToken")) updates[$"updates[{index}].{key}"]=value;
            updates[$"updates[{index}].Id"]=user.Id.ToString();
            updates[$"updates[{index}].UpdatedAtTicks"]=user.UpdatedAtUtc.Ticks.ToString();
            updates[$"updates[{index}].Name"]="반영되면 안 되는 변경";
        }
        updates["updates[1].ProjectIds"]="99999999";
        FormClient(client);
        var response=await Post(client,"BulkUpdate",updates);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,response.StatusCode);
        Assert.Equal(firstUser.UpdatedAtUtc,(await User(factory,firstUser.Email)).UpdatedAtUtc);
        Assert.Equal(firstUser.Name,(await User(factory,firstUser.Email)).Name);
        Assert.Equal(secondUser.UpdatedAtUtc,(await User(factory,secondUser.Email)).UpdatedAtUtc);
        Assert.Equal(secondUser.Name,(await User(factory,secondUser.Email)).Name);
    }
    static async Task<HttpResponseMessage> Post(HttpClient client, string handler, Dictionary<string, string> fields)
    {
        var html = await client.GetStringAsync("/Admin/Users");
        fields["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"").Groups[1].Value);
        Assert.NotEmpty(fields["__RequestVerificationToken"]);
        return await client.PostAsync("/Admin/Users?handler=" + handler, new FormUrlEncodedContent(fields));
    }
    static Dictionary<string, string> Fields(string email = "new-account@example.test") => new()
    {
        ["Name"] = "새 직원", ["Email"] = email, ["HireDate"] = "2024-05-07", ["BirthDate"] = "08-17",
        ["AccountType"] = "employee", ["Role"] = "employee", ["IsActive"] = "true",
        ["IsPrivate"] = "true", ["Permissions"] = "cs.access"
    };
    static async Task<CompanyUser> User(ContractFactory<CompanyUser> factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(x => x.Email == email);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AddAndBulkEditRoundTripTheSameFieldsAndRenderEveryDefinition(bool master)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory, client, false, true, master);
        var fields = Fields();
        long departmentId, projectId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var department = new Department { Name = "검증 부서" };
            var project = new CompanyProject { Name = "검증 프로젝트", IsPrivate = true };
            db.Departments.Add(department); db.Projects.Add(project); await db.SaveChangesAsync();
            departmentId = department.Id; projectId = project.Id;
        }
        fields["DepartmentId"] = departmentId.ToString(); fields["ProjectIds"] = projectId.ToString();
        var added = await Post(client, "Add", fields);
        Assert.Equal(HttpStatusCode.Redirect, added.StatusCode);
        var user = await User(factory, fields["Email"]);
        Assert.True(user.IsPrivate); Assert.True(user.IsActive); Assert.False(user.IsSharedAccount);
        Assert.Equal(departmentId, user.DepartmentId); Assert.Equal(new DateOnly(2024, 5, 7), user.HireDate);
        Assert.Equal(new DateOnly(2000, 8, 17), user.BirthDate);
        Assert.Contains("cs.access", user.Permissions);
        var html = await client.GetStringAsync("/Admin/Users");
        var add = Regex.Match(html, "<form[^>]*data-add-account-form[^>]*>(?s:.*?)</form>").Value;
        var row = Regex.Match(html, $"<tr[^>]*data-row-key=\"user-{user.Id}\"[^>]*>(?s:.*?)</tr>").Value;
        var detail = Regex.Match(html, $"<tr[^>]*data-user-details=\"user-{user.Id}\"[^>]*>(?s:.*?)</tr>").Value;
        foreach (var field in AccountFields.All)
        {
            Assert.Contains($"data-account-field=\"{field.Key}\"", add);
            Assert.Contains($"name=\"{field.Key}\"", add);
            Assert.Contains($"data-account-field=\"{field.Key}\"", row + detail);
            Assert.Matches($"name=\"updates\\[\\d+\\]\\.{field.Key}\"", row + detail);
        }
        Assert.Equal(AccountFields.All.Select(x => x.Key).Order(), typeof(AccountInput).GetProperties().Select(x => x.Name).Order());
        fields.Remove("__RequestVerificationToken");
        fields["Name"] = "수정 직원"; fields["IsActive"] = "false"; fields.Remove("IsPrivate");
        fields["Permissions"] = "statistics.access";
        var updates = fields.ToDictionary(x => "updates[0]." + x.Key, x => x.Value);
        updates["updates[0].Id"] = user.Id.ToString(); updates["updates[0].UpdatedAtTicks"] = user.UpdatedAtUtc.Ticks.ToString();
        Assert.Equal(HttpStatusCode.Redirect, (await Post(client, "BulkUpdate", updates)).StatusCode);
        var changed = await User(factory, fields["Email"]);
        Assert.Equal("수정 직원", changed.Name); Assert.False(changed.IsPrivate); Assert.False(changed.IsActive);
        Assert.Contains("statistics.access", PermissionCatalog.Parse(changed.Permissions)); Assert.DoesNotContain("cs.access", PermissionCatalog.Parse(changed.Permissions));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.ProjectMemberships.AnyAsync(x => x.EmployeeId == user.Id && x.ProjectId == projectId));
            Assert.True(await db.LeaveProjectionOutbox.AnyAsync(x => x.CompanyUserId == user.Id));
        }
        // A stale submission cannot overwrite a newer version or partially change an account.
        updates["updates[0].Name"] = "오래된 변경";
        var stale = await Post(client, "BulkUpdate", updates);
        Assert.Equal(HttpStatusCode.OK, stale.StatusCode);
        Assert.Contains("다른 곳에서 변경", WebUtility.HtmlDecode(await stale.Content.ReadAsStringAsync()));
        Assert.Equal("수정 직원", (await User(factory, fields["Email"])).Name);
    }

    [Theory]
    [InlineData("Role", "master")]
    [InlineData("Name", "")]
    [InlineData("Email", "invalid")]
    [InlineData("HireDate", "not-a-date")]
    [InlineData("BirthDate", "not-a-date")]
    [InlineData("BirthDate", "1993-08-17")]
    [InlineData("BirthDate", "02-30")]
    [InlineData("AccountType", "unknown")]
    [InlineData("DepartmentId", "not-an-id")]
    [InlineData("ProjectIds", "not-an-id")]
    public async Task BothHandlersRejectInvalidOrUnauthorizedFields(string key, string value)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory, client, false, true);
        var fields = Fields(); Assert.Equal(HttpStatusCode.Redirect, (await Post(client, "Add", fields)).StatusCode);
        var user = await User(factory, fields["Email"]);
        fields.Remove("__RequestVerificationToken");
        var badAdd = new Dictionary<string,string>(fields) { ["Email"] = "invalid-new@example.test", [key] = value };
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "Add", badAdd)).StatusCode);
        using (var scope = factory.Services.CreateScope()) Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(x => x.Email == "invalid-new@example.test"));
        fields[key] = value;
        var updates = fields.ToDictionary(x => "updates[0]." + x.Key, x => x.Value);
        updates["updates[0].Id"] = user.Id.ToString(); updates["updates[0].UpdatedAtTicks"] = user.UpdatedAtUtc.Ticks.ToString();
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "BulkUpdate", updates)).StatusCode);
        Assert.Equal(user.UpdatedAtUtc, (await User(factory, user.Email)).UpdatedAtUtc);
    }

    [Fact]
    public async Task LegacyUpdateAndBulkProtectionPreserveExistingAuthorization()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var master = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        using var admin = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (owner, _) = await WorkspaceTests.Login(factory, master, false, true, true);
        await WorkspaceTests.Login(factory, admin, false, true);
        var fields = Fields();
        Assert.Equal(HttpStatusCode.Redirect, (await Post(master, "Add", fields)).StatusCode);
        var user = await User(factory, fields["Email"]);
        fields["id"] = user.Id.ToString(); fields["Name"] = "호환 수정";
        fields.Remove("Role"); fields["isAdmin"] = "true";
        Assert.Equal(HttpStatusCode.Redirect, (await Post(master, "Update", fields)).StatusCode);
        user = await User(factory, user.Email); Assert.True(user.IsAdmin); Assert.Equal("호환 수정", user.Name);
        var update = Fields(user.Email).ToDictionary(x => "updates[0]." + x.Key, x => x.Value);
        update["updates[0].Id"] = user.Id.ToString(); update["updates[0].UpdatedAtTicks"] = user.UpdatedAtUtc.Ticks.ToString();
        Assert.Equal(HttpStatusCode.OK, (await Post(admin, "BulkUpdate", update)).StatusCode);
        Assert.Equal(user.UpdatedAtUtc, (await User(factory, user.Email)).UpdatedAtUtc);
        update["updates[0].Id"] = owner.Id.ToString(); update["updates[0].Email"] = owner.Email;
        update["updates[0].UpdatedAtTicks"] = owner.UpdatedAtUtc.Ticks.ToString();
        Assert.Equal(HttpStatusCode.OK, (await Post(master, "BulkUpdate", update)).StatusCode);
        Assert.True((await User(factory, owner.Email)).IsMaster);
    }

    [Fact]
    public async Task SharedAccountsAndLegacyRoleInputsKeepServerRestrictions()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory, client, false, true, true);
        var fields = Fields(); fields["AccountType"] = "shared"; fields.Remove("HireDate");
        Assert.Equal(HttpStatusCode.Redirect, (await Post(client, "Add", fields)).StatusCode);
        var shared = await User(factory, fields["Email"]); Assert.True(shared.IsSharedAccount); Assert.True(shared.IsPrivate); Assert.Null(shared.BirthDate);
        using (var scope = factory.Services.CreateScope()) Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().LeaveProjectionOutbox.AnyAsync(x => x.CompanyUserId == shared.Id));
        fields["Email"] = "legacy-role@example.test"; fields.Remove("Role"); fields["isAdmin"] = "true";
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "Add", fields)).StatusCode); // Shared + elevated role forbidden.
        fields["AccountType"] = "employee"; fields["HireDate"] = "2024-05-07";
        Assert.Equal(HttpStatusCode.Redirect, (await Post(client, "Add", fields)).StatusCode);
        Assert.True((await User(factory, fields["Email"])).IsAdmin);
        // Antiforgery remains required even with otherwise valid fields.
        fields.Remove("__RequestVerificationToken");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/Admin/Users?handler=Add", new FormUrlEncodedContent(fields))).StatusCode);
    }
}
