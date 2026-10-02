using CompanyPortal.Models;
using CompanyPortal.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CompanyPortal.Pages;

public class IndexModel(CurrentUserService currentUser) : PageModel
{
    public CompanyUser? CurrentUser { get; private set; }
    public IReadOnlyList<CompanySystemDefinition> AvailableSystems { get; private set; } = [];

    public async Task OnGetAsync()
    {
        if (User.Identity?.IsAuthenticated != true) return;
        CurrentUser = await currentUser.GetRequiredAsync();
        AvailableSystems = CompanySystemCatalog.All
            .Where(system => PermissionCatalog.Has(CurrentUser, system.AccessPermission))
            .ToArray();
    }
}
