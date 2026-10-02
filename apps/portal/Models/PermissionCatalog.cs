namespace CompanyPortal.Models;

public static class PermissionCatalog
{
    public const string ScheduleAccess = "schedule.access";
    public const string LeaveAccess = "leave.access";
    public const string CsAccess = "cs.access";
    public const string StatisticsAccess = "statistics.access";
    public const string SheetAccess = "sheet.access";
    public const string IapAccess = "iap.access";
    public const string IapPublish = "iap.publish";

    public static readonly IReadOnlyList<string> All =
        CompanySystemCatalog.All.Select(x => x.AccessPermission).Append(IapPublish).ToArray();

    public static readonly IReadOnlyList<string> DefaultForEmployees =
        CompanySystemCatalog.DefaultForEmployees.Select(x => x.AccessPermission).ToArray();

    public static readonly IReadOnlyList<string> Configurable =
        CompanySystemCatalog.Configurable.Select(x => x.AccessPermission).Append(IapPublish).ToArray();

    private static readonly IReadOnlySet<string> Allowed =
        All.ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static readonly IReadOnlySet<string> Defaults =
        DefaultForEmployees.ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static readonly IReadOnlySet<string> ConfigurableSet =
        Configurable.ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static IReadOnlySet<string> Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return value
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(Allowed.Contains)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public static string Normalize(IEnumerable<string>? permissions)
    {
        var selected = (permissions ?? [])
            .Where(ConfigurableSet.Contains)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (selected.Contains(IapPublish)) selected.Add(IapAccess);

        return string.Join(',', Configurable.Where(selected.Contains));
    }

    public static IReadOnlyList<string> Effective(CompanyUser user)
    {
        if (IsAdministrator(user)) return All;
        var selected = Parse(user.Permissions);
        return All.Where(permission => IsEmployeeDefault(user, permission) || selected.Contains(permission)).ToArray();
    }

    public static bool Has(CompanyUser user, string permission)
        => IsAdministrator(user) || IsEmployeeDefault(user, permission) || Parse(user.Permissions).Contains(permission);

    public static bool IsAdministrator(CompanyUser user)
        => !user.IsSharedAccount && (user.IsAdmin || user.IsMaster);

    public static string CompanyRole(CompanyUser user)
        => user.IsSharedAccount ? "employee" : user.IsMaster ? "master" : user.IsAdmin ? "admin" : "employee";

    public static string AccountType(CompanyUser user)
        => user.IsSharedAccount ? "shared" : "employee";

    private static bool IsEmployeeDefault(CompanyUser user, string permission)
        => !user.IsSharedAccount && Defaults.Contains(permission);
}
