using System.Net;
using System.Net.Http.Json;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using CompanyPortal.Models;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

public partial class LeavePageTests
{
    sealed class ApplicationSetup : IAsyncDisposable
    {
        public ContractFactory<CompanyUser> Portal { get; } = new();
        public LeaveFactory Leave { get; private set; } = null!;
        public HttpClient PortalClient { get; private set; } = null!;
        public HttpClient Client { get; private set; } = null!;
        public string Owner { get; private set; } = "";
        public DateOnly Start { get; } = NextMonday();
        static DateOnly NextMonday() { var day=AppTime.Today.AddDays(7);while(day.DayOfWeek!=DayOfWeek.Monday)day=day.AddDays(1);return day; }
        public static async Task<ApplicationSetup> Create(string role="employee") {
            var s=new ApplicationSetup();s.PortalClient=s.Portal.CreateClient(Options);s.Leave=new LeaveFactory(s.Portal);s.Client=s.Leave.CreateClient(Options);
            var user=await Connect(s.Portal,s.PortalClient,s.Client,role);
            using var scope=s.Leave.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            s.Owner=(await db.Employees.SingleAsync(x=>x.CompanyUserId==user!.Id)).Id.ToString(CultureInfo.InvariantCulture);return s;
        }
        public async Task<List<LeaveRequest>> Stored(){using var scope=Leave.Services.CreateScope();return await scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>().LeaveRequests.Include(x=>x.Dates).AsNoTracking().ToListAsync();}
        public async Task<HttpResponseMessage> Post(Dictionary<string,string>? changes=null,bool enhanced=true,bool baseline=true,bool csrf=true,string? duplicate=null) {
            var fields=new Dictionary<string,string>{{"Input.StartDate",Start.ToString("yyyy-MM-dd")},{"Input.EndDate",Start.ToString("yyyy-MM-dd")},{"Input.Portion","FullDay"},{"Input.Reason","  휴가 사유  "},{"Input.WorkPlan","  업무 인수인계  "},{"SelfOnly","true"},{"ShowOthers","false"},{"ViewEmployeeId",""},{"RequestLimit","20"}};
            if(baseline)fields["expectedEmployeeId"]=Owner;
            if(changes!=null)foreach(var pair in changes)fields[pair.Key]=pair.Value;
            if(csrf){var html=await Client.GetStringAsync("/Leave");fields["__RequestVerificationToken"]=WebUtility.HtmlDecode(Regex.Match(html,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);}
            var data=fields.ToList();if(duplicate!=null)data.Add(new(duplicate,fields[duplicate]));
            using var request=new HttpRequestMessage(HttpMethod.Post,"/Leave?handler=Apply"){Content=new FormUrlEncodedContent(data)};
            if(enhanced)request.Headers.Add("Accept",NotificationMedia);return await Client.SendAsync(request);
        }
        public async ValueTask DisposeAsync(){Client.Dispose();PortalClient.Dispose();await Leave.DisposeAsync();await Portal.DisposeAsync();}
    }

    [Theory]
    [InlineData("FullDay","1")]
    [InlineData("Morning","0.5")]
    [InlineData("Afternoon","0.5")]
    [InlineData("기타","0")]
    public async Task ApplicationConfirmsActualOwnerFieldsDatesAndPendingState(string portion,string days){
        await using var s=await ApplicationSetup.Create();using var response=await s.Post(new(){{"Input.Portion",portion}});
        var data=(await NotificationReceipt(response)).GetProperty("data");var stored=Assert.Single(await s.Stored());
        Assert.Equal("Apply",data.GetProperty("operation").GetString());Assert.Equal(s.Owner,data.GetProperty("employeeId").GetString());Assert.Equal(stored.Id.ToString(CultureInfo.InvariantCulture),data.GetProperty("id").GetString());Assert.Equal("Pending",data.GetProperty("status").GetString());Assert.Equal(LeaveRequestStatus.Pending,stored.Status);
        Assert.Equal(days,data.GetProperty("calculatedDays").GetString());Assert.Equal("휴가 사유",data.GetProperty("input").GetProperty("reason").GetString());Assert.Equal("업무 인수인계",stored.WorkPlan);Assert.Equal(portion,data.GetProperty("dates")[0].GetProperty("portion").GetString());
        Assert.StartsWith("/Leave/Index?",data.GetProperty("navigateTo").GetString());Assert.Contains("RequestLimit=20",data.GetProperty("navigateTo").GetString());
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await s.Post(new(){{"Input.Portion",portion}})).StatusCode);Assert.Single(await s.Stored());
    }

    [Fact]
    public async Task ApplicationUsesServerWorkingDaysAndPreservesNativeCompatibility(){
        await using var s=await ApplicationSetup.Create();using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();db.Holidays.Add(new(){Date=s.Start.AddDays(2),Name="검증 공휴일"});await db.SaveChangesAsync();}
        using var response=await s.Post(new(){{"Input.EndDate",s.Start.AddDays(6).ToString("yyyy-MM-dd")},{"Input.Reason"," "}});var data=(await NotificationReceipt(response)).GetProperty("data");Assert.Equal(4,data.GetProperty("dates").GetArrayLength());Assert.Equal("4",data.GetProperty("calculatedDays").GetString());Assert.Equal(JsonValueKind.Null,data.GetProperty("input").GetProperty("reason").ValueKind);
        using var native=await s.Post(new(){{"Input.StartDate",s.Start.AddDays(7).ToString("yyyy-MM-dd")},{"Input.EndDate",s.Start.AddDays(6).ToString("yyyy-MM-dd")}},enhanced:false,baseline:false);Assert.Equal(HttpStatusCode.Redirect,native.StatusCode);Assert.Equal(2,(await s.Stored()).Count);
    }

    [Fact]
    public async Task BirthdayLeaveUsesNormalBalanceAndDoesNotMarkFreeLeave()
    {
        await using var s=await ApplicationSetup.Create();
        using(var scope=s.Leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var employee=await db.Employees.SingleAsync(x=>x.Id==long.Parse(s.Owner,CultureInfo.InvariantCulture));
            employee.BirthDate=new DateOnly(1992,s.Start.Month,s.Start.Day);await db.SaveChangesAsync();
        }
        using var response=await s.Post();var data=(await NotificationReceipt(response)).GetProperty("data");
        var stored=Assert.Single(await s.Stored());var date=Assert.Single(stored.Dates);
        Assert.Equal("1",data.GetProperty("calculatedDays").GetString());Assert.Equal(1m,stored.CalculatedDays);
        Assert.False(date.IsBirthdayLeave);
        Assert.Equal(1m,date.Days);
    }

    [Fact]
    public async Task BirthdayMorningAndAfternoonEachUseNormalHalfDay()
    {
        await using var s=await ApplicationSetup.Create();
        using(var scope=s.Leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            (await db.Employees.SingleAsync(x=>x.Id==long.Parse(s.Owner,CultureInfo.InvariantCulture))).BirthDate=new DateOnly(1992,s.Start.Month,s.Start.Day);
            await db.SaveChangesAsync();
        }
        using var morning=await s.Post(new(){{"Input.Portion","Morning"}});Assert.Equal("0.5",(await NotificationReceipt(morning)).GetProperty("data").GetProperty("calculatedDays").GetString());
        using var afternoon=await s.Post(new(){{"Input.Portion","Afternoon"}});Assert.Equal("0.5",(await NotificationReceipt(afternoon)).GetProperty("data").GetProperty("calculatedDays").GetString());
        var stored=await s.Stored();Assert.Equal(2,stored.Count);Assert.All(stored.SelectMany(x=>x.Dates),x=>Assert.False(x.IsBirthdayLeave));
    }

    [Fact]
    public async Task BirthdayLeaveIsOneFreeDayWithinWindowAndCannotBeClaimedTwice()
    {
        await using var s=await ApplicationSetup.Create();
        using(var scope=s.Leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var employee=await db.Employees.SingleAsync(x=>x.Id==long.Parse(s.Owner,CultureInfo.InvariantCulture));
            employee.HireDate=s.Start.AddYears(-1);employee.BirthDate=new DateOnly(2000,s.Start.Month,s.Start.Day);await db.SaveChangesAsync();
            Assert.True((await BirthdayLeavePolicy.GetAvailabilityAsync(db,employee,AppTime.Today)).IsAvailable);
        }
        using var response=await s.Post(new(){{"Input.Portion","Birthday"}});var data=(await NotificationReceipt(response)).GetProperty("data");
        var stored=Assert.Single(await s.Stored());var date=Assert.Single(stored.Dates);
        Assert.Equal("0",data.GetProperty("calculatedDays").GetString());Assert.Equal(0m,stored.CalculatedDays);Assert.False(stored.IsAdvance);
        Assert.Equal(s.Start,stored.BirthdayBenefitDate);Assert.False(stored.IsBirthdayPolicyOverride);Assert.True(date.IsBirthdayLeave);Assert.Equal(LeaveDayPortion.Birthday,date.Portion);Assert.Equal(0m,date.Days);
        using var duplicate=await s.Post(new(){{"Input.StartDate",s.Start.AddDays(1).ToString("yyyy-MM-dd")},{"Input.EndDate",s.Start.AddDays(1).ToString("yyyy-MM-dd")},{"Input.Portion","Birthday"}});
        Assert.Equal(HttpStatusCode.UnprocessableEntity,duplicate.StatusCode);Assert.Single(await s.Stored());
    }

    [Fact]
    public async Task BirthdayLeaveShowsAvailabilityAndRejectsOutsideThirtyDays()
    {
        await using var s=await ApplicationSetup.Create();
        using(var scope=s.Leave.Services.CreateScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
            var employee=await db.Employees.SingleAsync(x=>x.Id==long.Parse(s.Owner,CultureInfo.InvariantCulture));
            employee.HireDate=s.Start.AddYears(-1);employee.BirthDate=new DateOnly(2000,s.Start.Month,s.Start.Day);await db.SaveChangesAsync();
            Assert.True((await BirthdayLeavePolicy.GetAvailabilityAsync(db,employee,AppTime.Today)).IsAvailable);
        }
        var html=await s.Client.GetStringAsync("/Leave");Assert.Contains("지금 생일연차를 사용할 수 있어요",WebUtility.HtmlDecode(html));Assert.Contains("id=\"openBirthdayApply\"",html);Assert.Contains("value=\"Birthday\"",html);
        var outside=s.Start.AddDays(31);
        using var rejected=await s.Post(new(){{"Input.StartDate",outside.ToString("yyyy-MM-dd")},{"Input.EndDate",outside.ToString("yyyy-MM-dd")},{"Input.Portion","Birthday"}});
        Assert.Equal(HttpStatusCode.UnprocessableEntity,rejected.StatusCode);Assert.Empty(await s.Stored());
    }

    [Fact]
    public async Task UnusedBirthdayNoLongerCreatesGrantAndExistingGrantIsPreserved()
    {
        await using var factory=new ContractFactory<LeaveManager.Models.Employee>();_ = factory.CreateClient();
        using var scope=factory.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();
        var today=AppTime.Today;var birthday=today.AddDays(-1);var birthYear=DateTime.IsLeapYear(1992)?1992:1996;
        var unused=new Employee{Name="미사용",Email="birthday-unused@example.test",HireDate=today.AddDays(-40),BirthDate=new DateOnly(birthYear,birthday.Month,birthday.Day)};
        var used=new Employee{Name="사용",Email="birthday-used@example.test",HireDate=today.AddDays(-40),BirthDate=new DateOnly(birthYear,birthday.Month,birthday.Day)};
        var legacy=new Employee{Name="기존 지급",Email="birthday-legacy@example.test",HireDate=today.AddDays(-40),BirthDate=new DateOnly(birthYear,birthday.Month,birthday.Day)};
        db.Employees.AddRange(unused,used,legacy);await db.SaveChangesAsync();
        db.LeaveRequests.Add(new(){EmployeeId=used.Id,Status=LeaveRequestStatus.Pending,CalculatedDays=0m,
            Dates=[new(){Date=birthday,Portion=LeaveDayPortion.FullDay,IsBirthdayLeave=true}]});
        var historicalGrant=new LeaveGrant { EmployeeId=legacy.Id,GrantType=LeaveGrantType.Birthday,BenefitYear=birthday.Year,
            GrantedDate=today,ExpiresDate=today.AddDays(30),GrantedDays=1m,Note="기존 지급 기록" };
        db.LeaveGrants.Add(historicalGrant);await db.SaveChangesAsync();
        await LeaveAccrualWorker.EnsureGrantsAsync(db,unused,today);await LeaveAccrualWorker.EnsureGrantsAsync(db,unused,today);
        await LeaveAccrualWorker.EnsureGrantsAsync(db,used,today);
        await LeaveAccrualWorker.EnsureGrantsAsync(db,legacy,today);
        Assert.Empty(await db.LeaveGrants.Where(x=>x.EmployeeId==unused.Id&&x.GrantType==LeaveGrantType.Birthday).ToListAsync());
        Assert.Empty(await db.LeaveGrants.Where(x=>x.EmployeeId==used.Id&&x.GrantType==LeaveGrantType.Birthday).ToListAsync());
        Assert.True(await db.LeaveGrants.AnyAsync(x=>x.Id==historicalGrant.Id&&x.GrantType==LeaveGrantType.Birthday&&x.GrantedDays==1m));
        Assert.True(await db.LeaveGrants.AnyAsync(x=>x.EmployeeId==unused.Id&&x.GrantType==LeaveGrantType.Monthly));
        Assert.Equal(0m,Assert.Single(db.LeaveRequestDates.Where(x=>x.LeaveRequest.EmployeeId==used.Id)).Days);
    }

    [Fact]
    public void LeapDayBirthdayUsesFebruaryTwentyEighthOutsideLeapYears()
    {
        Assert.Equal(new DateOnly(2026,2,28),BirthdayCalendarDate.InYear(new DateOnly(1992,2,29),2026));
        Assert.Equal(new DateOnly(2028,2,29),BirthdayCalendarDate.InYear(new DateOnly(1992,2,29),2028));
    }

    [Fact]
    public void BirthdayLeaveTypeIsMaskedOutsideEmployeeAndAdminViews()
    {
        var employee = new Employee { Id = 7, Name = "테스트 직원" };
        var request = new LeaveRequest { Id = 11, EmployeeId = employee.Id, Employee = employee, WorkPlan = "업무 인수인계", BirthdayBenefitDate = AppTime.Today };
        var date = new LeaveRequestDate { LeaveRequestId = request.Id, LeaveRequest = request, Date = AppTime.Today, Portion = LeaveDayPortion.Birthday, IsBirthdayLeave = true };
        request.Dates.Add(date);

        var hidden = LeaveManager.Pages.Leave.CalendarItem.FromRequestDate(date, false);
        var revealed = LeaveManager.Pages.Leave.CalendarItem.FromRequestDate(date, true);
        var publicNotification = NotificationMessageFactory.LeaveRequestCreatedPublic(request);

        Assert.Equal(LeaveDayPortion.FullDay, hidden.Portion);
        Assert.DoesNotContain("Birthday", hidden.AdminTarget);
        Assert.Equal(LeaveDayPortion.Birthday, revealed.Portion);
        Assert.Contains("Birthday", revealed.AdminTarget);
        Assert.Equal("새 연차 신청", publicNotification.Title);
        Assert.DoesNotContain("생일", publicNotification.Message);
    }

    [Fact]
    public async Task ApplicationRejectsIdentityPreviewMalformedAndCsrfBeforeWriting(){
        await using var s=await ApplicationSetup.Create();Assert.Equal(HttpStatusCode.BadRequest,(await s.Post(csrf:false)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await s.Post(baseline:false)).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await s.Post(new(){{"expectedEmployeeId","999"}})).StatusCode);Assert.Equal(HttpStatusCode.Conflict,(await s.Post(duplicate:"expectedEmployeeId")).StatusCode);
        foreach(var changes in new Dictionary<string,string>[] {new(){{"Input.StartDate","not-date"}},new(){{"Input.Portion","999"}},new(){{"Input.Portion","특수휴가"}},new(){{"Input.WorkPlan"," "}},new(){{"Input.WorkPlan",new string('a',2001)}},new(){{"ViewEmployeeId","999"}},new(){{"Input.StartDate",AppTime.Today.AddDays(-1).ToString("yyyy-MM-dd")}}})
            Assert.Equal(HttpStatusCode.UnprocessableEntity,(await s.Post(changes)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity,(await s.Post(duplicate:"Input.StartDate")).StatusCode);Assert.Empty(await s.Stored());
    }

    [Fact]
    public async Task ApplicationUnknownAfterCommitDoesNotLeakOrClaimRollback(){
        await using var s=await ApplicationSetup.Create();using(var scope=s.Leave.Services.CreateScope()){var db=scope.ServiceProvider.GetRequiredService<LeaveManager.Data.AppDbContext>();await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER application_test_error BEFORE INSERT ON AuditLogs BEGIN SELECT RAISE(ABORT,'private-application-canary'); END;");}
        using var response=await s.Post();Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);var text=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("private-application-canary",text);Assert.Equal("unknown",JsonDocument.Parse(text).RootElement.GetProperty("outcome").GetString());Assert.Equal(LeaveRequestStatus.Pending,Assert.Single(await s.Stored()).Status);
        using var native=await s.Post(new(){{"expectedEmployeeId","999"},{"Input.Reason","<script>window.injected=true</script>"}},enhanced:false);Assert.Equal(HttpStatusCode.Conflict,native.StatusCode);var html=await native.Content.ReadAsStringAsync();Assert.Contains("data-application-locked=\"true\"",html);Assert.Contains("application-raw-draft",html);Assert.DoesNotContain("<script>window.injected=true",html);
        var raw=WebUtility.HtmlDecode(Regex.Match(html,"<pre class=\"application-raw-draft\">(.*?)</pre>",RegexOptions.Singleline).Groups[1].Value);Assert.DoesNotContain("__RequestVerificationToken",raw);Assert.Equal("<script>window.injected=true</script>",JsonDocument.Parse(raw).RootElement.GetProperty("Input.Reason")[0].GetString());
    }

    [Theory]
    [InlineData("employee")]
    [InlineData("admin")]
    public async Task ApplicationRazorFixturesUseRealSsoAndCommonForm(string role){
        await using var s=await ApplicationSetup.Create(role);using var response=await s.Client.GetAsync("/Leave");response.EnsureSuccessStatusCode();Assert.True(response.Headers.CacheControl?.NoStore);var html=await response.Content.ReadAsStringAsync();Assert.Contains("leave-application.js",html);Assert.Contains("data-application-state",html);Assert.Contains("name=\"expectedEmployeeId\"",html);
        var output=Environment.GetEnvironmentVariable("WORKSPACE_RAZOR_SNAPSHOTS");if(string.IsNullOrEmpty(output))return;Directory.CreateDirectory(output);
        await File.WriteAllTextAsync(Path.Combine(output,$"leave.application.{role}.html"),html);await File.WriteAllTextAsync(Path.Combine(output,$"leave.application.{role}.json"),JsonSerializer.Serialize(new{start=s.Start.ToString("yyyy-MM-dd"),context=await s.PortalClient.GetFromJsonAsync<JsonElement>("/api/workspace/context"),navigation=await s.Client.GetFromJsonAsync<JsonElement>("/api/workspace/navigation")}));
        if(role=="employee"){
            var showOthers=await s.Client.GetStringAsync("/Leave?ShowOthers=true&SaveCalendarPreference=true");
            Assert.Contains("aria-label=\"다른 사람 연차도 같이 보기\" checked",showOthers);
            await File.WriteAllTextAsync(Path.Combine(output,"leave.application.employee.show-others.html"),showOthers);
        }
    }
}
