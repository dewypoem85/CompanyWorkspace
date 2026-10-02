using CompanyPortal.Data;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

// Shared storage for legacy raw-image API and the versioned profile form.
internal static class AvatarStore
{
    internal sealed class SizeException : Exception;
    public static Task<string?> VersionAsync(AppDbContext db, long userId) =>
        db.Database.SqlQuery<string>($"SELECT Version AS Value FROM WorkspaceProfiles WHERE UserId={userId}").SingleOrDefaultAsync();

    public static async Task<byte[]> ReadPngAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int length;
        while ((length = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + length > 524288) throw new SizeException();
            buffer.Write(chunk, 0, length);
        }
        return AvatarPng.Normalize(buffer.ToArray());
    }

    public static Task<string?> ApplyAsync(AppDbContext db, long userId, byte[]? image, string? expectedVersion) =>
        WorkspaceImageStore.ApplyAsync(db, WorkspaceImageKind.Profile, userId, image, expectedVersion);
}
