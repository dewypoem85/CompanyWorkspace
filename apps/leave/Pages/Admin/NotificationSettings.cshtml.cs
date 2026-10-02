using LeaveManager.Data;
using LeaveManager.Models;
using LeaveManager.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LeaveManager.Pages.Admin;

public class NotificationSettingsModel(CurrentEmployeeService current, AppDbContext db, DiscordNotificationService discord, AuditService audit, ILogger<NotificationSettingsModel> logger) : PageModel
{
    [BindProperty] public string WebhookUrl { get; set; } = "";
    [BindProperty] public string? Memo { get; set; }
    public bool Configured { get; set; }
    public int WebhookCount { get; set; }
    public List<DiscordWebhook> Webhooks { get; set; } = [];
    public string? Message { get; set; }
    public string? Error { get; set; }
    public bool Locked { get; set; }
    public string ActorId { get; set; } = "";
    public string StateToken => Token(Webhooks);
    const string MediaType = "application/vnd.company.workspace-form+json";
    bool Enhanced => Request.Headers.Accept.ToString().Split(',').Any(x=>x.Trim()==MediaType);
    static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    static string Token(IEnumerable<DiscordWebhook> rows) => Hash(JsonSerializer.Serialize(rows.OrderBy(x=>x.Id).Select(x=>new {x.Id,x.Url,x.Memo,x.CreatedAtUtc.Ticks})));
    public object Snapshot() => new {actorEmployeeId=ActorId,stateToken=StateToken,items=Webhooks.Select(x=>new {id=x.Id.ToString(CultureInfo.InvariantCulture),memo=x.Memo??"",maskedUrl=Mask(x.Url),createdAt=AppTime.ToKst(x.CreatedAtUtc).ToString("yyyy-MM-dd HH:mm",CultureInfo.InvariantCulture)})};
    IActionResult Result(string outcome,string message,int status,object? data=null) {
        Response.Headers.CacheControl="no-store";
        return new JsonResult(new {protocol="workspace-form-v1",outcome,message,data}){StatusCode=status,ContentType=MediaType};
    }
    async Task<IActionResult> Failure(string outcome,string message,int status) {
        if(Enhanced)return Result(outcome,message,status);
        Locked=outcome!="invalid";Error=message;await LoadAsync();return Page();
    }
    async Task<IActionResult?> CheckTarget() {
        await LoadAsync();
        var actor=Request.Form["expectedEmployeeId"];
        var token=Request.Form["expectedStateToken"];
        if(!Enhanced&&actor.Count==0&&token.Count==0)return null; // Old native documents remain compatible.
        if(actor.Count==1&&token.Count==1&&actor[0]==ActorId&&token[0]==StateToken)return null;
        return await Failure("conflict","계정 또는 웹훅 목록이 변경되었습니다. 현재 설정을 다시 확인하세요.",409);
    }
    async Task<IActionResult> Saved(string operation,string previous,object? affected,string message) {
        await LoadAsync();
        if(Enhanced)return Result("saved",message,200,new {operation,previousStateToken=previous,affected,snapshot=Snapshot(),navigateTo="/Admin/NotificationSettings"});
        Message=message;return Page();
    }
    async Task<IActionResult> Unknown(Exception ex) {
        logger.LogWarning(ex,"채널 알림 설정 처리 결과 미확정");
        return await Failure("unknown","처리 결과를 확인하지 못했습니다. 일부 설정이 저장되었거나 메시지가 발송되었을 수 있습니다. 현재 설정과 Discord 수신 내역을 확인하고 자동으로 다시 보내지 마세요.",502);
    }

    public async Task OnGet() => await LoadAsync();

    public async Task<IActionResult> OnPostAdd()
    {
        if(await CheckTarget() is {} rejected)return rejected;
        var previous=StateToken;
        var actor = await current.GetRequiredAsync();
        WebhookUrl = (WebhookUrl ?? "").Trim();
        Memo = string.IsNullOrWhiteSpace(Memo) ? null : Memo.Trim();

        if (!ModelState.IsValid || Request.Form["WebhookUrl"].Count!=1 || Request.Form["Memo"].Count>1 || (Memo?.Length??0)>200 || !IsValidDiscordWebhookUrl(WebhookUrl))
        {
            return await Failure("invalid","올바른 Discord 웹훅 URL과 200자 이내 메모를 입력하세요.",422);
        }

        var exists = await db.DiscordWebhooks.AnyAsync(x => x.Url == WebhookUrl);
        if (exists)
        {
            return await Failure("invalid","이미 등록된 웹훅 URL입니다.",422);
        }

        var webhook=new DiscordWebhook
        {
            Url = WebhookUrl,
            Memo = Memo,
            CreatedByEmployeeId = actor.Id,
            CreatedAtUtc = AppTime.UtcNow
        };
        try {
        db.DiscordWebhooks.Add(webhook);
        await db.SaveChangesAsync();
        await audit.WriteAsync(actor.Id, "DiscordWebhookAdded", "Discord", null, reason: Memo);
        var affected=new {id=webhook.Id.ToString(CultureInfo.InvariantCulture),memo=Memo??"",urlHash=Hash(WebhookUrl)};
        WebhookUrl = "";
        Memo = null;
        return await Saved("Add",previous,affected,"디스코드 웹훅을 추가했습니다.");
        } catch(Exception ex){return await Unknown(ex);}
    }

    public async Task<IActionResult> OnPostDelete(long id)
    {
        if(await CheckTarget() is {} rejected)return rejected;
        var previous=StateToken;
        if(!ModelState.IsValid||id<=0||Request.Form["id"].Count!=1)return await Failure("invalid","삭제할 웹훅 번호를 확인하세요.",422);
        var actor = await current.GetRequiredAsync();
        var webhook = await db.DiscordWebhooks.SingleOrDefaultAsync(x => x.Id == id);
        if (webhook is null)
        {
            return await Failure("conflict","삭제할 웹훅을 찾을 수 없습니다. 현재 목록을 확인하세요.",409);
        }

        var memo = webhook.Memo;
        var masked = DiscordNotificationService.MaskWebhookUrl(webhook.Url);
        try {
        db.DiscordWebhooks.Remove(webhook);
        await db.SaveChangesAsync();
        await audit.WriteAsync(actor.Id, "DiscordWebhookDeleted", "Discord", id.ToString(), reason: memo ?? masked);
        return await Saved("Delete",previous,new {id=id.ToString(CultureInfo.InvariantCulture)},"디스코드 웹훅을 삭제했습니다.");
        } catch(Exception ex){return await Unknown(ex);}
    }

    public async Task<IActionResult> OnPostTest()
    {
        if(await CheckTarget() is {} rejected)return rejected;
        var previous=StateToken;
        if (!Configured)
        {
            return await Failure("invalid","등록된 디스코드 웹훅이 없습니다.",422);
        }

        try
        {
            var actor = await current.GetRequiredAsync();
            // Use the exact checked list, not another DB read after confirmation.
            await discord.SendTestAsync(actor,Webhooks);
            await audit.WriteAsync(actor.Id, "DiscordNotificationTested", "Discord", null);
            if(Enhanced)return Result("saved","Discord에서 테스트 발송 요청을 수락했습니다. 실제 수신은 채널에서 확인하세요.",200,new {operation="Test",previousStateToken=previous,affected=(object?)null,snapshot=Snapshot(),navigateTo="/Admin/NotificationSettings"});
            Message = $"디스코드 테스트 메시지를 {WebhookCount}개 웹훅으로 발송했습니다.";
        }
        catch (Exception ex)
        {
            return await Unknown(ex);
        }
        await LoadAsync();
        return Page();
    }

    private async Task LoadAsync()
    {
        Response.Headers.CacheControl="no-store";
        ActorId=(await current.GetRequiredAsync()).Id.ToString(CultureInfo.InvariantCulture);
        Webhooks = await db.DiscordWebhooks
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .ToListAsync();
        WebhookCount = Webhooks.Count;
        Configured = WebhookCount > 0;
    }

    public static string Mask(string url) => DiscordNotificationService.MaskWebhookUrl(url);

    private static bool IsValidDiscordWebhookUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort) return false;
        if (!string.IsNullOrWhiteSpace(uri.UserInfo)
            || !string.IsNullOrWhiteSpace(uri.Query)
            || !string.IsNullOrWhiteSpace(uri.Fragment)) return false;

        var host = uri.IdnHost.TrimEnd('.');
        if (!string.Equals(host, "discord.com", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(host, "discordapp.com", StringComparison.OrdinalIgnoreCase)) return false;

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments.Length == 4
            && string.Equals(segments[0], "api", StringComparison.OrdinalIgnoreCase)
            && string.Equals(segments[1], "webhooks", StringComparison.OrdinalIgnoreCase)
            && ulong.TryParse(segments[2], out _)
            && segments[3].Length >= 20;
    }
}
