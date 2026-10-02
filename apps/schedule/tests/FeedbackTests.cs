using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Schedule;
using Xunit;

public class FeedbackTests
{
    static async Task<JsonElement> Saved(HttpResponseMessage response)
    {
        var text=await response.Content.ReadAsStringAsync();Assert.True(response.IsSuccessStatusCode,text);
        var value=JsonSerializer.Deserialize<JsonElement>(text);Assert.Equal("workspace-form-v1",value.GetProperty("protocol").GetString());Assert.Equal("saved",value.GetProperty("outcome").GetString());return value.GetProperty("data").GetProperty("result");
    }
    static HttpClient Actor(HttpClient client,long id){client.DefaultRequestHeaders.Add(FeedbackWriteProtocol.ActorHeader,id.ToString());return client;}

    [Fact]
    public async Task ProjectMembersReportAndDeveloperDepartmentClaimsDiscussesAndCreatesOneTask()
    {
        await using var factory=new ScheduleFactory();
        factory.Departments.Single(x=>x.Id==1).HandlesScheduleFeedback=true;
        factory.Memberships.Add(new(){EmployeeId=3,ProjectId=10});
        using var reporter=Actor(await factory.Login(3),3);using var developer=Actor(await factory.Login(2),2);using var admin=Actor(await factory.Login(1),1);

        var created=await Saved(await reporter.PostAsJsonAsync("/api/feedback",new FeedbackInput(10,"bug","high","전투 중 멈춤","발생 상황",0,[])));
        var item=created.GetProperty("item");var id=item.GetProperty("id").GetInt64();Assert.Equal("new",item.GetProperty("status").GetString());
        Assert.Single((await reporter.GetFromJsonAsync<JsonElement>("/api/feedback?status=new")).GetProperty("items").EnumerateArray());
        Assert.Equal(1,(await developer.GetFromJsonAsync<JsonElement>("/api/feedback/badge")).GetProperty("count").GetInt32());

        Assert.Equal(HttpStatusCode.Forbidden,(await reporter.PostAsJsonAsync($"/api/feedback/{id}/status",new FeedbackStatusInput("progress",1))).StatusCode);
        var assigned=await Saved(await developer.PostAsJsonAsync($"/api/feedback/{id}/assignment",new FeedbackAssignmentInput(2,1)));
        Assert.Equal("review",assigned.GetProperty("item").GetProperty("status").GetString());
        var comment=await Saved(await reporter.PostAsJsonAsync($"/api/feedback/{id}/comments",new FeedbackCommentInput("확인 부탁드립니다",null,0,[])));
        Assert.True(comment.GetProperty("comment").GetProperty("id").GetInt64()>0);

        var linked=await Saved(await developer.PostAsJsonAsync($"/api/feedback/{id}/task",new FeedbackTaskInput(2,"멈춤 현상 수정","제보에서 생성",null,null,2)));
        Assert.Equal("progress",linked.GetProperty("item").GetProperty("status").GetString());
        var taskId=linked.GetProperty("task").GetProperty("id").GetInt64();Assert.True(taskId>0);
        Assert.Equal(HttpStatusCode.Conflict,(await developer.PostAsJsonAsync($"/api/feedback/{id}/task",new FeedbackTaskInput(2,"중복","",null,null,3))).StatusCode);
        var done=await developer.PatchAsJsonAsync($"/api/tasks/{taskId}/status",new StatusInput("done",1));done.EnsureSuccessStatusCode();
        var detail=await reporter.GetFromJsonAsync<JsonElement>($"/api/feedback/{id}");Assert.Equal("progress",detail.GetProperty("item").GetProperty("status").GetString());Assert.Equal("done",detail.GetProperty("linkedTask").GetProperty("status").GetString());Assert.NotEmpty(detail.GetProperty("history").EnumerateArray());

        var notices=await reporter.GetFromJsonAsync<JsonElement>("/api/notifications");Assert.True(notices.GetProperty("unread").GetInt32()>=2);Assert.Contains(notices.GetProperty("items").EnumerateArray(),n=>n.GetProperty("taskId").GetInt64()==-id);
        var resolved=await Saved(await developer.PostAsJsonAsync($"/api/feedback/{id}/status",new FeedbackStatusInput("resolved",3,"수정 완료")));Assert.Equal("resolved",resolved.GetProperty("item").GetProperty("status").GetString());
    }

    [Fact]
    public async Task MembershipAndPrivateProjectVisibilityAreEnforced()
    {
        await using var factory=new ScheduleFactory();factory.Departments.Single(x=>x.Id==1).HandlesScheduleFeedback=true;factory.Memberships.Add(new(){EmployeeId=3,ProjectId=10});
        using var reporter=Actor(await factory.Login(3),3);using var developer=Actor(await factory.Login(2),2);using var admin=Actor(await factory.Login(1),1);using var nonMember=Actor(await factory.Login(4),4);
        using(var missingActor=await factory.Login(3)) Assert.Equal(HttpStatusCode.Conflict,(await missingActor.PostAsJsonAsync("/api/feedback",new FeedbackInput(10,"bug","normal","계정 확인","",0,[]))).StatusCode);
        var id=(await Saved(await reporter.PostAsJsonAsync("/api/feedback",new FeedbackInput(10,"improvement","normal","개선 제안","내용",0,[])))).GetProperty("item").GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.OK,(await developer.GetAsync($"/api/feedback/{id}")).StatusCode);
        factory.People.Single(x=>x.Id==4).DepartmentId=2;factory.People.Single(x=>x.Id==4).Department="아트";
        Assert.Equal(HttpStatusCode.NotFound,(await nonMember.GetAsync($"/api/feedback/{id}")).StatusCode);
        factory.Projects[0].IsPrivate=true;
        Assert.Equal(HttpStatusCode.NotFound,(await reporter.GetAsync($"/api/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await developer.GetAsync($"/api/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await admin.GetAsync($"/api/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await reporter.PostAsJsonAsync("/api/feedback",new FeedbackInput(10,"bug","normal","비공개","",0,[]))).StatusCode);
    }
}
