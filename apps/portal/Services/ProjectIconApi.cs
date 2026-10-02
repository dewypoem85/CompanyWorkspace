using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public static class ProjectIconApi
{
    public static void MapProjectIcons(this RouteGroupBuilder group)
    {
        group.MapGet("/project-icon/{id:long}", async (long id, HttpContext ctx, AppDbContext db, CurrentUserService current) =>
        {
            if (ctx.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var user = await current.GetRequiredAsync();
            if (!await db.Projects.AnyAsync(p => p.Id == id && (!p.IsPrivate || user.IsAdmin || user.IsMaster))) return Results.NotFound();
            var bytes = await db.Database.SqlQuery<byte[]>($"SELECT Image AS Value FROM WorkspaceProjectIcons WHERE ProjectId={id}").SingleOrDefaultAsync();
            ctx.Response.Headers.XContentTypeOptions = "nosniff";
            return bytes is null ? Results.NotFound() : Results.File(bytes, "image/png");
        });
        group.MapPost("/project-icon/{id:long}", async (long id, HttpContext ctx, AppDbContext db, CurrentUserService current) =>
        {
            if (!PermissionCatalog.IsAdministrator(await current.GetRequiredAsync())) return Results.StatusCode(403);
            if (!await db.Projects.AnyAsync(p => p.Id == id)) return Results.NotFound();
            if (ctx.Request.ContentLength is > 524288) return Results.StatusCode(413);
            byte[] image;
            try { image = await AvatarStore.ReadPngAsync(ctx.Request.Body, ctx.RequestAborted); }
            catch (AvatarStore.SizeException) { return Results.StatusCode(413); }
            catch (OperationCanceledException) { throw; }
            catch { return Results.BadRequest(new { error = "올바른 256×256 PNG 아이콘을 선택해 주세요." }); }
            var version = await WorkspaceImageStore.ApplyAsync(db, WorkspaceImageKind.Project, id, image, null);
            return Results.Ok(new { iconUrl = $"/api/workspace/project-icon/{id}?v={version}" });
        });
        group.MapDelete("/project-icon/{id:long}", async (long id, AppDbContext db, CurrentUserService current) =>
        {
            if (!PermissionCatalog.IsAdministrator(await current.GetRequiredAsync())) return Results.StatusCode(403);
            await WorkspaceImageStore.ApplyAsync(db, WorkspaceImageKind.Project, id, null, null);
            return Results.NoContent();
        });
    }
}
