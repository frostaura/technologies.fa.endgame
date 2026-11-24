using System.Globalization;

namespace Endgame.Domain.Platform;

/// <summary>
/// A five-field cron expression — minute, hour, day of month, month, day of week — read in an IANA
/// time zone (PLATFORM-API §3.5). Each field takes <c>*</c>, a number, a range <c>a-b</c>, a step
/// <c>*/n</c> or <c>a-b/n</c>, and comma-separated lists of those; months and weekdays also take
/// three-letter names, and weekday 7 is Sunday. When both day fields are restricted, a day matches if
/// either does (the classic cron rule). A local time skipped by a daylight-saving change never fires;
/// a repeated one fires once, at its first occurrence.
/// </summary>
public sealed class CronSchedule
{
    private static readonly string[] MonthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    private static readonly string[] DayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

    /// <summary>How far ahead the next run is looked for. An expression that never fires within it (31 February) is refused.</summary>
    private const int SearchYears = 5;

    private readonly bool[] minutes;
    private readonly bool[] hours;
    private readonly bool[] daysOfMonth;
    private readonly bool[] months;
    private readonly bool[] daysOfWeek;
    private readonly bool anyDayOfMonth;
    private readonly bool anyDayOfWeek;

    private CronSchedule(string expression, bool[] minutes, bool[] hours, bool[] daysOfMonth, bool[] months, bool[] daysOfWeek, bool anyDayOfMonth, bool anyDayOfWeek)
    {
        Expression = expression;
        this.minutes = minutes;
        this.hours = hours;
        this.daysOfMonth = daysOfMonth;
        this.months = months;
        this.daysOfWeek = daysOfWeek;
        this.anyDayOfMonth = anyDayOfMonth;
        this.anyDayOfWeek = anyDayOfWeek;
    }

    public string Expression { get; }

    public static CronSchedule Parse(string? expression)
    {
        var fields = (expression ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (fields.Length != 5)
        {
            throw new DomainException($"'{expression}' is not a five-field cron expression (minute hour day-of-month month day-of-week).");
        }

        var schedule = new CronSchedule(
            string.Join(' ', fields),
            Field(fields[0], 0, 59, null, "minute"),
            Field(fields[1], 0, 23, null, "hour"),
            Field(fields[2], 1, 31, null, "day of month"),
            Field(fields[3], 1, 12, MonthNames, "month"),
            DaysOfWeek(fields[4]),
            fields[2] == "*",
            fields[4] == "*");
        if (schedule.NextAfter(new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero), TimeZoneInfo.Utc) is null)
        {
            throw new DomainException($"'{expression}' never fires.");
        }

        return schedule;
    }

    /// <summary>The IANA time zone a schedule is read in. Unknown names are refused.</summary>
    public static TimeZoneInfo Zone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64)
        {
            throw new DomainException("A schedule needs a time zone, for example UTC or Africa/Johannesburg.");
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            throw new DomainException($"'{id}' is not a time zone this platform knows (use an IANA name such as UTC or Europe/London).");
        }
    }

    /// <summary>The first moment strictly after <paramref name="after"/> when the schedule fires, or null if none within five years.</summary>
    public DateTimeOffset? NextAfter(DateTimeOffset after, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        var local = TimeZoneInfo.ConvertTime(after, zone).DateTime;
        var start = new DateTime(local.Year, local.Month, local.Day, local.Hour, local.Minute, 0, DateTimeKind.Unspecified).AddMinutes(1);
        var day = start.Date;
        var last = day.AddYears(SearchYears);
        for (; day <= last; day = day.AddDays(1))
        {
            if (!months[day.Month] || !DayMatches(day))
            {
                continue;
            }

            var firstHour = day == start.Date ? start.Hour : 0;
            for (var hour = firstHour; hour < 24; hour++)
            {
                if (!hours[hour])
                {
                    continue;
                }

                var firstMinute = day == start.Date && hour == start.Hour ? start.Minute : 0;
                for (var minute = firstMinute; minute < 60; minute++)
                {
                    if (!minutes[minute])
                    {
                        continue;
                    }

                    var candidate = day.AddHours(hour).AddMinutes(minute);
                    if (zone.IsInvalidTime(candidate))
                    {
                        continue;
                    }

                    // A repeated local time runs at its first occurrence: the larger offset.
                    var offset = zone.IsAmbiguousTime(candidate) ? zone.GetAmbiguousTimeOffsets(candidate).Max() : zone.GetUtcOffset(candidate);
                    var at = new DateTimeOffset(candidate, offset);
                    if (at > after)
                    {
                        return at.ToUniversalTime();
                    }
                }
            }
        }

        return null;
    }

    private bool DayMatches(DateTime day)
    {
        var dom = daysOfMonth[day.Day];
        var dow = daysOfWeek[(int)day.DayOfWeek];
        return (anyDayOfMonth, anyDayOfWeek) switch
        {
            (true, true) => true,
            (true, false) => dow,
            (false, true) => dom,
            _ => dom || dow,
        };
    }

    private static bool[] DaysOfWeek(string field)
    {
        var raw = Field(field, 0, 7, DayNames, "day of week");
        var days = new bool[7];
        for (var i = 0; i < 7; i++)
        {
            days[i] = raw[i];
        }

        days[0] |= raw[7];
        return days;
    }

    private static bool[] Field(string field, int min, int max, string[]? names, string what)
    {
        var set = new bool[max + 1];
        foreach (var part in field.Split(','))
        {
            if (part.Length == 0)
            {
                throw new DomainException($"The {what} field '{field}' has an empty item.");
            }

            var (range, stepText) = part.IndexOf('/', StringComparison.Ordinal) is var slash and >= 0 ? (part[..slash], part[(slash + 1)..]) : (part, null);
            var step = 1;
            if (stepText is not null && (!int.TryParse(stepText, NumberStyles.None, CultureInfo.InvariantCulture, out step) || step < 1 || step > max))
            {
                throw new DomainException($"The {what} field has an invalid step in '{part}'.");
            }

            int from, to;
            if (range == "*")
            {
                (from, to) = (min, max);
            }
            else if (range.IndexOf('-', StringComparison.Ordinal) is var dash and > 0)
            {
                from = Value(range[..dash], min, max, names, what);
                to = Value(range[(dash + 1)..], min, max, names, what);
                if (to < from)
                {
                    throw new DomainException($"The {what} range '{range}' runs backwards.");
                }
            }
            else
            {
                from = Value(range, min, max, names, what);
                to = stepText is null ? from : max;
            }

            for (var v = from; v <= to; v += step)
            {
                set[v] = true;
            }
        }

        return set;
    }

    private static int Value(string text, int min, int max, string[]? names, string what)
    {
        if (names is not null && Array.FindIndex(names, n => string.Equals(n, text, StringComparison.OrdinalIgnoreCase)) is var index and >= 0)
        {
            return index + (min == 1 ? 1 : 0);
        }

        return int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value >= min && value <= max
            ? value
            : throw new DomainException($"'{text}' is not a valid {what} ({min}-{max}).");
    }
}
