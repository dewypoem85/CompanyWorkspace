using CompanyPortal.Pages.Admin;
using CompanyPortal.Workspace;

namespace CompanyPortal.Models;

// One renderer/model for create and bulk edit. Prefix changes only the form binding path.
public sealed record AccountFieldView(UsersModel Page, AccountInput Input, string Prefix,
    AccountField Field, string? PersonName = null, UsersModel.PermissionOption? Permission = null)
{
    public string Name => Prefix + Field.Key;
    public bool Shared => Input.AccountType == "shared";
    public bool Compact => Prefix.Length > 0;
    public string AccessibleLabel => (PersonName is null ? "" : PersonName + " ") + Field.Label;
}
