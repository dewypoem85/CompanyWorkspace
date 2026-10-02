using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class OrganizationFormTests
{
    const string Path = "/Admin/Organization", Media = "application/vnd.company.workspace-form+json";
    static string Input(string html, string name) => WebUtility.HtmlDecode(Regex.Match(html, "name=\"" + Regex.Escape(name) + "\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);
    static Task<HttpResponseMessage> Post(HttpClient client, string html, string tab, string name,
        string? owner = null, string? version = null, string? id = null, bool enhanced = true, bool csrf = true, string color = "#336699", string[]? members = null, bool duplicate = false)
    {
        var fields = new List<KeyValuePair<string,string>> {
            new("Tab",tab), new("Form.Id",id ?? Input(html,"Form.Id")), new("Form.Version",version ?? Input(html,"Form.Version")),
            new("Form.Name",name), new("Form.Color",color), new("Form.IsPrivate","true"), new("Form.IsPrivate","false"),
            new("Form.Archived","false"), new("ExpectedUserId",owner ?? Input(html,"ExpectedUserId")) };
        foreach(var member in members ?? []) fields.Add(new("Form.EmployeeIds",member));
        if(csrf)fields.Add(new("__RequestVerificationToken",Input(html,"__RequestVerificationToken")));
        if(duplicate)fields.Add(new("Form.Id","99999"));
        var request = new HttpRequestMessage(HttpMethod.Post,Path) { Content = new FormUrlEncodedContent(fields) };
        if(enhanced)request.Headers.Accept.ParseAdd(Media);
        return client.SendAsync(request);
    }
    [Theory]
    [InlineData("departments")]
    [InlineData("projects")]
    public async Task ActualCreateEditPostConfirmsOnlyCommittedVersionAndPreservesNativeRedirect(string tab)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (user,_) = await WorkspaceTests.Login(factory,client,false,true);
        var html = await client.GetStringAsync(Path+(tab == "projects" ? "?tab=projects" : ""));
        Assert.Equal(tab,Input(html,"Tab"));
        Assert.NotEmpty(Input(html,"__RequestVerificationToken")); Assert.Equal(user.Id.ToString(),Input(html,"ExpectedUserId"));
        var saved = await Post(client,html,tab,"  검증 조직  "); saved.EnsureSuccessStatusCode();
        Assert.Equal(Media,saved.Content.Headers.ContentType!.MediaType); Assert.True(saved.Headers.CacheControl!.NoStore);
        var json = await saved.Content.ReadFromJsonAsync<JsonElement>(); var data = json.GetProperty("data");
        Assert.Equal("saved",json.GetProperty("outcome").GetString()); Assert.Equal("",data.GetProperty("previousId").GetString());
        Assert.Equal("0",data.GetProperty("previousVersion").GetString()); Assert.Equal("1",data.GetProperty("version").GetString());
        var id = data.GetProperty("id").GetString()!; var edit = await client.GetStringAsync(Path+"?tab="+tab+"&id="+id);
        Assert.Equal("검증 조직",Input(edit,"Form.Name")); Assert.Equal(id,Input(edit,"Form.Id"));
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(output)) {
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,$"organization.{tab}.create.html"),html);
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,$"organization.{tab}.edit.html"),edit);
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,$"organization.{tab}.saved.json"),await saved.Content.ReadAsStringAsync());
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,$"organization.{tab}.context.json"),await client.GetStringAsync("/api/workspace/context"));
        }
        var updated = await Post(client,edit,tab,"수정 조직"); updated.EnsureSuccessStatusCode();
        var receipt = (await updated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal(id,receipt.GetProperty("previousId").GetString()); Assert.Equal("2",receipt.GetProperty("version").GetString());
        var stale = await Post(client,edit,tab,"오래된 초안"); Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var nativeStale = await Post(client,edit,tab,"보존할 초안",enhanced:false);
        Assert.Equal(HttpStatusCode.Conflict,nativeStale.StatusCode); var recovery = await nativeStale.Content.ReadAsStringAsync();
        Assert.Equal("보존할 초안",Input(recovery,"Form.Name")); Assert.Equal("1",Input(recovery,"Form.Version")); Assert.Contains("data-write-locked=\"true\"",recovery);
        var fresh = await client.GetStringAsync(Path+"?tab="+tab+"&id="+id);
        Assert.Equal("수정 조직",Input(fresh,"Form.Name"));
        Assert.Equal(HttpStatusCode.Redirect,(await Post(client,fresh,tab,"정상 native 수정",enhanced:false)).StatusCode);
        var missing = await client.GetAsync(Path+"?tab="+tab+"&id=99999"); Assert.Equal(HttpStatusCode.NotFound,missing.StatusCode);
        Assert.Contains("data-write-locked=\"true\"",await missing.Content.ReadAsStringAsync());
        var malformed=await client.GetAsync(Path+"?tab="+tab+"&id=bad");Assert.Equal(HttpStatusCode.BadRequest,malformed.StatusCode);
        Assert.Contains("data-write-locked=\"true\"",await malformed.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task OrganizationFormRejectsWrongAccountCsrfInvalidMembersAndLeaksNoDatabaseDetails()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await WorkspaceTests.Login(factory,client,false,true);var html=await client.GetStringAsync(Path+"?tab=projects");
        Assert.Equal(HttpStatusCode.BadRequest,(await Post(client,html,"projects","새 조직",csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"projects","새 조직",owner:"9999")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"projects","새 조직",duplicate:true)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"projects","새 조직",members:["9999"])).StatusCode);
        var missingMember=await Post(client,html,"projects","원문 보관 <script>canary()</script>",members:["9999"],enhanced:false);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,missingMember.StatusCode);var missingHtml=await missingMember.Content.ReadAsStringAsync();
        Assert.Contains("data-write-locked=\"true\"",missingHtml);Assert.Contains("9999",missingHtml);Assert.Contains("전송한 입력 보관",WebUtility.HtmlDecode(missingHtml));Assert.DoesNotContain("<script>canary()</script>",missingHtml);
        var snapshots=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(snapshots)){Directory.CreateDirectory(snapshots);await File.WriteAllTextAsync(System.IO.Path.Combine(snapshots,"organization.recovery.html"),missingHtml);}
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"projects","새 조직",color:"#abcdef\n")).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"projects","새 조직",version:"3")).StatusCode);
        var invalid = await Post(client,html,"projects","  ",enhanced:false);Assert.Equal(HttpStatusCode.UnprocessableEntity,invalid.StatusCode);
        Assert.Equal("  ",Input(await invalid.Content.ReadAsStringAsync(),"Form.Name"));
        using(var scope=factory.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();Assert.Empty(await db.Projects.ToListAsync());
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_organization BEFORE INSERT ON Projects BEGIN SELECT RAISE(ABORT,'ORGANIZATION_DATABASE_CANARY'); END");
        }
        var failure=await Post(client,html,"projects","새 조직");Assert.Equal(HttpStatusCode.InternalServerError,failure.StatusCode);
        var body=await failure.Content.ReadAsStringAsync();Assert.DoesNotContain("ORGANIZATION_DATABASE_CANARY",body);Assert.Contains("unknown",body);
        var nativeFailure=await Post(client,html,"projects","보존할 DB 오류 초안",enhanced:false);
        Assert.Equal(HttpStatusCode.InternalServerError,nativeFailure.StatusCode);var failedHtml=await nativeFailure.Content.ReadAsStringAsync();
        Assert.Contains("data-write-locked=\"true\"",failedHtml);Assert.Equal("보존할 DB 오류 초안",Input(failedHtml,"Form.Name"));Assert.DoesNotContain("ORGANIZATION_DATABASE_CANARY",failedHtml);
        using var finalScope=factory.Services.CreateScope();Assert.Empty(await finalScope.ServiceProvider.GetRequiredService<AppDbContext>().Projects.ToListAsync());
    }
}
