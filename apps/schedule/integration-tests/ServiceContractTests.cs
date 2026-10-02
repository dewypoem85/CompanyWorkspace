using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;
using Schedule;
using Xunit;
using PortalUser = CompanyPortal.Models.CompanyUser;
using LeaveEmployee = LeaveManager.Models.Employee;

public class ContractFactory<T> : WebApplicationFactory<T> where T : class
{
    public const string Secret = "schedule-integration-only-secret-long-enough";
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "Schedule.slnx"))) root = root.Parent;
        var portal = typeof(T) == typeof(PortalUser);
        var folder = Path.Combine(Path.GetTempPath(), "schedule-contract", Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        builder.UseContentRoot(Path.GetFullPath(Path.Combine(root!.FullName, "..", portal ? "portal" : "leave")));
        builder.UseEnvironment("Development"); builder.UseSetting("ConnectionStrings:Default", $"Data Source={Path.Combine(folder, "service.db")}");
        builder.ConfigureLogging(logging => logging.ClearProviders());
        builder.ConfigureServices(services => services.AddDataProtection().UseEphemeralDataProtectionProvider());
        builder.UseSetting("DataProtection:KeyPath", Path.Combine(folder, "keys"));
        builder.UseSetting("Sso:SharedSecret", Secret); builder.UseSetting("CompanyPortal:SsoSharedSecret", Secret);
        builder.UseSetting("CompanyPortal:BaseUrl", "https://company.example.com");
        foreach (var service in CompanyPortal.Models.CompanySystemCatalog.All)
            builder.UseSetting(service.BaseUrlConfigurationKey, $"https://{service.Key}.example.com");
        builder.UseSetting("Authentication:Google:ClientId", "test-client"); builder.UseSetting("Authentication:Google:ClientSecret", "test-secret");
        builder.UseSetting("SeedMaster:Email", "contract-master@example.test"); builder.UseSetting("Provisioning:Leave:Enabled", "false"); builder.UseSetting("Backup:Enabled", "false");
    }
    public HttpClient Signed(string audience)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Tokens.Service(audience, Secret)); return client;
    }
}
public class ServiceContractTests
{
    [Fact] public async Task LeaveCalendarSharesOnlyRegisteredHolidayDatesAndNamesWithinRange()
    {
        await using var factory = new ContractFactory<LeaveEmployee>();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            db.Holidays.AddRange(new LeaveManager.Models.Holiday { Date = new(2026,12,31), Name = "연말 회사 휴일" }, new LeaveManager.Models.Holiday { Date = new(2027,1,1), Name = "새해 휴일" }, new LeaveManager.Models.Holiday { Date = new(2027,2,1), Name = "범위 밖" });
            await db.SaveChangesAsync();
        }
        const string path = "/api/internal/schedule/absences?from=2026-12-31&to=2027-01-01&format=calendar-v2";
        using var client = factory.Signed("schedule-absences");
        var response = await client.GetAsync(path); response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.Empty(body.GetProperty("items").EnumerateArray());
        var holidays = body.GetProperty("holidays").EnumerateArray().ToArray();
        Assert.Equal(2, holidays.Length);
        Assert.Equal("2026-12-31", holidays[0].GetProperty("date").GetString());
        Assert.Equal("새해 휴일", holidays[1].GetProperty("name").GetString());
        Assert.All(holidays, h => Assert.Equal(new[]{"date","name"}, h.EnumerateObject().Select(p=>p.Name).ToArray()));
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(path)).StatusCode);
        using var wrong = factory.Signed("schedule-directory");
        Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync(path)).StatusCode);
    }
    [Fact] public async Task PortalExportsMinimumEmployeeFieldsAndChecksAudienceAndReplay()
    {
        await using var factory = new ContractFactory<PortalUser>(); using var client = factory.Signed("schedule-directory");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            db.Users.Add(new() { Name = "직원", Email = "employee@example.test", Department = "개발", IsActive = true });
            db.Users.Add(new() { Name = "공유", Email = "shared@example.test", IsSharedAccount = true, IsActive = true }); await db.SaveChangesAsync();
        }
        var response = await client.GetAsync("/api/internal/schedule/employees"); response.EnsureSuccessStatusCode();
        var data = await response.Content.ReadFromJsonAsync<JsonElement>();
        var employee = data.EnumerateArray().Single(x => x.GetProperty("name").GetString() == "직원");
        Assert.True(employee.GetProperty("access").GetBoolean()); Assert.False(employee.TryGetProperty("email", out _)); Assert.False(employee.TryGetProperty("hireDate", out _));
        var shared = data.EnumerateArray().Single(x => x.GetProperty("shared").GetBoolean()); Assert.False(shared.GetProperty("access").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/internal/schedule/employees")).StatusCode);
        using var wrong = factory.Signed("schedule-absences"); Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync("/api/internal/schedule/employees")).StatusCode);
    }
    [Fact] public async Task LeaveExportsOnlyApprovedOrCancellationPendingAbsencesWithoutReasons()
    {
        await using var factory = new ContractFactory<LeaveEmployee>(); using var client = factory.Signed("schedule-absences");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var person = new LeaveEmployee { Name = "직원", Email = "person@example.test", CompanyUserId = 20 }; db.Employees.Add(person); await db.SaveChangesAsync();
            var statuses = new[] { LeaveManager.Models.LeaveRequestStatus.Approved, LeaveManager.Models.LeaveRequestStatus.CancelRequested, LeaveManager.Models.LeaveRequestStatus.Pending, LeaveManager.Models.LeaveRequestStatus.Cancelled, LeaveManager.Models.LeaveRequestStatus.Rejected, LeaveManager.Models.LeaveRequestStatus.Approved, LeaveManager.Models.LeaveRequestStatus.Approved };
            for (var i = 0; i < statuses.Length; i++) db.LeaveRequests.Add(new() { EmployeeId = person.Id, Status = statuses[i], Reason = "private-reason", WorkPlan = "private-plan", DecisionNote = "private-note", Dates = [new() { Date = new(2026, 9, i + 1), Portion = i == 0 ? LeaveManager.Models.LeaveDayPortion.FullDay : i == 1 ? LeaveManager.Models.LeaveDayPortion.Morning : i == 5 ? LeaveManager.Models.LeaveDayPortion.Afternoon : LeaveManager.Models.LeaveDayPortion.특수휴가 }] });
            await db.SaveChangesAsync();
        }
        var response = await client.GetAsync("/api/internal/schedule/absences?from=2026-09-01&to=2026-09-07"); response.EnsureSuccessStatusCode();
        var text = await response.Content.ReadAsStringAsync(); var rows = JsonSerializer.Deserialize<JsonElement>(text); Assert.Equal(4, rows.GetArrayLength()); Assert.DoesNotContain("private", text);
        Assert.Equal(new[] { "afternoon", "full", "morning", "other" }, rows.EnumerateArray().Select(x => x.GetProperty("portion").GetString()).Order().ToArray());
        using var wrong = factory.Signed("schedule-directory"); Assert.Equal(HttpStatusCode.Unauthorized, (await wrong.GetAsync("/api/internal/schedule/absences?from=2026-09-01&to=2026-09-07")).StatusCode);
        using var range = factory.Signed("schedule-absences"); Assert.Equal(HttpStatusCode.BadRequest, (await range.GetAsync("/api/internal/schedule/absences?from=2026-01-01&to=2026-12-31")).StatusCode);
    }
}
