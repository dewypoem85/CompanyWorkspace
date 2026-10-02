using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Schedule;
using Xunit;

public class PlanningTests
{
    [Fact]
    public async Task RemovedActualDatesAreAbsentAndDateBasisIsIgnored()
    {
        await using var factory = new ScheduleFactory(); using var member = await factory.Login(2); using var other = await factory.Login(3);
        var input = new TaskInput("단일 일정", "", 2, 10, new(2026, 1, 1), new(2026, 1, 3), "done", 0, []);
        var response = await member.PostAsJsonAsync("/api/tasks", input); response.EnsureSuccessStatusCode();
        var task = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(task.TryGetProperty("actualStartDate", out _)); Assert.False(task.TryGetProperty("actualEndDate", out _));
        var id = task.GetProperty("id").GetInt64();
        var rows = await member.GetFromJsonAsync<JsonElement>("/api/tasks?from=2026-02-01&to=2026-02-28&dateBasis=actual");
        Assert.Equal(0, rows.GetProperty("total").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await other.PutAsJsonAsync($"/api/tasks/{id}", input with { Version=1 })).StatusCode);
        var updated = await member.PutAsJsonAsync($"/api/tasks/{id}", input with { Version=1, Title="수정" }); updated.EnsureSuccessStatusCode();
        var updatedTask = await updated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(updatedTask.TryGetProperty("actualStartDate", out _)); Assert.False(updatedTask.TryGetProperty("actualEndDate", out _));
    }
    [Fact]
    public async Task MigrationIsAdditiveAndRepeatable()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new ScheduleDb(new DbContextOptionsBuilder<ScheduleDb>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE Tasks(Id INTEGER PRIMARY KEY, Title TEXT, StartDate TEXT, EndDate TEXT, ActualStartDate TEXT, ActualEndDate TEXT); INSERT INTO Tasks VALUES(17,'기존 업무','2026-01-01','2026-01-03','2026-02-01','2026-02-03'); CREATE INDEX IX_Tasks_ActualStartDate_ActualEndDate ON Tasks(ActualStartDate,ActualEndDate); CREATE TABLE Projects(Id INTEGER PRIMARY KEY);");
        await PlanningSchema.ApplyAsync(db); await PlanningSchema.ApplyAsync(db);
        using var cmd = connection.CreateCommand(); cmd.CommandText = "SELECT Title || StartDate || EndDate FROM Tasks WHERE Id=17";
        Assert.Equal("기존 업무2026-01-012026-01-03", await cmd.ExecuteScalarAsync());
        cmd.CommandText = "SELECT COUNT(*) FROM pragma_table_info('Tasks') WHERE name IN ('ActualStartDate','ActualEndDate')";
        Assert.Equal(0L, await cmd.ExecuteScalarAsync());
    }
}
