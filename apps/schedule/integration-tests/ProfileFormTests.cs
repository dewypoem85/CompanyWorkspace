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

public class ProfileFormTests
{
    const string Path = "/settings/profile", MediaType = "application/vnd.company.workspace-form+json";
    static string Input(string html, string name) => WebUtility.HtmlDecode(Regex.Match(html,"name=\""+Regex.Escape(name)+"\"[^>]*value=\"([^\"]*)\"").Groups[1].Value);
    static Task<HttpResponseMessage> Post(HttpClient client,string html,string operation,string? version=null,string? owner=null,byte[]? image=null,bool enhanced=true,bool csrf=true,bool duplicate=false)
    {
        var data=new MultipartFormDataContent();
        data.Add(new StringContent(owner??Input(html,"ExpectedUserId")),"ExpectedUserId");
        data.Add(new StringContent(version??Input(html,"ExpectedVersion")),"ExpectedVersion");
        data.Add(new StringContent(operation),"Operation");
        if(duplicate)data.Add(new StringContent(operation),"Operation");
        if(csrf)data.Add(new StringContent(Input(html,"__RequestVerificationToken")),"__RequestVerificationToken");
        if(image is not null)data.Add(new ByteArrayContent(image),"Photo","profile.png");
        var request=new HttpRequestMessage(HttpMethod.Post,Path){Content=data};
        if(enhanced)request.Headers.Accept.ParseAdd(MediaType);
        return client.SendAsync(request);
    }
    [Fact]
    public async Task ProfileFormSharesActualPhotoAndRejectsStaleVersionWithoutChangingOtherAccountFields()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (user,_)=await WorkspaceTests.Login(factory,client,false,true);
        var html=await client.GetStringAsync(Path);Assert.NotEmpty(Input(html,"__RequestVerificationToken"));
        Assert.Equal(user.Id.ToString(),Input(html,"ExpectedUserId"));Assert.Equal("",Input(html,"ExpectedVersion"));
        var first=await Post(client,html,"save",image:WorkspaceTests.Png());Assert.Equal(HttpStatusCode.OK,first.StatusCode);
        var receipt=await first.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("saved",receipt.GetProperty("outcome").GetString());
        Assert.Equal(MediaType,first.Content.Headers.ContentType!.MediaType);Assert.True(first.Headers.CacheControl!.NoStore);
        var value=receipt.GetProperty("data");var version=value.GetProperty("version").GetString()!;
        Assert.Equal(user.Id.ToString(),value.GetProperty("userId").GetString());Assert.Equal("save",value.GetProperty("operation").GetString());
        Assert.Equal(WorkspaceTests.Png(),await client.GetByteArrayAsync(value.GetProperty("avatarUrl").GetString()!));
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"save",image:WorkspaceTests.Png())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"remove")).StatusCode);
        var fresh=await client.GetStringAsync(Path);Assert.Equal(version,Input(fresh,"ExpectedVersion"));
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(output)){
            Directory.CreateDirectory(output);await File.WriteAllTextAsync(System.IO.Path.Combine(output,"profile.edit.html"),fresh);
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,"profile.context.json"),await client.GetStringAsync("/api/workspace/context"));
            await File.WriteAllTextAsync(System.IO.Path.Combine(output,"profile.saved.json"),await first.Content.ReadAsStringAsync());
        }
        var deleted=await Post(client,fresh,"remove");Assert.Equal(HttpStatusCode.OK,deleted.StatusCode);
        var removal=(await deleted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");Assert.Equal("",removal.GetProperty("version").GetString());Assert.Equal(JsonValueKind.Null,removal.GetProperty("avatarUrl").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync(value.GetProperty("avatarUrl").GetString())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,fresh,"save",image:WorkspaceTests.Png())).StatusCode);
        using var scope=factory.Services.CreateScope();var stored=await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.FindAsync(user.Id);
        Assert.Equal(user.Name,stored!.Name);Assert.Equal(user.Email,stored.Email);Assert.Equal(user.IsAdmin,stored.IsAdmin);
    }
    [Fact]
    public async Task ProfileFormRequiresCsrfExactAccountAndValidPhotoAndDoesNotLeakDatabaseErrors()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (user,_)=await WorkspaceTests.Login(factory,client,false,false);var html=await client.GetStringAsync(Path);
        Assert.Equal(HttpStatusCode.BadRequest,(await Post(client,html,"save",image:WorkspaceTests.Png(),csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Post(client,html,"remove",owner:(user.Id+1).ToString())).StatusCode);
        foreach(var op in new[]{"unknown","save"})Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,op,image:[1,2,3])).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",version:"bad",image:WorkspaceTests.Png())).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",version:new string('a',32)+"\n",image:WorkspaceTests.Png())).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await Post(client,html,"save",image:WorkspaceTests.Png(),duplicate:true)).StatusCode);
        using(var scope=factory.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_profile BEFORE INSERT ON WorkspaceProfiles BEGIN SELECT RAISE(ABORT,'PROFILE_DATABASE_CANARY'); END");
        var failure=await Post(client,html,"save",image:WorkspaceTests.Png());Assert.Equal(HttpStatusCode.InternalServerError,failure.StatusCode);
        var text=await failure.Content.ReadAsStringAsync();Assert.DoesNotContain("PROFILE_DATABASE_CANARY",text);Assert.Equal("unknown",JsonDocument.Parse(text).RootElement.GetProperty("outcome").GetString());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/workspace/avatar/{user.Id}")).StatusCode);
    }
    [Fact]
    public async Task NativeProfilePostKeepsCsrfAndRedirectAndShowsValidationWithoutFalseSuccess()
    {
        await using var factory=new ContractFactory<CompanyUser>();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,true,false);var html=await client.GetStringAsync(Path);
        var failure=await Post(client,html,"save",image:[1,2,3],enhanced:false);Assert.Equal(HttpStatusCode.UnprocessableEntity,failure.StatusCode);Assert.Contains("data-workspace-state=\"error\"",await failure.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Redirect,(await Post(client,html,"save",image:WorkspaceTests.Png(),enhanced:false)).StatusCode);
    }
}
