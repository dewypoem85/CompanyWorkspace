using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
using LeaveEmployee = LeaveManager.Models.Employee;

public class LeaveEntryTests
{
    [Fact]
    public async Task SchemaMigrationKeepsOnlyBirthdayMonthAndDayInBothStores()
    {
        await using var portal = new ContractFactory<CompanyPortal.Models.CompanyUser>();
        await using var leave = new ContractFactory<LeaveEmployee>();
        _ = portal.CreateClient(); _ = leave.CreateClient();
        using var ps = portal.Services.CreateScope(); using var ls = leave.Services.CreateScope();
        var portalDb = ps.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
        var leaveDb = ls.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        var portalUser = new CompanyPortal.Models.CompanyUser { Name="기존 생일", Email="legacy-birthday@portal.test", HireDate=new(2025,1,1), BirthDate=new(1993,2,28) };
        var employee = new LeaveEmployee { Name="기존 생일", Email="legacy-birthday@leave.test", HireDate=new(2025,1,1), BirthDate=new(1993,2,28) };
        portalDb.Users.Add(portalUser); leaveDb.Employees.Add(employee);
        await portalDb.SaveChangesAsync(); await leaveDb.SaveChangesAsync();

        await CompanyPortal.Data.SchemaMigrator.ApplyAsync(portalDb);
        await LeaveManager.Data.SchemaMigrator.ApplyAsync(leaveDb);
        portalDb.ChangeTracker.Clear(); leaveDb.ChangeTracker.Clear();

        Assert.Equal(new DateOnly(2000,2,28), (await portalDb.Users.FindAsync(portalUser.Id))!.BirthDate);
        Assert.Equal(new DateOnly(2000,2,28), (await leaveDb.Employees.FindAsync(employee.Id))!.BirthDate);
    }

    [Fact]
    public async Task PrivateFlagProjectsFromPortalWithoutDisablingEmployeeOrDeletingRecords()
    {
        await using var portal = new ContractFactory<CompanyPortal.Models.CompanyUser>();
        await using var leave = new ContractFactory<LeaveEmployee>();
        _ = leave.CreateClient();
        using var ps = portal.Services.CreateScope(); using var ls = leave.Services.CreateScope();
        var person = new CompanyPortal.Models.CompanyUser { Id=912, Name="비공개 부계정", Email="private@test.invalid", HireDate=new(2025,1,1), BirthDate=new(1993,8,17), IsPrivate=true };
        var tokens=ps.ServiceProvider.GetRequiredService<CompanyPortal.Services.LeaveProvisioningTokenService>();
        var verifier=ls.ServiceProvider.GetRequiredService<LeaveManager.Services.CompanySsoService>();
        var projection=ls.ServiceProvider.GetRequiredService<LeaveManager.Services.CompanyEmployeeProjectionService>();
        var projected = await projection.ApplyAsync(verifier.VerifyProvisionAndConsume(tokens.Create(person)));
        Assert.True(projected.Employee!.IsPrivate); Assert.True(projected.Employee.IsActive); Assert.Equal(new DateOnly(2000,8,17), projected.Employee.BirthDate);
        Assert.False(projected.Employee.IsCompanyMaster);
        var id=projected.Employee.Id;
        person.IsPrivate=false; person.IsMaster=true; person.IsAdmin=true; person.BirthDate=null;
        projected=await projection.ApplyAsync(verifier.VerifyProvisionAndConsume(tokens.Create(person)));
        Assert.Equal(id,projected.Employee!.Id); Assert.True(projected.Employee.IsCompanyMaster);
        Assert.False(projected.Employee.IsPrivate); Assert.True(projected.Employee.IsActive); Assert.Null(projected.Employee.BirthDate);
    }
    [Theory]
    [InlineData("/")]
    [InlineData("/Index")]
    public async Task RootEntersProtectedDashboardInsteadOfShowingAnotherLogin(string path)
    {
        await using var factory = new ContractFactory<LeaveEmployee>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var entry = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.Redirect, entry.StatusCode);
        Assert.True(entry.Headers.CacheControl!.NoStore);
        Assert.StartsWith("/Leave", entry.Headers.Location!.OriginalString);
        var protectedPage = await client.GetAsync(entry.Headers.Location);
        Assert.Equal(HttpStatusCode.Redirect, protectedPage.StatusCode);
        Assert.Contains("/Account/Login?", protectedPage.Headers.Location!.OriginalString);
        var login = await client.GetAsync(protectedPage.Headers.Location);
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.StartsWith("https://company.example.com/Auth/leave?returnUrl=", login.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task BackgroundRequestStillReturnsUnauthorizedWithoutLoginHtml()
    {
        await using var factory = new ContractFactory<LeaveEmployee>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/Leave/Index")).StatusCode);
    }

    [Theory]
    [InlineData("/Leave/Usage?Year=2026", "/Leave/Usage?Year=2026")]
    [InlineData("https://outside.example/", "/Leave/Index")]
    public async Task PortalConnectionPreservesOnlyLocalReturnUrls(string requested, string expected)
    {
        await using var factory = new ContractFactory<LeaveEmployee>();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var response = await client.GetAsync("/Account/Login?returnUrl=" + Uri.EscapeDataString(requested));
        Assert.Equal("https://company.example.com/Auth/leave?returnUrl=" + Uri.EscapeDataString(expected), response.Headers.Location!.OriginalString);
    }
}
