using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Workspace;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class PortalPageTests
{
    sealed class PortalFactory : ContractFactory<CompanyUser>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services => services.AddHttpClient("NotificationSources").ConfigurePrimaryHttpMessageHandler(() => new EmptyNotifications()));
        }
    }
    sealed class EmptyNotifications : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { items = Array.Empty<object>(), unreadCount = 0 }) });
    }

    [Theory]
    [InlineData("guest")]
    [InlineData("employee")]
    [InlineData("shared")]
    [InlineData("admin")]
    [InlineData("master")]
    public async Task RegisteredPagesUseSharedLayoutAndTheSameServerPoliciesAsTheirNavigation(string role)
    {
        await using var factory = new PortalFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (role != "guest") await WorkspaceTests.Login(factory, client, role == "shared", role == "admin", role == "master");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Departments.Add(new() { Name = "개발" });
            db.Projects.Add(new() { Name = "검증 프로젝트", Color = "#5563d8", IsPrivate = true });
            db.Users.Add(new() { Name = "검증 직원", Email = "example-employee@example.test", IsPrivate = true, IsActive = true });
            await db.SaveChangesAsync();
        }
        bool Allowed(WorkspacePage page) => page.Anonymous || page.Policy switch
        {
            "EmployeeOnly" => role != "guest",
            "AdminOnly" => role is "admin" or "master",
            "MasterOnly" => role == "master",
            _ => throw new InvalidOperationException("Add explicit coverage for the new page policy")
        };
        var navigationResponse = await client.GetAsync("/api/workspace/navigation");
        JsonElement? navigation = null;
        if (role == "guest") Assert.Equal(HttpStatusCode.Unauthorized, navigationResponse.StatusCode);
        else
        {
            navigationResponse.EnsureSuccessStatusCode();
            Assert.True(navigationResponse.Headers.CacheControl!.NoStore);
            navigation = await navigationResponse.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(WorkspacePages.All.Where(p => p.Navigation && Allowed(p)).Select(p => p.Id), navigation.Value.GetProperty("pages").EnumerateArray().Select(p => p.GetString()));
        }
        var output = Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        var records = new List<object>();
        foreach (var page in WorkspacePages.All)
        {
            var query = page.Query.Count == 0 ? "" : "?" + string.Join('&', page.Query.Select(pair => pair.Key + "=" + Uri.EscapeDataString(pair.Value)));
            foreach (var path in new[] { page.Path }.Concat(page.Aliases))
            {
                var response = await client.GetAsync(path + query);
                if (!Allowed(page))
                {
                    Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
                    Assert.Contains(role == "guest" ? "/Account/Login" : "/Account/AccessDenied", response.Headers.Location!.ToString());
                    continue;
                }
                response.EnsureSuccessStatusCode();
                var html = await response.Content.ReadAsStringAsync();
                Assert.Contains("data-workspace-view=\"" + page.Id + "\"", html);
                Assert.Contains("<title>" + page.Title + "</title>", WebUtility.HtmlDecode(html));
                Assert.Equal(1, html.Split("data-company-workspace").Length - 1);
                Assert.Equal(role == "guest" ? 0 : 1, html.Split("data-workspace-navigation=\"home\"").Length - 1);
                if (!string.IsNullOrEmpty(output) && path == page.Path)
                {
                    Directory.CreateDirectory(output);
                    var file = page.Id + "." + role + ".html";
                    await File.WriteAllTextAsync(Path.Combine(output, file), html);
                    records.Add(new { id = page.Id, path, query = page.Query, title = page.Title, file });
                }
            }
        }
        if (!string.IsNullOrEmpty(output))
        {
            Directory.CreateDirectory(output);
            var context = await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
            await File.WriteAllTextAsync(Path.Combine(output, role + ".json"), JsonSerializer.Serialize(new { role, context, navigation, pages = records }));
        }
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/unregistered-page")).StatusCode);
    }

    [Fact]
    public async Task AdminRevocationInvalidatesBothMenuEndpointAndProtectedRazorPage()
    {
        await using var factory = new PortalFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var (user, _) = await WorkspaceTests.Login(factory, client, false, true);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/Admin/Users")).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Users.SingleAsync(x => x.Id == user.Id)).IsAdmin = false;
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/workspace/navigation")).StatusCode);
        var denied = await client.GetAsync("/Admin/Users");
        Assert.Equal(HttpStatusCode.Redirect, denied.StatusCode);
        Assert.Contains("/Account/Login", denied.Headers.Location!.ToString());
    }
}
