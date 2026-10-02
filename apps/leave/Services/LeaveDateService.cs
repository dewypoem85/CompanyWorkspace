using LeaveManager.Models;

namespace LeaveManager.Services;

public class LeaveDateService
{
    public DateOnly GetNextRenewalDate(Employee employee, DateOnly asOf)
    {
        var completedYears = asOf.Year - employee.HireDate.Year;
        if (asOf < employee.HireDate.AddYears(completedYears)) completedYears--;

        if (completedYears < 1)
        {
            for (var month = 1; month <= 11; month++)
            {
                var d = employee.HireDate.AddMonths(month);
                if (d >= asOf) return d;
            }
            return employee.HireDate.AddYears(1);
        }

        var next = employee.HireDate.AddYears(completedYears);
        if (next < asOf) next = employee.HireDate.AddYears(completedYears + 1);
        return next;
    }

    public string GetNextRenewalLabel(Employee employee, DateOnly asOf)
    {
        var date = GetNextRenewalDate(employee, asOf);
        var completedYears = date.Year - employee.HireDate.Year;
        if (date < employee.HireDate.AddYears(completedYears)) completedYears--;
        if (completedYears < 1) return $"월차 발생일 {date:yyyy-MM-dd}";
        return $"연차 갱신일 {date:yyyy-MM-dd}";
    }
}
