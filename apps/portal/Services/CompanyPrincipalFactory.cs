using System.Security.Claims;
using CompanyPortal.Models;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace CompanyPortal.Services;

public static class CompanyPrincipalFactory
{
    public static ClaimsPrincipal Create(CompanyUser user)
    {
        var claims = new List<Claim>
        {
            new("CompanyUserId", user.Id.ToString()),
            new(ClaimTypes.Name, user.Name),
            new(ClaimTypes.Email, user.Email),
            new("CompanyRole", PermissionCatalog.CompanyRole(user)),
            new("CompanyAccountType", PermissionCatalog.AccountType(user)),
            new("PermissionSnapshot", string.Join(',', PermissionCatalog.Effective(user)))
        };
        if (PermissionCatalog.IsAdministrator(user)) claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        if (user.IsMaster) claims.Add(new Claim(ClaimTypes.Role, "Master"));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme,
            ClaimTypes.Name, ClaimTypes.Role));
    }
}
