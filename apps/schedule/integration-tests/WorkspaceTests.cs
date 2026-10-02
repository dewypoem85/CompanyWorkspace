using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

public class WorkspaceTests
{
    [Fact] public async Task ProjectIconsAndPrivatePhotosRespectCurrentPermissions()
    {
        await using var f = new ContractFactory<CompanyUser>();
        using var admin = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect=false });
        using var member = f.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect=false });
        var (owner, _) = await Login(f,admin,false,true); await Login(f,member,false,false);
        long projectId;
        using (var scope=f.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var project=new CompanyProject { Name="비공개 프로젝트",IsPrivate=true }; db.Projects.Add(project);
            (await db.Users.FindAsync(owner.Id))!.IsPrivate=true; await db.SaveChangesAsync(); projectId=project.Id;
        }
        var context=await admin.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.Equal(HttpStatusCode.Forbidden,(await admin.PostAsync($"/api/workspace/project-icon/{projectId}",new ByteArrayContent(Png()))).StatusCode);
        admin.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        (await admin.PostAsync("/api/workspace/avatar",new ByteArrayContent(Png()))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest,(await admin.PostAsync($"/api/workspace/project-icon/{projectId}",new ByteArrayContent([1,2,3]))).StatusCode);
        (await admin.PostAsync($"/api/workspace/project-icon/{projectId}",new ByteArrayContent(Png()))).EnsureSuccessStatusCode();
        var imageResponse=await admin.GetAsync($"/api/workspace/project-icon/{projectId}");
        Assert.True(imageResponse.Headers.CacheControl!.NoStore);
        Assert.Equal(Png(),await imageResponse.Content.ReadAsByteArrayAsync());
        var publicContext=await member.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.Empty(publicContext.GetProperty("projects").EnumerateArray());
        Assert.Empty(publicContext.GetProperty("projectIcons").EnumerateObject());
        Assert.False(publicContext.GetProperty("profiles").TryGetProperty(owner.Id.ToString(),out _));
        member.DefaultRequestHeaders.Add("X-Workspace-CSRF",publicContext.GetProperty("csrfToken").GetString());
        Assert.Equal(HttpStatusCode.NotFound,(await member.GetAsync($"/api/workspace/avatar/{owner.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await member.GetAsync($"/api/workspace/project-icon/{projectId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await member.DeleteAsync($"/api/workspace/project-icon/{projectId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await member.PostAsync($"/api/workspace/project-icon/{projectId}",new ByteArrayContent(Png()))).StatusCode);
        using (var scope=f.Services.CreateScope()) {
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Projects.FindAsync(projectId))!.IsPrivate=false;
            (await db.Users.FindAsync(owner.Id))!.IsPrivate=false; await db.SaveChangesAsync();
        }
        publicContext=await member.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.Single(publicContext.GetProperty("projects").EnumerateArray());
        Assert.True(publicContext.GetProperty("profiles").TryGetProperty(owner.Id.ToString(),out _));
        Assert.Equal(HttpStatusCode.OK,(await member.GetAsync($"/api/workspace/project-icon/{projectId}")).StatusCode);
        (await admin.DeleteAsync($"/api/workspace/project-icon/{projectId}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound,(await admin.GetAsync($"/api/workspace/project-icon/{projectId}")).StatusCode);
    }
    [Theory]
    [InlineData(false, false, "schedule,leave")]
    [InlineData(true, false, "cs")]
    [InlineData(false, true, "schedule,leave,cs,statistics,sheet,iap")]
    public async Task ContextFiltersServicesAndProfileIsReadOnly(bool shared, bool admin, string expected)
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (user, sid) = await Login(factory, client, shared, admin);
        var response = await client.GetAsync("/api/workspace/context");
        response.EnsureSuccessStatusCode();
        var context = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(expected, string.Join(",", context.GetProperty("services").EnumerateArray().Select(s => s.GetProperty("key").GetString())));
        Assert.Equal(admin, context.GetProperty("isAdmin").GetBoolean());
        Assert.True(response.Headers.CacheControl!.NoStore);
        var csrf = context.GetProperty("csrfToken").GetString()!;
        var snapshots=Environment.GetEnvironmentVariable("WORKSPACE_UI_SNAPSHOTS");
        if (!string.IsNullOrEmpty(snapshots) && admin)
        {
            Directory.CreateDirectory(snapshots);
            await File.WriteAllTextAsync(Path.Combine(snapshots,"portal.html"),await client.GetStringAsync("/"));
            await File.WriteAllTextAsync(Path.Combine(snapshots,"profile.html"),await client.GetStringAsync("/settings/profile"));
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/workspace/avatar", new ByteArrayContent([1,2,3]))).StatusCode);
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF", csrf);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/workspace/avatar", new ByteArrayContent([1,2,3]))).StatusCode);
        var png = Png();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/workspace/avatar", new ByteArrayContent(png))).StatusCode);
        Assert.Equal(png, await client.GetByteArrayAsync($"/api/workspace/avatar/{user.Id}"));
        var bad = png.ToArray(); bad[^5] ^= 1;
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/workspace/avatar", new ByteArrayContent(bad))).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsJsonAsync("/api/workspace/context", new {name="changed",role="master"})).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/workspace/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/workspace/avatar/{user.Id}")).StatusCode);
        var deletedContext = await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.False(deletedContext.GetProperty("profiles").TryGetProperty(user.Id.ToString(), out _));
        using var scope=factory.Services.CreateScope();
        Assert.Equal("테스트", (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync(x=>x.Id==user.Id)).Name);
    }

    [Fact]
    public async Task ProfileDirectorySharesLatestPhotoWithOtherUsersAndServiceOrigins()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var owner = factory.CreateClient();
        using var colleague = factory.CreateClient();
        var (user, _) = await Login(factory, owner, false, false);
        await Login(factory, colleague, false, false);
        var context = await owner.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        owner.DefaultRequestHeaders.Add("X-Workspace-CSRF", context.GetProperty("csrfToken").GetString());
        var saved = await owner.PostAsync("/api/workspace/avatar", new ByteArrayContent(Png()));
        saved.EnsureSuccessStatusCode();
        var firstUrl = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("avatarUrl").GetString();
        foreach (var service in new[] { "cs", "statistics", "leave", "schedule", "sheet" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/workspace/context");
            request.Headers.Add("Origin", $"https://{service}.example.com");
            var response = await colleague.SendAsync(request);
            response.EnsureSuccessStatusCode();
            Assert.Equal($"https://{service}.example.com", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
            Assert.Equal("true", response.Headers.GetValues("Access-Control-Allow-Credentials").Single());
            var shared = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(firstUrl, shared.GetProperty("profiles").GetProperty(user.Id.ToString()).GetString());
            Assert.Equal(Png(), await colleague.GetByteArrayAsync(firstUrl));
        }
        saved = await owner.PostAsync("/api/workspace/avatar", new ByteArrayContent(Png()));
        saved.EnsureSuccessStatusCode();
        var nextUrl = (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("avatarUrl").GetString();
        Assert.NotEqual(firstUrl, nextUrl);
        var latest = await colleague.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.Equal(nextUrl, latest.GetProperty("profiles").GetProperty(user.Id.ToString()).GetString());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Users.SingleAsync(x=>x.Id==user.Id)).IsActive = false;
            await db.SaveChangesAsync();
        }
        latest = await colleague.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        Assert.False(latest.GetProperty("profiles").TryGetProperty(user.Id.ToString(), out _));
        using var anonymous = factory.CreateClient();
        Assert.False((await anonymous.GetFromJsonAsync<JsonElement>("/api/workspace/context")).TryGetProperty("profiles", out _));
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(firstUrl)).StatusCode);
    }

    [Fact]
    public async Task LogoutRevokesAllServiceChecksForThisBrowserButNotOtherSessions()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client=factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        var (user,sid)=await Login(factory,client,false,true);
        using var other=factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        using var scope=factory.Services.CreateScope();
        var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var otherSid=await WorkspaceApi.CreateSessionAsync(db,user.Id);
        async Task<HttpStatusCode> Check(string service,string session)
        {
            var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var body=Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new {iss=service,aud="workspace-session",sub=user.Id.ToString(),sid=session,iat=now,exp=now+60,jti=Guid.NewGuid().ToString()})).TrimEnd('=').Replace('+','-').Replace('/','_');
            var signature=Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(ContractFactory<CompanyUser>.Secret),Encoding.UTF8.GetBytes(body))).TrimEnd('=').Replace('+','-').Replace('/','_');
            using var request=new HttpRequestMessage(HttpMethod.Get,"/api/internal/workspace/session");
            request.Headers.Authorization=new("Bearer",body+"."+signature);
            return (await other.SendAsync(request)).StatusCode;
        }
        foreach(var service in new[]{"leave","schedule","cs","statistics","sheet"}) Assert.Equal(HttpStatusCode.NoContent,await Check(service,sid));
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsync("/api/workspace/logout",null)).StatusCode);
        foreach(var service in new[]{"leave","schedule","cs","statistics","sheet"}) Assert.Equal(HttpStatusCode.Unauthorized,await Check(service,sid));
        Assert.Equal(HttpStatusCode.NoContent,await Check("cs",otherSid));
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/workspace/context")).GetProperty("authenticated").GetBoolean());
    }

    internal static async Task<(CompanyUser,string)> Login(ContractFactory<CompanyUser> factory,HttpClient client,bool shared,bool admin,bool master=false)
    {
        using var scope=factory.Services.CreateScope(); var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user=new CompanyUser {Name="테스트",Email=Guid.NewGuid()+"@example.test",IsSharedAccount=shared,IsAdmin=admin||master,IsMaster=master,Permissions=shared?"cs.access":""};
        db.Users.Add(user); await db.SaveChangesAsync();
        var sid=await WorkspaceApi.CreateSessionAsync(db,user.Id);
        var claims=new List<Claim>{new("CompanyUserId",user.Id.ToString()),new(ClaimTypes.Name,user.Name),new("CompanyAccountType",PermissionCatalog.AccountType(user)),new("PermissionSnapshot",string.Join(',',PermissionCatalog.Effective(user))),new(WorkspaceApi.SessionClaim,sid)};
        if(admin||master) claims.Add(new(ClaimTypes.Role,"Admin"));
        if(master) claims.Add(new(ClaimTypes.Role,"Master"));
        var options=factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies");
        var ticket=new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims,"Cookies")),new AuthenticationProperties{IssuedUtc=DateTimeOffset.UtcNow,ExpiresUtc=DateTimeOffset.UtcNow.AddDays(7),IsPersistent=true,AllowRefresh=true},"Cookies");
        client.DefaultRequestHeaders.Add("Cookie","CompanyPortal.Auth="+options.TicketDataFormat.Protect(ticket));
        return(user,sid);
    }


    [Fact]
    public async Task ExistingEmployeePrivacyAndOrganizationRoundTripThroughBulkForm()
    {
        await using var factory = new ContractFactory<CompanyUser>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        await Login(factory, client, false, true);
        CompanyUser employee;
        long departmentId, projectId;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var department = new Department { Name = "개발" };
            var project = new CompanyProject { Name = "비공개 프로젝트 · 긴 프로젝트 이름 테스트", IsPrivate = true };
            db.Departments.Add(department); db.Projects.Add(project);
            employee = new CompanyUser { Name = "기존 직원", Email = "existing@example.test", HireDate = new(2021, 5, 7) };
            db.Users.Add(employee); await db.SaveChangesAsync();
            departmentId = department.Id; projectId = project.Id;
        }
        foreach (var isPrivate in new[] { true, false })
        {
            var html = await client.GetStringAsync("/Admin/Users");
            var token = System.Net.WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Match(html,
                "name=\"__RequestVerificationToken\" type=\"hidden\" value=\"([^\"]+)\"").Groups[1].Value);
            Assert.NotEmpty(token);
            using (var scope = factory.Services.CreateScope())
                employee = (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.FindAsync(employee.Id))!;
            var fields = new Dictionary<string, string> {
                ["__RequestVerificationToken"] = token,
                ["updates[0].Id"] = employee.Id.ToString(),
                ["updates[0].UpdatedAtTicks"] = employee.UpdatedAtUtc.Ticks.ToString(),
                ["updates[0].Name"] = employee.Name, ["updates[0].Email"] = employee.Email,
                ["updates[0].HireDate"] = "2021-05-07", ["updates[0].AccountType"] = "employee",
                ["updates[0].Role"] = "employee", ["updates[0].IsActive"] = "true",
                ["updates[0].DepartmentId"] = departmentId.ToString(),
                ["updates[0].ProjectIds"] = projectId.ToString(),
                ["updates[0].Permissions"] = "cs.access"
            };
            // An unchecked HTML checkbox is omitted, not posted as the string "false".
            if (isPrivate) fields["updates[0].IsPrivate"] = "true";
            var saved = await client.PostAsync("/Admin/Users?handler=BulkUpdate", new FormUrlEncodedContent(fields));
            Assert.Equal(HttpStatusCode.Redirect, saved.StatusCode);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var updated = (await db.Users.FindAsync(employee.Id))!;
                Assert.Equal(isPrivate, updated.IsPrivate);
                Assert.Equal(departmentId, updated.DepartmentId);
                Assert.True(PermissionCatalog.Has(updated, "cs.access"));
                Assert.True(await db.ProjectMemberships.AnyAsync(m => m.EmployeeId == employee.Id && m.ProjectId == projectId));
                Assert.True(await db.LeaveProjectionOutbox.AnyAsync(x => x.CompanyUserId == employee.Id));
            }
            html = await client.GetStringAsync("/Admin/Users");
            var checkbox = Assert.Single(System.Text.RegularExpressions.Regex.Matches(html,
                "<input[^>]*name=\"updates\\[\\d+\\]\\.IsPrivate\"[^>]*>").Cast<System.Text.RegularExpressions.Match>()).Value;
            Assert.Equal(isPrivate, checkbox.Contains("checked="));
            // Existing employee settings must contain the editable field, not only the summary row.
            var detail = System.Text.RegularExpressions.Regex.Match(html,
                "<tr class=\"matrix-detail-row[^\"]*\"[^>]*>(?s:(.*?))</tr>").Value;
            Assert.Contains(checkbox, detail);
            Assert.DoesNotContain("data-private-toggle=", html);
            Assert.Contains("data-privacy-summary=", html);
            using var directoryClient = factory.Signed("schedule-directory");
            var directory = await directoryClient.GetFromJsonAsync<JsonElement>("/api/internal/schedule/directory");
            var exported = directory.GetProperty("employees").EnumerateArray().Single(x => x.GetProperty("id").GetInt64() == employee.Id);
            Assert.Equal(isPrivate, exported.GetProperty("isPrivate").GetBoolean());
            var snapshots = Environment.GetEnvironmentVariable("WORKSPACE_UI_SNAPSHOTS");
            if (!string.IsNullOrEmpty(snapshots) && isPrivate)
            {
                Directory.CreateDirectory(snapshots);
                await File.WriteAllTextAsync(Path.Combine(snapshots, "users.html"), html);
            }
        }
    }

    internal static byte[] Png()
    {
        using var png=new MemoryStream(); png.Write([137,80,78,71,13,10,26,10]);
        void Chunk(string name,byte[] bytes) {
            var type=Encoding.ASCII.GetBytes(name); var length=new byte[4]; System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(length,bytes.Length);png.Write(length);png.Write(type);png.Write(bytes);
            uint crc=0xffffffff;foreach(var b in type.Concat(bytes)){crc^=b;for(var i=0;i<8;i++)crc=(crc>>1)^((crc&1)!=0?0xedb88320u:0);}
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(length,~crc);png.Write(length);
        }
        Chunk("IHDR",[0,0,1,0,0,0,1,0,8,6,0,0,0]);
        using var compressed=new MemoryStream();
        using(var z=new System.IO.Compression.ZLibStream(compressed,System.IO.Compression.CompressionLevel.Optimal,true))z.Write(new byte[256*1025]);
        Chunk("IDAT",compressed.ToArray());Chunk("IEND",[]);
        return png.ToArray();
    }
}
