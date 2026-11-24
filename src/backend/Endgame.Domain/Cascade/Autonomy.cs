using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Endgame.Domain.Cascade;

/// <summary>
/// Autonomy (spec, <i>the factory</i>): auto-mode by default, checkpoints by opt-in, and a rule set
/// per stage. All of it is cascade settings and rule sets, resolved like everything else.
/// </summary>
public static partial class Autonomy
{
    public const string Auto = "auto";
    public const string Checkpoints = "checkpoints";

    public static readonly IReadOnlyList<string> Modes = [Auto, Checkpoints];

    /// <summary>Setting: <c>auto</c> or <c>checkpoints</c>. Unset means auto.</summary>
    public const string Key = "autonomy";

    /// <summary>Settings (true or false), read only when autonomy is <c>checkpoints</c>: where the owner signs off.</summary>
    public const string CheckpointStart = "checkpoint.start";
    public const string CheckpointPlan = "checkpoint.plan";
    public const string CheckpointHire = "checkpoint.hire";

    public static readonly IReadOnlyList<string> CheckpointKeys = [CheckpointStart, CheckpointPlan, CheckpointHire];

    /// <summary>The stages a rule set may be keyed by (the harness's permission stages), or <c>all</c>.</summary>
    public static readonly IReadOnlyList<string> Stages = ["all", "research", "plan", "build", "evaluate", "review", "conversation"];

    public static readonly IReadOnlyList<string> RuleLists = ["deny", "ask", "allow", "checkpoints"];

    /// <summary>The effective mode from a setting's value: anything but <c>checkpoints</c> is auto.</summary>
    public static string ModeOf(JsonNode? value) =>
        value is JsonValue v && v.GetValueKind() == JsonValueKind.String && v.GetValue<string>() == Checkpoints ? Checkpoints : Auto;

    /// <summary>
    /// Faults in a rule set's value: an object of up to four lists (<c>deny</c>, <c>ask</c>, <c>allow</c>,
    /// <c>checkpoints</c>), each rule written <c>tool</c> or <c>tool(pattern)</c>, as the harness parses them.
    /// </summary>
    public static IReadOnlyList<string> RuleSetFaults(string stage, JsonNode? value)
    {
        var faults = new List<string>();
        if (!Stages.Contains(stage))
        {
            faults.Add($"'{stage}' is not a stage: a rule set is keyed by {string.Join(", ", Stages)}.");
        }

        if (value is not JsonObject o)
        {
            faults.Add("A rule set is an object of lists: deny, ask, allow, checkpoints.");
            return faults;
        }

        foreach (var (key, list) in o)
        {
            if (!RuleLists.Contains(key))
            {
                faults.Add($"'{key}' is not part of a rule set: use {string.Join(", ", RuleLists)}.");
                continue;
            }

            if (list is not JsonArray items)
            {
                faults.Add($"'{key}' is a list of rules.");
                continue;
            }

            foreach (var item in items)
            {
                var text = item is JsonValue t && t.GetValueKind() == JsonValueKind.String ? t.GetValue<string>().Trim() : null;
                if (text is null || text.Length is 0 or > 300 || !RuleShape().IsMatch(text))
                {
                    faults.Add($"'{item?.ToJsonString()}' in {key} is not a rule: write a tool name or tool(pattern), for example edit_file or run(git push*).");
                }
            }
        }

        return faults;
    }

    [GeneratedRegex(@"^(\*|[a-z][a-z0-9_]*)(\((.+)\))?$", RegexOptions.CultureInvariant)]
    private static partial Regex RuleShape();
}

/// <summary>
/// The settings an agent may change on the owner's behalf (the conversation's <c>adjust_setting</c>,
/// confirmed by the owner first). Anything else — above all who may open an app — is a person's act.
/// </summary>
public static class AgentSettings
{
    public const string WorkforceIdleDays = "workforce.idle_days";

    public static readonly IReadOnlyList<string> Allowed =
    [
        Autonomy.Key, Autonomy.CheckpointStart, Autonomy.CheckpointPlan, Autonomy.CheckpointHire,
        CascadeKeys.SleepMode, CascadeKeys.SleepIdleMinutes, WorkforceIdleDays,
    ];
}
