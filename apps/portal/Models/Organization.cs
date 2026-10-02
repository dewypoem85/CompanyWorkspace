namespace CompanyPortal.Models;

public class Department
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public bool HandlesScheduleFeedback { get; set; }
    public bool Archived { get; set; }
    public int Version { get; set; } = 1;
}
public class CompanyProject
{
    public bool IsPrivate { get; set; }
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#3b65de";
    public bool Archived { get; set; }
    public int Version { get; set; } = 1;
}
public class ProjectMembership { public long EmployeeId { get; set; } public long ProjectId { get; set; } }
public class DepartmentLead { public long DepartmentId { get; set; } public long EmployeeId { get; set; } }
public class OrganizationImport { public string Id { get; set; } = ""; public DateTime ImportedAtUtc { get; set; } = DateTime.UtcNow; }
