using LeaveManager.Data;
using LeaveManager.Models;
using Microsoft.EntityFrameworkCore;

namespace LeaveManager.Services;

public sealed class CompanyEmployeeConflictException(string message) : InvalidOperationException(message);

public sealed record CompanyEmployeeProjectionResult(
    Employee? Employee,
    bool Created,
    bool HireDateUpdated,
    bool HireDatePreserved);

public class CompanyEmployeeProjectionService(AppDbContext db)
{
    public async Task<CompanyEmployeeProjectionResult> ApplyAsync(
        CompanySsoUser portalUser,
        CancellationToken cancellationToken = default)
    {
        var isSharedAccount = portalUser.AccountType == "shared";
        var shouldBeActive = !isSharedAccount
            && portalUser.Active
            && portalUser.Permissions.Contains(CompanySsoService.LeaveAccess);

        var employee = await db.Employees.SingleOrDefaultAsync(
            x => x.CompanyUserId == portalUser.CompanyUserId,
            cancellationToken);

        if (employee is null)
        {
            var legacyEmployee = await db.Employees.SingleOrDefaultAsync(
                x => x.Email == portalUser.Email,
                cancellationToken);
            if (legacyEmployee?.CompanyUserId is not null)
                throw new CompanyEmployeeConflictException(
                    "이 이메일의 연차 프로필은 다른 회사 계정에 이미 연결되어 있습니다.");

            employee = legacyEmployee;
        }

        if (employee is null && !shouldBeActive)
            return new CompanyEmployeeProjectionResult(null, false, false, false);

        var role = portalUser.CompanyRole is "admin" or "master"
            ? EmployeeRole.Master
            : EmployeeRole.Employee;

        if (employee is null)
        {
            employee = new Employee
            {
                CompanyUserId = portalUser.CompanyUserId,
                Email = portalUser.Email,
                Name = portalUser.Name,
                Department = portalUser.Department,
                HireDate = portalUser.HireDate,
                BirthDate = portalUser.BirthDate,
                Role = role,
                IsSharedAccount = false,
                IsPrivate = portalUser.IsPrivate,
                IsCompanyMaster = portalUser.CompanyRole == "master",
                IsActive = true
            };
            db.Employees.Add(employee);
            await db.SaveChangesAsync(cancellationToken);
            return new CompanyEmployeeProjectionResult(employee, true, true, false);
        }

        if (await db.Employees.AnyAsync(
                x => x.Id != employee.Id && x.Email == portalUser.Email,
                cancellationToken))
            throw new CompanyEmployeeConflictException(
                "회사 포털 이메일과 기존 연차 직원 이메일이 충돌합니다.");

        var hireDateUpdated = false;
        var hireDatePreserved = false;
        if (employee.HireDate != portalUser.HireDate)
        {
            var hasLeaveHistory = await HasLeaveHistoryAsync(employee.Id, cancellationToken);
            if (hasLeaveHistory)
            {
                hireDatePreserved = true;
            }
            else
            {
                employee.HireDate = portalUser.HireDate;
                hireDateUpdated = true;
            }
        }

        employee.CompanyUserId = portalUser.CompanyUserId;
        employee.Email = portalUser.Email;
        employee.Name = portalUser.Name;
        employee.Department = portalUser.Department;
        if (portalUser.BirthDateSupplied) employee.BirthDate = portalUser.BirthDate;
        employee.Role = role;
        employee.IsSharedAccount = isSharedAccount;
        employee.IsPrivate = portalUser.IsPrivate;
        employee.IsCompanyMaster = portalUser.CompanyRole == "master";
        employee.IsActive = shouldBeActive;

        await db.SaveChangesAsync(cancellationToken);
        return new CompanyEmployeeProjectionResult(employee, false, hireDateUpdated, hireDatePreserved);
    }

    private async Task<bool> HasLeaveHistoryAsync(long employeeId, CancellationToken cancellationToken)
        => await db.LeaveRequests.AnyAsync(x => x.EmployeeId == employeeId, cancellationToken)
           || await db.LeaveGrants.AnyAsync(x => x.EmployeeId == employeeId, cancellationToken)
           || await db.LeaveSettlements.AnyAsync(x => x.EmployeeId == employeeId, cancellationToken);
}
