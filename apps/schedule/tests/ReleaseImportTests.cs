using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class ReleaseImportTests
{
    [Fact]
    public async Task ImportSchemaPreservesExistingRecordsAndIsRepeatable()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:"); await connection.OpenAsync();
        await using var db = new ScheduleDb(new DbContextOptionsBuilder<ScheduleDb>().UseSqlite(connection).Options);
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE Projects(Id INTEGER PRIMARY KEY); CREATE TABLE Releases(Id INTEGER PRIMARY KEY, ProjectId INTEGER, BaseVersion INTEGER, Minor INTEGER, ReleasedOn TEXT NOT NULL, Notes TEXT, Status TEXT, Issue TEXT, RollbackTargetId INTEGER, ResolvedInId INTEGER, CreatedBy INTEGER, Version INTEGER, UpdatedAt TEXT); INSERT INTO Releases VALUES(7,1,770,0,'2026-07-20','기존 내용','stable','',NULL,NULL,1,3,'2026-07-20');");
        await ReleaseImportSchema.ApplyAsync(db); await ReleaseImportSchema.ApplyAsync(db);
        var old = await db.Releases.SingleAsync();
        Assert.Equal(3, old.Version); Assert.Equal("기존 내용", old.Notes); Assert.False(old.ReleasedOnUnknown); Assert.Equal("", old.SourceReference);
    }

    [Fact]
    public async Task ImportedMissingDatesAndLegacyRowsRespectPrivacyAndCanBeCorrected()
    {
        await using var factory = new ScheduleFactory(); using var admin = await factory.Login(); using var employee = await factory.Login(2);
        long recordId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ScheduleDb>();
            db.LegacyReleases.Add(new() { ProjectId=10, Notes="날짜와 버전 미기재", Issue="원본 메모", SourceReference="https://docs.google.com/spreadsheets/d/test/edit#range=D8" });
            db.Releases.Add(new() { ProjectId=10, BaseVersion=770, Minor=0, ReleasedOn=new(2026,7,20), Notes="기본 버전" });
            var minor = new ReleaseRecord { ProjectId=10, BaseVersion=770, Minor=5, ReleasedOn=new(2026,7,20), ReleasedOnUnknown=true, Notes="마이너 내용 미기재", Status="unrecorded", Issue="원본 메모", SourceReference="https://docs.google.com/spreadsheets/d/test/edit#range=B85" };
            db.Releases.Add(minor); await db.SaveChangesAsync(); recordId=minor.Id;
        }
        var legacy = await employee.GetFromJsonAsync<JsonElement>("/api/legacy-releases?projectId=10");
        Assert.Equal(1, legacy.GetProperty("total").GetInt32()); Assert.Equal(JsonValueKind.Null, legacy.GetProperty("items")[0].GetProperty("releasedOn").ValueKind);
        var input = new ReleaseInput(10,770,5,new(2026,7,20),"메모 보완","unrecorded","원본 메모",null,1,null,true);
        var update = await admin.PutAsJsonAsync($"/api/releases/{recordId}",input); update.EnsureSuccessStatusCode();
        var preserved = (await update.Content.ReadFromJsonAsync<ReleaseRecord>())!; Assert.True(preserved.ReleasedOnUnknown); Assert.Contains("B85",preserved.SourceReference);
        var corrected = await admin.PutAsJsonAsync($"/api/releases/{recordId}",input with { Version=2, ReleasedOn=new(2026,7,25), ReleasedOnUnknown=false }); corrected.EnsureSuccessStatusCode();
        Assert.False((await corrected.Content.ReadFromJsonAsync<ReleaseRecord>())!.ReleasedOnUnknown);
        factory.Projects[0].IsPrivate=true;
        Assert.Equal(HttpStatusCode.NotFound,(await employee.GetAsync("/api/legacy-releases?projectId=10")).StatusCode);
    }
}
