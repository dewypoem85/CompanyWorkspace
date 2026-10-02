using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Schedule;

public class DirectoryService(IHttpClientFactory clients, IServiceScopeFactory scopes, IConfiguration config, IWebHostEnvironment env)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private DateTime refreshed = DateTime.MinValue;
    public async Task Refresh(bool force = false)
    {
        if (env.IsDevelopment() && config.GetValue<bool>("DemoMode")) return;
        if (!force && refreshed > DateTime.UtcNow.AddSeconds(-60)) return;
        await gate.WaitAsync();
        try
        {
            if (!force && refreshed > DateTime.UtcNow.AddSeconds(-60)) return;
            using var request = new HttpRequestMessage(HttpMethod.Get, config["Portal:InternalUrl"]!.TrimEnd('/') + "/api/internal/schedule/directory");
            request.Headers.Host = new Uri(config["Portal:PublicUrl"] ?? "https://company.example.com").Host;
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Tokens.Service("schedule-directory", config["Sso:SharedSecret"]!));
            using var response = await clients.CreateClient("internal").SendAsync(request);
            response.EnsureSuccessStatusCode();
            var snapshot = await response.Content.ReadFromJsonAsync<DirectorySnapshot>() ?? throw new Exception("조직 응답 없음");
            Validate(snapshot);
            var employees = snapshot.Employees;
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            await using var tx = await db.Database.BeginTransactionAsync();
            var old = await db.Employees.ToDictionaryAsync(x => x.Id);
            var departments = await db.Departments.ToDictionaryAsync(x => x.Id);
            var projects = await db.Projects.ToDictionaryAsync(x => x.Id);
            if (projects.Keys.Except(snapshot.Projects.Select(x => x.Id)).Any()) throw new Exception("기존 프로젝트 이전이 완료되지 않았습니다.");
            foreach (var d in departments.Values) d.Archived = true;
            foreach (var d in snapshot.Departments)
            {
                if (!departments.TryGetValue(d.Id, out var row)) db.Departments.Add(d);
                else { row.Name = d.Name; row.Archived = d.Archived; row.Version = d.Version; row.HandlesScheduleFeedback = d.HandlesScheduleFeedback; }
            }
            foreach (var p in snapshot.Projects)
            {
                if (!projects.TryGetValue(p.Id, out var row)) db.Projects.Add(p);
                else { row.Name = p.Name; row.Color = p.Color; row.IsPrivate = p.IsPrivate; row.Archived = p.Archived; row.Version = p.Version; }
            }
            foreach (var row in old.Values) { row.Active = false; row.Access = false; }
            foreach (var e in employees)
            {
                e.Department = snapshot.Departments.FirstOrDefault(d => d.Id == e.DepartmentId)?.Name ?? "";
                if (!old.TryGetValue(e.Id, out var row)) db.Employees.Add(e);
                else { row.Name = e.Name; row.DepartmentId = e.DepartmentId; row.Department = e.Department; row.Role = e.Role; row.Active = e.Active; row.Shared = e.Shared; row.IsPrivate = e.IsPrivate; row.Access = e.Access; }
            }
            var memberships = await db.Memberships.ToListAsync();
            var newKeys = snapshot.Memberships.Select(x => (x.EmployeeId, x.ProjectId)).ToHashSet();
            var oldKeys = memberships.Select(x => (x.EmployeeId, x.ProjectId)).ToHashSet();
            db.Memberships.RemoveRange(memberships.Where(x => !newKeys.Contains((x.EmployeeId, x.ProjectId))));
            db.Memberships.AddRange(snapshot.Memberships.Where(x => !oldKeys.Contains((x.EmployeeId, x.ProjectId))));
            var leads = await db.TeamLeads.ToListAsync();
            // Remove legacy rows before inserting, avoiding a collision with their old name-based index.
            db.TeamLeads.RemoveRange(leads);
            await db.SaveChangesAsync();
            db.TeamLeads.AddRange(snapshot.Leads.Select(l => new TeamLead { EmployeeId = l.EmployeeId, DepartmentId = l.DepartmentId, Department = snapshot.Departments.Single(d => d.Id == l.DepartmentId).Name }));
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            refreshed = DateTime.UtcNow;
        }
        catch (Exception ex) when (ex is not ApiError) { throw new ApiError(503, "회사 계정 정보를 확인할 수 없습니다. 작성 내용은 유지됩니다. 잠시 후 다시 시도해 주세요."); }
        finally { gate.Release(); }
    }
    public static void Validate(DirectorySnapshot s)
    {
        if (s.SchemaVersion != 1 || s.Employees is null || s.Departments is null || s.Projects is null || s.Memberships is null || s.Leads is null) throw new Exception("조직 응답 형식 오류");
        if (s.Employees.Any(e => e.Id <= 0 || string.IsNullOrWhiteSpace(e.Name)) || s.Employees.Select(e => e.Id).Distinct().Count() != s.Employees.Length || s.Departments.Any(d => d.Id <= 0) || s.Projects.Any(p => p.Id <= 0) || s.Departments.Select(d => d.Id).Distinct().Count() != s.Departments.Length || s.Projects.Select(p => p.Id).Distinct().Count() != s.Projects.Length) throw new Exception("조직 ID 중복 또는 오류");
        var people = s.Employees.ToDictionary(e => e.Id); var departments = s.Departments.ToDictionary(d => d.Id); var projects = s.Projects.Select(p => p.Id).ToHashSet();
        if (s.Employees.Any(e => e.DepartmentId.HasValue && !departments.ContainsKey(e.DepartmentId.Value)) || s.Memberships.Any(m => !people.TryGetValue(m.EmployeeId, out var e) || e.Shared || !projects.Contains(m.ProjectId)) || s.Leads.Any(l => !people.TryGetValue(l.EmployeeId, out var e) || !e.Active || !e.Access || e.Shared || e.DepartmentId != l.DepartmentId || !departments.TryGetValue(l.DepartmentId, out var d) || d.Archived)) throw new Exception("조직 연결 오류");
        if (s.Memberships.Select(m => (m.EmployeeId, m.ProjectId)).Distinct().Count() != s.Memberships.Length || s.Leads.Distinct().Count() != s.Leads.Length) throw new Exception("중복 조직 연결");
    }
    public async Task<object> Absences(DateOnly from, DateOnly to, bool includePrivate = false)
    {
        if (env.IsDevelopment() && config.GetValue<bool>("DemoMode")) return new { items = Array.Empty<Absence>(), holidays = Array.Empty<CalendarHoliday>(), holidaysAvailable = true, available = true, updatedAt = DateTime.UtcNow };
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, config["Leave:InternalUrl"]!.TrimEnd('/') + $"/api/internal/schedule/absences?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}&format=calendar-v2");
            request.Headers.Host = new Uri(config["Leave:PublicUrl"] ?? "https://leave.example.com").Host;
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Tokens.Service("schedule-absences", config["Sso:SharedSecret"]!));
            using var response = await clients.CreateClient("internal").SendAsync(request);
            response.EnsureSuccessStatusCode();
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            var visibleIds = (await db.Employees.Where(e => e.Role != "master" && (includePrivate || !e.IsPrivate)).Select(e => e.Id).ToListAsync()).ToHashSet();
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
            // Preserve absences during rolling deployment against a legacy Leave service.
            if (body.ValueKind == JsonValueKind.Array)
                return new { items = (body.Deserialize<Absence[]>(options) ?? []).Where(a => visibleIds.Contains(a.EmployeeId)).ToArray(), holidays = Array.Empty<CalendarHoliday>(), holidaysAvailable = false, available = true, updatedAt = DateTime.UtcNow };
            return new { items = (body.GetProperty("items").Deserialize<Absence[]>(options) ?? []).Where(a => visibleIds.Contains(a.EmployeeId)).ToArray(), holidays = body.GetProperty("holidays").Deserialize<CalendarHoliday[]>(options) ?? [], holidaysAvailable = true, available = true, updatedAt = DateTime.UtcNow };
        }
        catch { return new { items = Array.Empty<Absence>(), holidays = Array.Empty<CalendarHoliday>(), holidaysAvailable = false, available = false, updatedAt = (DateTime?)null }; }
    }
    public async Task<object> Holidays(DateOnly from, DateOnly to)
    {
        if (env.IsDevelopment() && config.GetValue<bool>("DemoMode")) return new { holidays = Array.Empty<CalendarHoliday>(), available = true, updatedAt = DateTime.UtcNow };
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, config["Leave:InternalUrl"]!.TrimEnd('/') + $"/api/internal/schedule/holidays?from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
            request.Headers.Host = new Uri(config["Leave:PublicUrl"] ?? "https://leave.example.com").Host;
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Tokens.Service("schedule-absences", config["Sso:SharedSecret"]!));
            using var response = await clients.CreateClient("internal").SendAsync(request);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            var holidays = body.GetProperty("holidays").Deserialize<CalendarHoliday[]>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new Exception("공휴일 응답 없음");
            if (holidays.Any(h => h.Date < from || h.Date > to || string.IsNullOrWhiteSpace(h.Name))) throw new Exception("공휴일 응답 오류");
            return new { holidays, available = true, updatedAt = DateTime.UtcNow };
        }
        catch { return new { holidays = Array.Empty<CalendarHoliday>(), available = false, updatedAt = (DateTime?)null }; }
    }
}
