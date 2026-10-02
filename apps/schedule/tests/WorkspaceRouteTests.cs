using System.Net;
using Xunit;

public class WorkspaceRouteTests
{
    [Fact]
    public async Task RegisteredPagesAndTaskLinksResolveWithoutBypassingApiAuthentication()
    {
        await using var factory = new ScheduleFactory();
        using var anonymous = factory.CreateClient();
        // Exercise the actual Vite output served by ASP.NET, not a separate test shell.
        // Build the schedule client before running this suite (also enforced in CI).
        var html = await anonymous.GetStringAsync("/");
        Assert.Contains("data-company-service=\"schedule\"", html);
        Assert.Contains("/assets/", html);
        foreach (var path in new[] { "/", "/index.html", "/kanban", "/todos", "/releases", "/settings", "/tasks/101", "/tasks/2147483648" })
        {
            using var response = await anonymous.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(html, await response.Content.ReadAsStringAsync());
        }
        using var denied = await anonymous.GetAsync("/api/bootstrap");
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        Assert.Equal("application/json", denied.Content.Headers.ContentType?.MediaType);
        using var authenticated = await factory.Login();
        foreach (var path in new[] { "/unregistered", "/tasks/0", "/tasks/-1", "/tasks/nope", "/tasks/101/extra", "/api/unregistered", "/auth/unregistered" })
        {
            using var response = await authenticated.GetAsync(path);
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.NotEqual("text/html", response.Content.Headers.ContentType?.MediaType);
        }
    }
}
