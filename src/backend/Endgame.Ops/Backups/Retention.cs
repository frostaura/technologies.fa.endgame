using System.Globalization;

namespace Endgame.Ops.Backups;

/// <summary>
/// Which archives to keep: the newest of each of the last <c>keepDaily</c> days that have one, and
/// the newest of each of the last <c>keepWeekly</c> ISO weeks that have one. The newest archive is
/// always kept. Everything else is deleted, and only ever after a backup has succeeded.
/// </summary>
public static class Retention
{
    public static (IReadOnlyList<StoredBackup> Keep, IReadOnlyList<StoredBackup> Delete) Apply(IEnumerable<StoredBackup> backups, int keepDaily, int keepWeekly)
    {
        var newestFirst = backups.OrderByDescending(b => b.CreatedAt).ToList();
        var keep = new HashSet<StoredBackup>();
        if (newestFirst.Count > 0)
        {
            keep.Add(newestFirst[0]);
        }

        foreach (var day in newestFirst.GroupBy(b => DateOnly.FromDateTime(b.CreatedAt.UtcDateTime)).Take(Math.Max(1, keepDaily)))
        {
            keep.Add(day.First());
        }

        foreach (var week in newestFirst.GroupBy(b => WeekOf(b.CreatedAt)).Take(Math.Max(0, keepWeekly)))
        {
            keep.Add(week.First());
        }

        return (newestFirst.Where(keep.Contains).ToList(), newestFirst.Where(b => !keep.Contains(b)).ToList());
    }

    private static (int Year, int Week) WeekOf(DateTimeOffset at) =>
        (ISOWeek.GetYear(at.UtcDateTime), ISOWeek.GetWeekOfYear(at.UtcDateTime));
}

/// <summary>Bucket usage against the free allowance (R2: 10 GB-month, https://developers.cloudflare.com/r2/pricing/).</summary>
public sealed record StorageUsage(
    long UsedBytes,
    long AllowanceBytes,
    double Percent,
    long ProjectedBytes,
    string State,
    string Message)
{
    public static StorageUsage From(IReadOnlyList<StoredBackup> stored, BackupOptions options, bool offsite)
    {
        var used = stored.Sum(b => b.Bytes);
        var allowance = (long)(options.AllowanceGb * 1_000_000_000d);
        var newest = stored.Count == 0 ? 0 : stored.MaxBy(b => b.CreatedAt)!.Bytes;
        // Tomorrow night's archive is uploaded before anything is pruned, so that is the peak.
        var projected = used + newest;
        var percent = allowance == 0 ? 0 : Math.Round(100d * used / allowance, 2);
        var gb = (long bytes) => (bytes / 1_000_000_000d).ToString("0.###", CultureInfo.InvariantCulture);
        if (!offsite)
        {
            return new StorageUsage(used, allowance, percent, projected, "local",
                $"{gb(used)} GB in {stored.Count} archive(s) on this machine; nothing is offsite.");
        }

        if (projected > allowance)
        {
            return new StorageUsage(used, allowance, percent, projected, "over",
                $"The next backup would take the bucket to {gb(projected)} GB, past the {gb(allowance)} GB free allowance. Keep fewer archives (ENDGAME_BACKUP_KEEP_DAILY / _WEEKLY) or accept the charge.");
        }

        if (projected * 100 > allowance * (long)options.WarnPercent)
        {
            return new StorageUsage(used, allowance, percent, projected, "warning",
                $"The next backup would take the bucket to {gb(projected)} GB of the {gb(allowance)} GB free allowance (more than {options.WarnPercent}%).");
        }

        return new StorageUsage(used, allowance, percent, projected, "ok",
            $"{gb(used)} GB of the {gb(allowance)} GB free allowance in {stored.Count} archive(s).");
    }
}
