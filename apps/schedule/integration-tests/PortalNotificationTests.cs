using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Xunit;

public class PortalNotificationTests
{
    const long LeaveId = 9007199254740993;
    const long ScheduleId = long.MaxValue;
    sealed class SourceHandler : HttpMessageHandler
    {
        public ConcurrentQueue<string> Writes { get; } = new();
        public ConcurrentQueue<string> Reads { get; } = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            if (request.Method == HttpMethod.Post)
            {
                Writes.Enqueue(request.RequestUri!.AbsoluteUri);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NoContent));
            }
            var source = request.RequestUri!.Host.StartsWith("leave") ? "leave" : "schedule";
            Reads.Enqueue(request.RequestUri.AbsoluteUri);
            // Both old numeric upstream IDs and the workspace-v2 string form remain readable by .NET.
            object id = source == "leave" ? LeaveId : ScheduleId.ToString();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new {
                items = new[] { new {source, sourceLabel=source=="leave"?"연차관리":"팀 일정", sourceId=id,
                    type="업무 변경",title="큰 식별자 알림",message="격리된 알림 계약 검증",link="/notifications",isRead=false,createdAtUtc="2026-09-10T01:00:00Z"}}, unreadCount=1 }) });
        }
    }
    sealed class Factory : ContractFactory<CompanyUser>
    {
        public SourceHandler Source { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.UseSetting("Notifications:Leave:InternalUrl","https://leave.example.test");
            builder.UseSetting("Notifications:Schedule:InternalUrl","https://schedule.example.test");
            builder.ConfigureServices(services=>services.AddHttpClient("NotificationSources").ConfigurePrimaryHttpMessageHandler(()=>Source));
        }
    }
    [Fact]
    public async Task BrowserFeedAndReadRequestsPreserveExactLongIdsAndCsrf()
    {
        await using var factory=new Factory();
        using var client=factory.CreateClient(new WebApplicationFactoryClientOptions {AllowAutoRedirect=false});
        await WorkspaceTests.Login(factory,client,false,true);
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        var response=await client.GetAsync("/api/workspace/notifications");response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl!.NoStore);
        var feed=await response.Content.ReadFromJsonAsync<JsonElement>();
        var ids=feed.GetProperty("items").EnumerateArray().ToDictionary(x=>x.GetProperty("source").GetString()!,x=>x.GetProperty("sourceId"));
        Assert.Equal(JsonValueKind.String,ids["leave"].ValueKind);
        Assert.Equal(LeaveId.ToString(),ids["leave"].GetString());
        Assert.Equal(ScheduleId.ToString(),ids["schedule"].GetString());
        var currentUserId=context.GetProperty("user").GetProperty("id").GetInt64();
        var exact=await client.GetFromJsonAsync<JsonElement>($"/api/workspace/notifications/leave/{LeaveId}?expectedUserId={currentUserId}");
        Assert.Equal(LeaveId.ToString(),exact.GetProperty("items")[0].GetProperty("sourceId").GetString());
        Assert.Contains(factory.Source.Reads,url=>url.Contains($"id={LeaveId}"));
        var html=await client.GetStringAsync("/notifications");
        Assert.Contains($"data-center-read=\"leave:{LeaveId}\"",html);
        Assert.Contains($"data-center-open=\"schedule:{ScheduleId}\"",html);
        Assert.Equal(HttpStatusCode.Forbidden,(await client.PostAsync($"/api/workspace/notifications/leave/{LeaveId}/read",null)).StatusCode);
        Assert.Empty(factory.Source.Writes);
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        foreach(var (source,id) in new[]{("leave",LeaveId),("schedule",ScheduleId)})
            Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsync($"/api/workspace/notifications/{source}/{id}/read",null)).StatusCode);
        Assert.Contains(factory.Source.Writes,url=>url.EndsWith("?id="+LeaveId));
        Assert.Contains(factory.Source.Writes,url=>url.EndsWith("?id="+ScheduleId));
        var count=factory.Source.Writes.Count;
        foreach(var target in new[]{"leave/0","leave/-1","other/1"})
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsync($"/api/workspace/notifications/{target}/read",null)).StatusCode);
        Assert.Equal(count,factory.Source.Writes.Count);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");
        if(!string.IsNullOrEmpty(output)){
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output,"portal.notifications.large.html"),html);
            await File.WriteAllTextAsync(Path.Combine(output,"portal.notifications.large.json"),feed.GetRawText());
        }
    }
    [Fact]
    public async Task CommonAccountCannotFetchOrMarkEmployeeNotificationSources()
    {
        await using var factory=new Factory();using var client=factory.CreateClient();
        await WorkspaceTests.Login(factory,client,true,false);
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        var feed=await client.GetFromJsonAsync<JsonElement>("/api/workspace/notifications");
        Assert.Empty(feed.GetProperty("items").EnumerateArray());
        Assert.Empty(feed.GetProperty("sources").EnumerateArray());
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsync($"/api/workspace/notifications/leave/{LeaveId}/read",null)).StatusCode);
        Assert.Empty(factory.Source.Writes);
    }
    [Fact]
    public async Task StaleDocumentAccountCannotReadOrWriteAnotherLoggedInAccount()
    {
        await using var factory=new Factory();using var client=factory.CreateClient();
        var (user,_)=await WorkspaceTests.Login(factory,client,false,true);
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        foreach(var query in new[]{"expectedUserId="+(user.Id+1),"expectedUserId=", "expectedUserId="+user.Id+"&expectedUserId="+user.Id})
        {
            Assert.Equal(HttpStatusCode.Conflict,(await client.GetAsync("/api/workspace/notifications?"+query)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsync($"/api/workspace/notifications/leave/{LeaveId}/read?"+query,null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsync("/api/workspace/notifications/read-all?"+query,null)).StatusCode);
        }
        Assert.Empty(factory.Source.Reads);Assert.Empty(factory.Source.Writes);
        (await client.GetAsync("/api/workspace/notifications?expectedUserId="+user.Id)).EnsureSuccessStatusCode();
        Assert.Equal(2,factory.Source.Reads.Count);
        Assert.Equal(HttpStatusCode.NoContent,(await client.PostAsync("/api/workspace/notifications/read-all?expectedUserId="+user.Id,null)).StatusCode);
        Assert.Equal(2,factory.Source.Writes.Count);
    }
    [Fact]
    public async Task PushDeviceRegistrationIsSessionBoundAccountScopedAndStartsAtLatestNotification()
    {
        await using var factory=new Factory();using var owner=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (user,sid)=await WorkspaceTests.Login(factory,owner,false,true);
        var context=await owner.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        owner.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        var installation=Guid.NewGuid().ToString();
        var payload=new{expectedUserId=user.Id.ToString(),installationId=installation,token="fcm_token:abcdefghijklmnopqrstuvwxyz0123456789",appVersion="1.0.0"};
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PostAsJsonAsync("/api/workspace/push/devices",new{expectedUserId=(user.Id+1).ToString(),installationId=installation,token=payload.token,appVersion="1.0.0"})).StatusCode);
        (await owner.PostAsJsonAsync("/api/workspace/push/devices",payload)).EnsureSuccessStatusCode();
        // A token refresh for the same installation updates the row instead of producing duplicate deliveries.
        (await owner.PostAsJsonAsync("/api/workspace/push/devices",payload)).EnsureSuccessStatusCode();
        using(var scope=factory.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            var device=Assert.Single(await db.WorkspacePushDevices.ToListAsync());
            Assert.Equal(user.Id,device.UserId);Assert.Equal(sid,device.SessionId);Assert.DoesNotContain(payload.token,device.ProtectedToken);
            var cursors=await db.WorkspacePushSourceCursors.OrderBy(x=>x.Source).ToArrayAsync();
            Assert.Equal(2,cursors.Length);Assert.All(cursors,cursor=>Assert.True(cursor.LastSourceId>0));
            Assert.Empty(await db.WorkspacePushDeliveries.ToListAsync());
        }
        using var stranger=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (other,_)=await WorkspaceTests.Login(factory,stranger,false,true);
        var otherContext=await stranger.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        stranger.DefaultRequestHeaders.Add("X-Workspace-CSRF",otherContext.GetProperty("csrfToken").GetString());
        using var patch=new HttpRequestMessage(HttpMethod.Patch,"/api/workspace/push/devices/"+installation){Content=JsonContent.Create(new{expectedUserId=other.Id.ToString(),enabled=false,leaveEnabled=false,scheduleEnabled=false})};
        Assert.Equal(HttpStatusCode.NotFound,(await stranger.SendAsync(patch)).StatusCode);
        (await owner.PostAsync("/api/workspace/logout",null)).EnsureSuccessStatusCode();
        using(var scope=factory.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            Assert.False(await WorkspaceApi.ActiveAsync(db,sid,user.Id));
            var device=Assert.Single(await db.WorkspacePushDevices.ToListAsync());Assert.False(device.Enabled);Assert.Empty(device.ProtectedToken);
        }
    }

    [Fact]
    public async Task ReenablingOneDeviceDoesNotAdvanceTheSharedCursorPastAnotherActiveDevice()
    {
        await using var factory=new Factory();using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
        var (user,_)=await WorkspaceTests.Login(factory,client,false,true);
        var context=await client.GetFromJsonAsync<JsonElement>("/api/workspace/context");
        client.DefaultRequestHeaders.Add("X-Workspace-CSRF",context.GetProperty("csrfToken").GetString());
        var first=Guid.NewGuid().ToString();var second=Guid.NewGuid().ToString();
        var firstToken="fcm_token:"+Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");
        (await client.PostAsJsonAsync("/api/workspace/push/devices",new{expectedUserId=user.Id.ToString(),installationId=first,token=firstToken,appVersion="1.0.0"})).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/workspace/push/devices",new{expectedUserId=user.Id.ToString(),installationId=second,token="fcm_token:"+Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N"),appVersion="1.0.0"})).EnsureSuccessStatusCode();
        using(var disable=new HttpRequestMessage(HttpMethod.Patch,"/api/workspace/push/devices/"+first){Content=JsonContent.Create(new{expectedUserId=user.Id.ToString(),enabled=true,leaveEnabled=false,scheduleEnabled=true})})
            (await client.SendAsync(disable)).EnsureSuccessStatusCode();
        // Token refreshes and page reloads must not overwrite this device's explicit preferences.
        (await client.PostAsJsonAsync("/api/workspace/push/devices",new{expectedUserId=user.Id.ToString(),installationId=first,token=firstToken,appVersion="1.0.1"})).EnsureSuccessStatusCode();
        using(var scope=factory.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            Assert.False((await db.WorkspacePushDevices.SingleAsync(x=>x.InstallationId==first)).LeaveEnabled);
            var cursor=await db.WorkspacePushSourceCursors.SingleAsync(x=>x.UserId==user.Id&&x.Source=="leave");
            cursor.LastSourceId=42;await db.SaveChangesAsync();
        }
        using(var enable=new HttpRequestMessage(HttpMethod.Patch,"/api/workspace/push/devices/"+first){Content=JsonContent.Create(new{expectedUserId=user.Id.ToString(),enabled=true,leaveEnabled=true,scheduleEnabled=true})})
            (await client.SendAsync(enable)).EnsureSuccessStatusCode();
        using(var scope=factory.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<CompanyPortal.Data.AppDbContext>();
            Assert.Equal(42,(await db.WorkspacePushSourceCursors.SingleAsync(x=>x.UserId==user.Id&&x.Source=="leave")).LastSourceId);
        }
    }
}
