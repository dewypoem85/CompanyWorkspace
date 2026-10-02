namespace LeaveManager.Services;

public static class BirthdayCalendarDate
{
    public static DateOnly InYear(DateOnly birthDate, int year)
    {
        if (birthDate.Month == 2 && birthDate.Day == 29 && !DateTime.IsLeapYear(year))
            return new DateOnly(year, 2, 28);
        return new DateOnly(year, birthDate.Month, birthDate.Day);
    }
}
