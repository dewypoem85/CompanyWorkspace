using Microsoft.EntityFrameworkCore;

namespace Schedule;
public static class Demo
{
    public static async Task SeedLoadTest(ScheduleDb db)
    {
        if (await db.Tasks.AnyAsync(x => x.Title.StartsWith("[부하 검증]"))) return;
        var ids = await db.Employees.Select(x => x.Id).ToListAsync();
        for (var i = 5; i <= 50; i++) if (!ids.Contains(i)) db.Employees.Add(new Employee { Id = i, Name = $"검증 직원 {i:00}", Department = i % 3 == 0 ? "아트" : i % 3 == 1 ? "기획" : "개발", DepartmentId = i % 3 == 0 ? 2 : i % 3 == 1 ? 3 : 1, Active = true, Access = true });
        await db.SaveChangesAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(9)); var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        for (var i = 0; i < 1000; i++)
        {
            var start = monday.AddDays(i % 5);
            db.Tasks.Add(new WorkItem { Title = $"[부하 검증] 업무 {i + 1:0000}", AssigneeId = i % 50 + 1, CreatedBy = 1, ProjectId = i % 2 + 1, StartDate = start, EndDate = start.AddDays(i % 3), Status = i % 3 == 0 ? "done" : i % 3 == 1 ? "progress" : "planned" });
        }
        await db.SaveChangesAsync();
        Console.WriteLine("Synthetic load test data created: 50 employees, 1000 additional tasks.");
    }
    public static async Task Seed(ScheduleDb db)
    {
        if (!await db.Departments.AnyAsync()) {
            db.Departments.AddRange(new Department { Id=1,Name="개발" },new Department { Id=2,Name="아트" },new Department { Id=3,Name="기획" });
            await db.SaveChangesAsync();
        }
        if (await db.Employees.AnyAsync()) {
            foreach (var e in await db.Employees.Where(e => e.DepartmentId == null).ToListAsync()) e.DepartmentId = e.Department == "개발" ? 1 : e.Department == "아트" ? 2 : 3;
            await db.SaveChangesAsync(); return;
        }
        db.Employees.AddRange(new Employee { Id = 1, Name = "김관리", Department = "개발", DepartmentId=1, Role = "admin", Active = true, Access = true }, new Employee { Id = 2, Name = "이담당", Department = "개발", DepartmentId=1, Active = true, Access = true }, new Employee { Id = 3, Name = "박아트", Department = "아트", DepartmentId=2, Active = true, Access = true }, new Employee { Id = 4, Name = "최기획", Department = "기획", DepartmentId=3, Active = true, Access = true });
        db.Projects.AddRange(new Project { Id = 1, Name = "던전슬래셔", Color = "#3b65de" }, new Project { Id = 2, Name = "네크로드", Color = "#af5ac9" });
        await db.SaveChangesAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(9)); var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var review = new WorkItem { Title = "업데이트 빌드 검수", Body = "빌드 확인 사항과 이미지를 이 게시글에 모아 주세요.", AssigneeId = 1, CreatedBy = 1, ProjectId = 1, StartDate = monday, EndDate = monday.AddDays(2), Status = "progress" };
        var combat = new WorkItem { Title = "전투 시스템 개선", AssigneeId = 2, CreatedBy = 2, ProjectId = 1, StartDate = monday.AddDays(1), EndDate = monday.AddDays(4) };
        var art = new WorkItem { Title = "신규 스킨 리소스", AssigneeId = 3, CreatedBy = 3, ProjectId = 1, StartDate = monday, EndDate = monday.AddDays(3), Status = "progress" };
        db.Tasks.AddRange(review, combat, art, new WorkItem { Title = "다음 업데이트 아이디어", AssigneeId = 4, CreatedBy = 4, ProjectId = 2 });
        db.Memberships.AddRange(new Membership { EmployeeId=1,ProjectId=1 }, new Membership { EmployeeId=2,ProjectId=1 },new Membership { EmployeeId=2,ProjectId=2 });
        db.Milestones.Add(new Milestone { Title = "업데이트 검수", Date = monday.AddDays(4), ProjectId = 1 });
        await db.SaveChangesAsync();
        db.Tasks.Add(new WorkItem { Title = "긴급 라이브 로그 수정", Body = "운영 중 추가된 대응 작업입니다.", AssigneeId = 2, CreatedBy = 1, ProjectId = 2, StartDate = monday.AddDays(2), EndDate = monday.AddDays(3), Status = "progress" });
        await db.SaveChangesAsync();
    }
}
