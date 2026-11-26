namespace Endgame.Domain.Cascade;

/// <summary>
/// A setting change in the owner's words (D45): what approving it does, and what is true once it is done — the words the
/// autonomy and app screens use, never the key. One place, so the Runner's approval titles and the control plane's
/// reading of older approvals (R2-5) say the same.
/// </summary>
public static class SettingWords
{
    /// <summary>What approving does, and what is true once it is done; null for a key or value it cannot say.</summary>
    /// <param name="place">The place's name ("Community", or "here").</param>
    /// <param name="apps">How the apps there are spoken of ("apps in Community", "the Club Reading List app").</param>
    public static (string Title, string Done)? Describe(string? key, string? value, string place, string apps)
    {
        ArgumentNullException.ThrowIfNull(place);
        ArgumentNullException.ThrowIfNull(apps);
        var raw = (value ?? "").Trim().Trim('"').Trim().ToLowerInvariant();
        bool? on = raw switch { "true" or "on" or "yes" => true, "false" or "off" or "no" => false, _ => null };
        var Apps = char.ToUpperInvariant(apps[0]) + apps[1..];
        var number = int.TryParse(raw, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var n) && n > 0 ? n : (int?)null;
        string Checkpoint(string label) => on is true ? $"Turn on the “{label}” checkpoint in {place}" : $"Turn off the “{label}” checkpoint in {place}";
        string CheckpointDone(string label) => on is true ? $"The “{label}” checkpoint is now on in {place}." : $"The “{label}” checkpoint is now off in {place}.";
        return key switch
        {
            Autonomy.Key when raw == "checkpoints" => ($"Stop for your sign-off at checkpoints in {place}", $"{place} now stops for your sign-off at the checkpoints that are on."),
            Autonomy.Key when raw == "auto" => ($"Switch {place} to auto-mode", $"{place} now works in auto-mode."),
            Autonomy.CheckpointStart when on is not null => (Checkpoint("Before work starts"), CheckpointDone("Before work starts")),
            Autonomy.CheckpointPlan when on is not null => (Checkpoint("Before the plan is carried out"), CheckpointDone("Before the plan is carried out")),
            Autonomy.CheckpointHire when on is not null => (Checkpoint("Before anyone is hired"), CheckpointDone("Before anyone is hired")),
            CascadeKeys.SleepMode when raw == "always_on" => ($"Keep {apps} always on", $"{Apps} now stay on, even when nobody is using them."),
            CascadeKeys.SleepMode when raw == "auto" => ($"Let {apps} sleep when nobody is using them", $"{Apps} now sleep when nobody is using them."),
            CascadeKeys.SleepIdleMinutes when number is { } minutes => ($"Let {apps} sleep after {Count(minutes, "idle minute")}", $"{Apps} now sleep after {Count(minutes, "idle minute")}."),
            AgentSettings.WorkforceIdleDays when number is { } days => ($"Flag employees in {place} who have had no work for {Count(days, "day")}", $"Employees in {place} who have had no work for {Count(days, "day")} are now flagged."),
            _ => null,
        };

        static string Count(int n, string one) => n == 1 ? $"1 {one}" : string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{n} {one}s");
    }
}
