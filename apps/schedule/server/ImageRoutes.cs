using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace Schedule;
public static class ImageRoutes
{
    public const long MaxBytes = 10 * 1024 * 1024;
    public static void MapImages(this WebApplication app)
    {
        app.MapPost("/api/images", async (HttpRequest req, ScheduleDb db, Access access, IConfiguration config) =>
        {
            var me = await access.Me();
            ImageWriteProtocol.RequireActor(req, me);
            if (!req.HasFormContentType || req.ContentLength > MaxBytes + 65536) throw new ApiError(413, "이미지는 파일당 10MB까지 첨부할 수 있습니다.");
            var form = await req.ReadFormAsync();
            if (form.Files.Count != 1) throw new ApiError(400, "이미지 한 개를 선택해 주세요.");
            var file = form.Files[0];
            if (file.Length == 0 || file.Length > MaxBytes) throw new ApiError(413, "이미지는 파일당 10MB까지 첨부할 수 있습니다.");
            await using var input = file.OpenReadStream();
            var header = new byte[16]; var read = await input.ReadAsync(header);
            var type = Detect(header.AsSpan(0, read));
            if (type is null) throw new ApiError(400, "JPEG·PNG·WebP·GIF 이미지만 첨부할 수 있습니다.");
            var temporaryBytes = await db.Attachments.Where(x => x.OwnerId == me.Id && x.TaskId == null && x.FeedbackId == null).SumAsync(x => x.Size);
            if (temporaryBytes + file.Length > 200 * 1024 * 1024) throw new ApiError(429, "임시 첨부 용량을 초과했습니다. 작성 중인 게시글을 저장한 뒤 다시 시도해 주세요.");
            var image = new Attachment { OwnerId = me.Id, Name = Path.GetFileName(file.FileName)[..Math.Min(Path.GetFileName(file.FileName).Length, 200)], ContentType = type, Size = file.Length };
            var path = Path.Combine(config["DataPath"]!, "images", image.Id);
            string sha256;
            try
            {
                ImageWriteProtocol.StartingWrite(req);
                using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                await using (var output = new FileStream(path, FileMode.CreateNew))
                {
                    await output.WriteAsync(header.AsMemory(0, read)); hash.AppendData(header, 0, read);
                    var buffer = new byte[81920]; int count;
                    while ((count = await input.ReadAsync(buffer)) > 0) { await output.WriteAsync(buffer.AsMemory(0, count)); hash.AppendData(buffer, 0, count); }
                }
                sha256 = Convert.ToHexStringLower(hash.GetHashAndReset());
                db.Attachments.Add(image); await db.SaveChangesAsync();
            }
            catch { if (File.Exists(path)) File.Delete(path); throw; }
            return ImageWriteProtocol.Saved(req, me, image, sha256);
        }).AddEndpointFilter<ImageWriteProtocol>();
        app.MapGet("/api/images/{id}", async (string id, ScheduleDb db, Access access, IConfiguration config) =>
        {
            var me = await access.Me(); var image = await db.Attachments.FindAsync(id) ?? throw new ApiError(404, "이미지를 찾을 수 없습니다.");
            if (image.TaskId is null && image.FeedbackId is null && image.OwnerId != me.Id) throw new ApiError(403, "이미지를 볼 수 없습니다.");
            var path = Path.Combine(config["DataPath"]!, "images", image.Id);
            if (image.TaskId.HasValue) await TaskRoutes.Find(db, image.TaskId.Value, me);
            if (image.FeedbackId.HasValue) await FeedbackRoutes.Find(db, me, image.FeedbackId.Value);
            if (!File.Exists(path)) throw new ApiError(404, "이미지 파일을 찾을 수 없습니다.");
            return Results.File(path, image.ContentType);
        });
    }
    public static string? Detect(ReadOnlySpan<byte> b)
    {
        if (b.Length < 12) return null;
        if (b[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (b[0] == 255 && b[1] == 216 && b[2] == 255) return "image/jpeg";
        if (b[..6].SequenceEqual("GIF87a"u8) || b[..6].SequenceEqual("GIF89a"u8)) return "image/gif";
        if (b[..4].SequenceEqual("RIFF"u8) && b.Slice(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return null;
    }
}
