using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Schedule;
using Xunit;

public class ImageWriteProtocolTests
{
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=");

    private static async Task<HttpResponseMessage> Upload(HttpClient client, string? actor = "2", string? accept = TaskWriteProtocol.MediaType, byte[]? bytes = null, string name = "이미지.png")
    {
        using var form = new MultipartFormDataContent();form.Add(new ByteArrayContent(bytes ?? Png), "file", name);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/images") { Content = form };
        if (actor is not null) request.Headers.Add(TaskWriteProtocol.ActorHeader, actor);
        if (accept is not null) request.Headers.TryAddWithoutValidation("Accept", accept);
        return await client.SendAsync(request);
    }

    private static async Task<JsonElement> Envelope(HttpResponseMessage response, HttpStatusCode status, string outcome)
    {
        Assert.Equal(status, response.StatusCode);Assert.Equal(TaskWriteProtocol.MediaType, response.Content.Headers.ContentType?.MediaType);
        var json=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("workspace-form-v1",json.GetProperty("protocol").GetString());Assert.Equal(outcome,json.GetProperty("outcome").GetString());return json;
    }

    [Fact] public async Task EnhancedUploadConfirmsActorDigestAndTheEntireSavedAttachment()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login(2);
        var data=(await Envelope(await Upload(client),HttpStatusCode.OK,"saved")).GetProperty("data");
        Assert.Equal("upload",data.GetProperty("operation").GetString());Assert.Equal("2",data.GetProperty("actorId").GetString());
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Png)),data.GetProperty("sha256").GetString());
        var image=data.GetProperty("attachment");Assert.Matches("^[a-f0-9]{32}$",image.GetProperty("id").GetString()!);Assert.Equal("이미지.png",image.GetProperty("name").GetString());
        Assert.Equal("image/png",image.GetProperty("contentType").GetString());Assert.Equal(Png.Length,image.GetProperty("size").GetInt64());Assert.Equal(2,image.GetProperty("ownerId").GetInt64());
        Assert.Equal(JsonValueKind.Null,image.GetProperty("taskId").ValueKind);Assert.Equal(JsonValueKind.Null,image.GetProperty("commentId").ValueKind);Assert.True(image.TryGetProperty("createdAt",out _));
        Assert.True(File.Exists(Path.Combine(factory.DataFolder,"images",image.GetProperty("id").GetString()!)));
    }

    [Fact] public async Task LegacyUploadKeepsItsAttachmentResponse()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login(2);
        var response=await Upload(client,accept:null);response.EnsureSuccessStatusCode();Assert.Equal("application/json",response.Content.Headers.ContentType?.MediaType);
        var image=(await response.Content.ReadFromJsonAsync<Attachment>())!;Assert.Equal(2,image.OwnerId);Assert.Equal("image/png",image.ContentType);
    }

    [Fact] public async Task EnhancedUploadRejectsWrongActorAndInvalidBytesBeforeWriting()
    {
        await using var factory=new ScheduleFactory();using var client=await factory.Login(2);
        await Envelope(await Upload(client,actor:"1"),HttpStatusCode.Conflict,"conflict");
        await Envelope(await Upload(client,bytes:"not an image"u8.ToArray()),HttpStatusCode.UnprocessableEntity,"invalid");
        using var scope=factory.Services.CreateScope();Assert.Empty(scope.ServiceProvider.GetRequiredService<ScheduleDb>().Attachments);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(factory.DataFolder,"images")));
    }
}
