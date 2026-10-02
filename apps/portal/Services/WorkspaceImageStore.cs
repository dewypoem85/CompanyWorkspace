using CompanyPortal.Data;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

internal enum WorkspaceImageKind { Profile, Project }

// Identifiers come only from this closed enum; all values remain SQL parameters.
internal static class WorkspaceImageStore
{
    static (string Table, string Key) Target(WorkspaceImageKind kind) => kind switch {
        WorkspaceImageKind.Profile => ("WorkspaceProfiles", "UserId"),
        WorkspaceImageKind.Project => ("WorkspaceProjectIcons", "ProjectId"),
        _ => throw new ArgumentOutOfRangeException(nameof(kind))
    };
    public static Task<string?> VersionAsync(AppDbContext db, WorkspaceImageKind kind, long id)
    {
        var (table,key)=Target(kind);
        return db.Database.SqlQuery<string>(System.Runtime.CompilerServices.FormattableStringFactory.Create($"SELECT Version AS Value FROM {table} WHERE {key}={{0}}",id)).SingleOrDefaultAsync();
    }
    static Task<int> ExecuteAsync(AppDbContext db, string format, params object[] values) =>
        db.Database.ExecuteSqlInterpolatedAsync(System.Runtime.CompilerServices.FormattableStringFactory.Create(format, values));
    // Null expectedVersion is exclusively the legacy raw API's last-write-wins compatibility.
    public static async Task<string?> ApplyAsync(AppDbContext db, WorkspaceImageKind kind, long id, byte[]? image, string? expectedVersion)
    {
        var (table,key)=Target(kind);var version=image is null ? null : Guid.NewGuid().ToString("N");int changed;
        if(image is not null) {
            if(expectedVersion is null)
                changed=await ExecuteAsync(db,$"INSERT INTO {table}({key},Image,Version) VALUES ({{0}},{{1}},{{2}}) ON CONFLICT({key}) DO UPDATE SET Image=excluded.Image,Version=excluded.Version",id,image,version!);
            else if(expectedVersion.Length==0)
                changed=await ExecuteAsync(db,$"INSERT INTO {table}({key},Image,Version) VALUES ({{0}},{{1}},{{2}}) ON CONFLICT({key}) DO NOTHING",id,image,version!);
            else changed=await ExecuteAsync(db,$"UPDATE {table} SET Image={{0}},Version={{1}} WHERE {key}={{2}} AND Version={{3}}",image,version!,id,expectedVersion);
        } else if(expectedVersion is null)
            changed=await ExecuteAsync(db,$"DELETE FROM {table} WHERE {key}={{0}}",id);
        else if(expectedVersion.Length==0)changed=await VersionAsync(db,kind,id) is null ? 1 : 0;
        else changed=await ExecuteAsync(db,$"DELETE FROM {table} WHERE {key}={{0}} AND Version={{1}}",id,expectedVersion);
        if(expectedVersion is not null && changed!=1)throw new DbUpdateConcurrencyException("다른 곳에서 이미지가 변경되었습니다. 현재 이미지를 다시 확인해 주세요.");
        return version;
    }
}
