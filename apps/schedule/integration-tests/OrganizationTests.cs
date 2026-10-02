using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CompanyPortal.Data;
using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public class OrganizationTests
{
    sealed class Fixture : IAsyncDisposable
    {
        public string Folder { get; } = Path.Combine(Path.GetTempPath(), "org-tests-" + Guid.NewGuid().ToString("N"));
        public AppDbContext Db { get; }
        public OrganizationService Service { get; }
        public CompanyUser Master { get; } = new() { Id=1, Name="마스터", Email="master@test.invalid", IsMaster=true, IsAdmin=true, IsActive=true };
        public CompanyUser Admin { get; } = new() { Id=2, Name="관리자", Email="admin@test.invalid", IsAdmin=true, IsActive=true };
        public CompanyUser Employee { get; } = new() { Id=3, Name="직원", Email="member@test.invalid", IsActive=true };
        public Fixture() { Directory.CreateDirectory(Folder); Db = new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={Folder}/portal.db;Pooling=False").Options); Service = new(Db); }
        public async Task Init()
        {
            await Db.Database.EnsureCreatedAsync(); await SchemaMigrator.ApplyAsync(Db); await OrganizationSchema.ApplyAsync(Db);
            Db.Users.AddRange(Master,Admin,Employee); await Db.SaveChangesAsync();
            await Service.SaveDepartmentAsync(Master,null,"개발",false,0,[]); await Service.SaveDepartmentAsync(Master,null,"아트",false,0,[]);
            await Service.SaveProjectAsync(Master,null,"던전슬래셔","#3366aa",false,0,[]); await Service.SaveProjectAsync(Master,null,"네크로드","#aa6633",false,0,[]);
        }
        public async Task Assign(CompanyUser user,long? department,long[] projects)
        { await using var tx=await Db.Database.BeginTransactionAsync(); await Service.ApplyEmployeeAsync(Master,user,department,projects); await Db.SaveChangesAsync(); await tx.CommitAsync(); }
        public async ValueTask DisposeAsync() { await Db.DisposeAsync(); SqliteConnection.ClearAllPools(); Directory.Delete(Folder,true); }
    }
    [Fact] public async Task MembershipEditsAreSharedAndStaleProjectFormsCannotOverwriteEmployeeChanges()
    {
        await using var f=new Fixture(); await f.Init(); var project=await f.Db.Projects.FindAsync(1L); var before=project!.Version;
        await f.Assign(f.Employee,1,[1,2]);
        Assert.Equal(2,await f.Db.ProjectMemberships.CountAsync()); Assert.True(project.Version>before);
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(()=>f.Service.SaveProjectAsync(f.Master,1,project.Name,project.Color,false,before,[]));
        await f.Service.SaveProjectAsync(f.Master,1,project.Name,project.Color,false,project.Version,[]);
        Assert.Equal(new long[]{2},await f.Db.ProjectMemberships.Where(m=>m.EmployeeId==3).Select(m=>m.ProjectId).ToArrayAsync());
        await f.Assign(f.Employee,1,[]); Assert.Empty(await f.Db.ProjectMemberships.ToListAsync());
    }
    [Fact] public async Task DepartmentRenamePreservesIdsLeadsAndQueuesLeaveUpdateWhileMoveRevokesLead()
    {
        await using var f=new Fixture(); await f.Init(); await f.Assign(f.Employee,1,[]);
        var department=(await f.Db.Departments.FindAsync(1L))!;
        await f.Service.SaveDepartmentAsync(f.Master,1,"개발",false,department.Version,[3],true);
        await f.Service.SaveDepartmentAsync(f.Admin,1,"프로그래밍",false,department.Version,[3],true);
        Assert.Equal(1,f.Employee.DepartmentId); Assert.Equal("프로그래밍",f.Employee.Department);
        Assert.True((await f.Db.Departments.FindAsync(1L))!.HandlesScheduleFeedback);
        Assert.Single(await f.Db.DepartmentLeads.ToListAsync()); Assert.True(await f.Db.LeaveProjectionOutbox.AnyAsync(x=>x.CompanyUserId==3));
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Service.SaveDepartmentAsync(f.Master,1,"프로그래밍",true,department.Version,[]));
        await f.Assign(f.Employee,2,[]); Assert.Empty(await f.Db.DepartmentLeads.ToListAsync());
        await f.Service.SaveDepartmentAsync(f.Master,1,"프로그래밍",true,department.Version,[]);
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Assign(f.Employee,1,[]));
    }
    [Fact] public async Task AdminCannotBypassProtectedEmployeeRulesThroughProjectOrLeadForms()
    {
        await using var f=new Fixture(); await f.Init(); await f.Assign(f.Master,1,[]);
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Service.SaveProjectAsync(f.Admin,1,"던전슬래셔","#3366aa",false,1,[1]));
        var d=(await f.Db.Departments.FindAsync(1L))!;
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Service.SaveDepartmentAsync(f.Admin,1,d.Name,false,d.Version,[1]));
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Service.SaveProjectAsync(f.Employee,null,"불가","#3366aa",false,0,[]));
        Assert.Empty(await f.Db.ProjectMemberships.ToListAsync()); Assert.Empty(await f.Db.DepartmentLeads.ToListAsync());
    }
    [Fact] public async Task SharedAndInactiveEmployeesLoseResponsibilityAndArchivePreventsNewMembership()
    {
        await using var f=new Fixture(); await f.Init(); await f.Assign(f.Employee,1,[1]);
        var d=(await f.Db.Departments.FindAsync(1L))!; await f.Service.SaveDepartmentAsync(f.Master,1,d.Name,false,d.Version,[3]);
        f.Employee.IsActive=false; await f.Assign(f.Employee,1,[1]); Assert.Empty(await f.Db.DepartmentLeads.ToListAsync());
        f.Employee.IsActive=true; await f.Service.SaveDepartmentAsync(f.Master,1,d.Name,false,d.Version,[3]);
        f.Employee.IsSharedAccount=true; await f.Assign(f.Employee,1,[1]); Assert.Empty(await f.Db.DepartmentLeads.ToListAsync()); Assert.Empty(await f.Db.ProjectMemberships.ToListAsync());
        var p=(await f.Db.Projects.FindAsync(2L))!; await f.Service.SaveProjectAsync(f.Master,2,p.Name,p.Color,true,p.Version,[]);
        await Assert.ThrowsAsync<OrganizationValidationException>(()=>f.Assign(f.Admin,null,[2]));
    }
    [Fact] public async Task DirectoryContainsSingleConsistentCatalogAndKeepsLegacyEndpointCompatible()
    {
        await using var f=new ContractFactory<CompanyUser>(); using var client=f.Signed("schedule-directory");
        using (var scope=f.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>(); var master=await db.Users.SingleAsync(u=>u.IsMaster);
            var service=scope.ServiceProvider.GetRequiredService<OrganizationService>();
            var employee = new CompanyUser { Name="공개 직원", Email="directory@test.invalid" }; db.Users.Add(employee); await db.SaveChangesAsync();
            await service.SaveDepartmentAsync(master,null,"제보 처리",false,0,[],true);
            await Assert.ThrowsAsync<OrganizationValidationException>(() => service.SaveProjectAsync(master,null,"마스터 제외","#112233",false,0,[master.Id]));
            await service.SaveProjectAsync(master,null,"프로젝트","#112233",false,0,[employee.Id]);
        }
        var response=await client.GetAsync("/api/internal/schedule/directory"); response.EnsureSuccessStatusCode();
        var snapshot=(await response.Content.ReadFromJsonAsync<Schedule.DirectorySnapshot>())!; Schedule.DirectoryService.Validate(snapshot);
        Assert.Single(snapshot.Projects); Assert.Single(snapshot.Memberships);
        Assert.Contains(snapshot.Departments, x => x.Name == "제보 처리" && x.HandlesScheduleFeedback);
        var raw=await response.Content.ReadAsStringAsync(); Assert.DoesNotContain("email",raw); Assert.DoesNotContain("hireDate",raw);
        using var legacy=f.Signed("schedule-directory"); var people=await legacy.GetFromJsonAsync<JsonElement>("/api/internal/schedule/employees"); Assert.True(people.GetArrayLength()>0);
        Assert.Equal(HttpStatusCode.Unauthorized,(await client.GetAsync("/api/internal/schedule/directory")).StatusCode);
    }
    [Fact] public async Task ImportPreservesProjectIdsAndLinksIsRepeatableAndDryRunDoesNotChangeOriginal()
    {
        var folder=Path.Combine(Path.GetTempPath(),"org-import-test-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        var portal=Path.Combine(folder,"portal.db"); var schedule=Path.Combine(folder,"schedule.db");
        try {
            await using(var db=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={portal};Pooling=False").Options)) {
                await db.Database.EnsureCreatedAsync(); db.Users.Add(new(){Id=42,Name="직원",Email="employee@test.invalid",Department=" 개발 ",IsActive=true}); await db.SaveChangesAsync();
            }
            await using(var db=new Schedule.ScheduleDb(new DbContextOptionsBuilder<Schedule.ScheduleDb>().UseSqlite($"Data Source={schedule};Pooling=False").Options)) {
                await db.Database.EnsureCreatedAsync(); db.Employees.Add(new(){Id=42,Name="직원",Department="개발",Active=true,Access=true}); db.Projects.Add(new(){Id=75,Name="기존 프로젝트",Color="#112233"}); await db.SaveChangesAsync();
                db.Tasks.Add(new(){Title="기존 업무",AssigneeId=42,ProjectId=75}); db.Milestones.Add(new(){Title="기존 마감",ProjectId=75}); db.TeamLeads.Add(new(){EmployeeId=42,Department="개발"}); await db.SaveChangesAsync();
            }
            var bytes=await File.ReadAllBytesAsync(portal);
            var dry=await ScheduleOrganizationImporter.RunAsync(portal,schedule,false); Assert.Equal(1,dry.Projects); Assert.Equal(1,dry.Leads); Assert.Equal(bytes,await File.ReadAllBytesAsync(portal));
            var result=await ScheduleOrganizationImporter.RunAsync(portal,schedule,true); Assert.Equal(1,result.Leads);
            Assert.True((await ScheduleOrganizationImporter.RunAsync(portal,schedule,true)).AlreadyImported);
            await using var target=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={portal};Pooling=False").Options);
            Assert.Equal(75,(await target.Projects.SingleAsync()).Id); Assert.Empty(await target.ProjectMemberships.ToListAsync()); Assert.Equal("개발",(await target.Users.SingleAsync()).Department);
            await using var source=new Schedule.ScheduleDb(new DbContextOptionsBuilder<Schedule.ScheduleDb>().UseSqlite($"Data Source={schedule};Pooling=False").Options);
            Assert.Equal(75,(await source.Tasks.SingleAsync()).ProjectId); Assert.Equal(75,(await source.Milestones.SingleAsync()).ProjectId);
        } finally { SqliteConnection.ClearAllPools(); Directory.Delete(folder,true); }
    }
}
