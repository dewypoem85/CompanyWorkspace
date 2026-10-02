using CompanyPortal.Data;
using CompanyPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace CompanyPortal.Services;

public class CurrentUserService(IHttpContextAccessor accessor, AppDbContext db)
{
    public async Task<CompanyUser> GetRequiredAsync()
    {
        var idText = accessor.HttpContext?.User.FindFirst("CompanyUserId")?.Value;
        if (!long.TryParse(idText, out var id))
            throw new InvalidOperationException("회사 계정 정보를 확인할 수 없습니다.");

        return await db.Users.SingleAsync(x => x.Id == id && x.IsActive);
    }
}
