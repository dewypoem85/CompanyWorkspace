using CompanyPortal.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CompanyPortal.Pages.Notifications;

public sealed class IndexModel(CurrentUserService currentUser, NotificationAggregationService notifications) : PageModel
{
    public WorkspaceNotificationFeed Feed { get; private set; } = new([], [], 0);
    public string OwnerId { get; private set; } = "";

    public async Task OnGetAsync(CancellationToken cancellationToken)
    {
        var user = await currentUser.GetRequiredAsync();
        OwnerId = user.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        Feed = await notifications.GetAsync(user.Id, cancellationToken: cancellationToken);
    }
}
