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

public class ProjectIconFormTests
{
    const string Path="/Admin/Organization?tab=projects&id=1",PostPath="/Admin/Organization?handler=Icon",Media="application/vnd.company.workspace-form+json";
    static string Input(string html,string name)=>WebUtility.HtmlDecode(Regex.Match(html,"name=\""+Regex.Escape(name)+"\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);
    static Task<HttpResponseMessage> Post(HttpClient client,string html,string operation,string? version=null,string? project=null,string? owner=null,byte[]? image=null,bool csrf=true,bool enhanced=true,bool duplicate=false)
    {
        var form=new MultipartFormDataContent();
        foreach(var pair in new Dictionary<string,string>{{"ExpectedUserId",owner??Input(html,"ExpectedUserId")},{"ExpectedVersion",version??Input(html,"ExpectedVersion")},{"ProjectId",project??Input(html,"ProjectId")},{"Operation",operation}})form.Add(new StringContent(pair.Value),pair.Key);
        if(csrf)form.Add(new StringContent(Input(html,"__RequestVerificationToken")),"__RequestVerificationToken");
        if(duplicate)form.Add(new StringContent("2"),"ProjectId");
        if(image is not null)form.Add(new ByteArrayContent(image),"Photo","icon.png");
        var request=new HttpRequestMessage(HttpMethod.Post,PostPath){Content=form};if(enhanced)request.Headers.Accept.ParseAdd(Media);
        return client.SendAsync(request);
    }
    static async Task Seed(ContractFactory<CompanyUser> factory)
    {
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Projects.AddRange(new CompanyProject{Id=1,Name="비공개 검증 프로젝트",IsPrivate=true},new CompanyProject{Id=2,Name="별도 프로젝트"});await db.SaveChangesAsync();
    }
    [Fact]
    public async Task IconCreateReplaceAndRemoveHaveIndependentVersionsAndRemainVisibleThroughExistingContext()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (user,_)=await WorkspaceTests.Login(factory,client,false,true);await Seed(factory);
        var html=await client.GetStringAsync(Path);Assert.Equal("1",Input(html,"ProjectId"));Assert.Equal("",Input(html,"ExpectedVersion"));
        var first=await Post(client,html,"save",image:WorkspaceTests.Png());first.EnsureSuccessStatusCode();
        var receipt=await first.Content.ReadFromJsonAsync<JsonElement>();var data=receipt.GetProperty("data");var version=data.GetProperty("version").GetString()!;
        Assert.Equal(Media,first.Content.Headers.ContentType!.MediaType);Assert.True(first.Headers.CacheControl!.NoStore);
        Assert.Equal(user.Id.ToString(),data.GetProperty("userId").GetString());Assert.Equal("1",data.GetProperty("projectId").GetString());Assert.Equal("",data.GetProperty("previousVersion").GetString());
        Assert.Equal(WorkspaceTests.Png(),await client.GetByteArrayAsync(data.GetProperty("iconUrl").GetString()!));
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.Equal(data.GetProperty("iconUrl").GetString(),context.GetProperty("projectIcons").GetProperty("1").GetString());
        Assert.Empty(context.GetProperty("profiles").EnumerateObject());
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"save",image:WorkspaceTests.Png())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"remove")).StatusCode);
        var edit=await client.GetStringAsync(Path);Assert.Equal(version,Input(edit,"ExpectedVersion"));
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(!string.IsNullOrEmpty(output)){
            Directory.CreateDirectory(output);await File.WriteAllTextAsync(System.IO.Path.Combine(output,"project-icon.edit.html"),edit);
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,"project-icon.context.json"),context.GetRawText());
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,"project-icon.saved.json"),await first.Content.ReadAsStringAsync());
        }
        var second=await Post(client,edit,"save",image:WorkspaceTests.Png());second.EnsureSuccessStatusCode();
        Assert.NotEqual(version,(await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("version").GetString());
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,edit,"remove")).StatusCode);
        var fresh=await client.GetStringAsync(Path);var deleted=await Post(client,fresh,"remove");deleted.EnsureSuccessStatusCode();
        var removal=(await deleted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");Assert.Equal("",removal.GetProperty("version").GetString());Assert.Equal(JsonValueKind.Null,removal.GetProperty("iconUrl").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(data.GetProperty("iconUrl").GetString())).StatusCode);
        using var checkScope=factory.Services.CreateScope();var db=checkScope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1,(await db.Projects.FindAsync(1L))!.Version);Assert.Equal("비공개 검증 프로젝트",(await db.Projects.FindAsync(1L))!.Name);
        Assert.Empty(await db.ProjectMemberships.ToArrayAsync());Assert.Empty(await db.DepartmentLeads.ToArrayAsync());
        Assert.Equal(0,await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM WorkspaceProfiles").SingleAsync());
    }
    [Fact]
    public async Task IconFormRejectsCsrfWrongAccountTargetVersionAndInvalidFilesWithoutLeakingDatabaseErrors()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true);await Seed(factory);var html=await client.GetStringAsync(Path);
        Assert.Equal(HttpStatusCode.BadRequest,(await Post(client,html,"save",image:WorkspaceTests.Png(),csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"save",image:WorkspaceTests.Png(),owner:"9999")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"save",image:WorkspaceTests.Png(),project:"9999")).StatusCode);
        foreach(var version in new[]{"bad",new string('a',32)+"\n"})Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",image:WorkspaceTests.Png(),version:version)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",image:WorkspaceTests.Png(),duplicate:true)).StatusCode);
        foreach(var bytes in new[]{new byte[]{1,2,3},new byte[524289]})Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",image:bytes)).StatusCode);
        var invalid=await Post(client,html,"save",image:[1,2,3],enhanced:false);Assert.Equal(HttpStatusCode.UnprocessableEntity,invalid.StatusCode);var invalidHtml=await invalid.Content.ReadAsStringAsync();Assert.Contains("data-project-icon-form",invalidHtml);Assert.Equal("비공개 검증 프로젝트",Input(invalidHtml,"Form.Name"));
        var invalidTarget=await Post(client,html,"save",project:"bad",image:WorkspaceTests.Png(),enhanced:false);Assert.Equal(HttpStatusCode.UnprocessableEntity,invalidTarget.StatusCode);Assert.Contains("프로젝트 아이콘을 확인해 주세요.",WebUtility.HtmlDecode(await invalidTarget.Content.ReadAsStringAsync()));
        using(var scope=factory.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_icon BEFORE INSERT ON WorkspaceProjectIcons BEGIN SELECT RAISE(ABORT,'ICON_DATABASE_CANARY'); END");
        var failure=await Post(client,html,"save",image:WorkspaceTests.Png());Assert.Equal(HttpStatusCode.InternalServerError,failure.StatusCode);Assert.DoesNotContain("ICON_DATABASE_CANARY",await failure.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task NativeIconPostPreservesRedirectAndNonAdminCannotReadPrivateIconOrWriteAnyIcon()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var admin=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,admin,false,true);await Seed(factory);var html=await admin.GetStringAsync(Path);
        Assert.Equal(HttpStatusCode.Redirect,(await Post(admin,html,"save",image:WorkspaceTests.Png(),enhanced:false)).StatusCode);
        using var employee=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});await WorkspaceTests.Login(factory,employee,false,false);
        Assert.Equal(HttpStatusCode.NotFound,(await employee.GetAsync("/api/workspace/project-icon/1")).StatusCode);
        var settings=await employee.GetStringAsync("/settings/profile");var rejected=await Post(employee,settings,"save",project:"2",version:"",image:WorkspaceTests.Png());
        Assert.Equal(HttpStatusCode.Redirect,rejected.StatusCode);Assert.Contains("AccessDenied",rejected.Headers.Location!.ToString());
        using var scope=factory.Services.CreateScope();Assert.Equal(1,await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.SqlQueryRaw<int>("SELECT COUNT(*) AS Value FROM WorkspaceProjectIcons").SingleAsync());
    }
}
