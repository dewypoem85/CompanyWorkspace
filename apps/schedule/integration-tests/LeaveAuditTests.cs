using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    [Fact]
    public async Task AuditReadPreservesOwnerFiltersPagingAndEncodedExactValues()
    {
        await using var portal=new ContractFactory<CompanyUser>();using var portalClient=portal.CreateClient(Options);
        await using var leave=new LeaveFactory(portal);using var client=leave.CreateClient(Options);
        var user=await Connect(portal,portalClient,client,"admin");
        long actor;
        using(var scope=leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            actor=(await db.Employees.SingleAsync(e=>e.CompanyUserId==user!.Id)).Id;
            for(var i=0;i<12;i++) db.AuditLogs.Add(new(){Id=9007199254740993L+i,ActorEmployeeId=actor,Action="EmployeeUpdated",TargetType="Employee",TargetId="audit-exact-"+i,
                CreatedAtUtc=new DateTime(2026,9,1,0,i,0,DateTimeKind.Utc),Reason="검증 사유 <script>window.STOLEN=true</script>",BeforeJson="{\"value\":9223372036854775807}",AfterJson="{\"value\":9223372036854775806}",DetailJson="{\"message\":\"감사 원문\"}"});
            await db.SaveChangesAsync();
        }
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        var cases=new[]{("initial","",10),("second","?AuditPage=2",2),("large","?AuditLimit=20",12),("filtered","?targetFilter=audit-exact-0&actorFilter="+actor+"&actionFilter=EmployeeUpdated",1),("empty","?targetFilter=missing-audit",0)};
        foreach(var (name,query,count) in cases)
        {
            var response=await client.GetAsync("/Admin/AuditLogs"+query);response.EnsureSuccessStatusCode();
            var html=await response.Content.ReadAsStringAsync();
            Assert.Contains($"data-audit-owner=\"{actor}\"",html);Assert.Equal(count,Regex.Matches(html,"data-audit-row=").Count);
            Assert.Contains("cw-form-control",html);Assert.Contains("cw-data-table",html);Assert.DoesNotContain("<script>window.STOLEN",html);
            if(count>0){Assert.Contains("9223372036854775807",html);Assert.Contains("data-cw-disclosure-panel=",html);}
            if(name=="second")Assert.Contains("9007199254740993",html);
            if(name=="filtered"){Assert.Contains("data-audit-target=\"audit-exact-0\"",html);Assert.Contains($"data-audit-actor=\"{actor}\"",html);}
            if(!string.IsNullOrWhiteSpace(output)){Directory.CreateDirectory(output);await File.WriteAllTextAsync(Path.Combine(output,$"leave.audit.{name}.html"),html);}
        }
        if(!string.IsNullOrWhiteSpace(output))await File.WriteAllTextAsync(Path.Combine(output,"leave.audit.json"),JsonSerializer.Serialize(new {actor=actor.ToString(),context=await portalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation")}));
        leave.ConnectionFailure=HttpStatusCode.ServiceUnavailable;
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/Admin/AuditLogs")).StatusCode);
        leave.ConnectionFailure=null;
        using(var scope=portal.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();(await db.Users.SingleAsync(x=>x.Id==user!.Id)).IsActive=false;await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync("/Admin/AuditLogs")).StatusCode);
    }
}
