using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Permissions;

/// <summary>The run's mode. Plan mode explores read-only and must end in a plan (ARCH-006, the build plan's part 4).</summary>
public enum AgentMode
{
    Build,
    Plan,
}

public enum PermissionVerdict
{
    Allow,
    Deny,

    /// <summary>Would have asked a person; resolved by a checkpoint approval or denied unattended.</summary>
    Ask,
}

/// <summary>What a permission check decided and the rule that decided it — every decision is an event naming it.</summary>
public sealed record PermissionDecision(PermissionVerdict Verdict, string Rule, string Reason)
{
    /// <summary>For an ask: whether a checkpoint is configured here, so the run raises an approval instead of being denied.</summary>
    public string? Checkpoint { get; init; }
}

/// <summary>
/// One rule: a tool name (or <c>*</c>) and an optional pattern in brackets, matched against each
/// path the call touches (a glob) or the command it runs (where <c>*</c> matches anything).
/// Written <c>edit_file</c>, <c>write_file(api/Migrations/**)</c>, <c>run(git push*)</c>, <c>*(.env*)</c>.
/// </summary>
public sealed partial record PermissionRule(string Text, string Tool, string? Pattern)
{
    public static PermissionRule Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var match = RuleShape().Match(text.Trim());
        return match.Success
            ? new PermissionRule(text.Trim(), match.Groups["tool"].Value, match.Groups["pattern"].Success ? match.Groups["pattern"].Value : null)
            : throw new FormatException($"'{text}' is not a permission rule: write tool or tool(pattern).");
    }

    public bool Matches(string tool, ToolTargets targets)
    {
        ArgumentNullException.ThrowIfNull(targets);
        if (Tool != "*" && !string.Equals(Tool, tool, StringComparison.Ordinal))
        {
            return false;
        }

        if (Pattern is null)
        {
            return true;
        }

        if (targets.Command is { } command && CommandMatches(Pattern, command))
        {
            return true;
        }

        return targets.Paths.Any(p => Glob.IsMatch(Pattern, p.Relative) || Glob.IsMatch(Pattern, p.Absolute));
    }

    private static bool CommandMatches(string pattern, string command) =>
        Regex.IsMatch(command.Trim(), "^" + Regex.Escape(pattern).Replace("\\*", ".*", StringComparison.Ordinal) + "$", RegexOptions.Singleline | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));

    [GeneratedRegex(@"^(?<tool>\*|[a-z][a-z0-9_]*)(?:\((?<pattern>.+)\))?$", RegexOptions.CultureInvariant)]
    private static partial Regex RuleShape();
}

/// <summary>
/// A rule set from the cascade (<c>GET /internal/context</c>, kind <c>rule-set</c>). Its value is
/// <c>{ "deny": [...], "ask": [...], "allow": [...], "checkpoints": [...] }</c>; it applies to a run
/// when its key is the run's stage or <c>all</c>.
/// </summary>
public sealed record CascadeRuleSet(string Key, string SetAt, IReadOnlyList<PermissionRule> Deny, IReadOnlyList<PermissionRule> Ask, IReadOnlyList<PermissionRule> Allow, IReadOnlyList<PermissionRule> Checkpoints)
{
    public static CascadeRuleSet FromJson(string key, string setAt, JsonNode? value)
    {
        var o = value as JsonObject;
        return new CascadeRuleSet(key, setAt, Rules(o, "deny"), Rules(o, "ask"), Rules(o, "allow"), Rules(o, "checkpoints"));

        static IReadOnlyList<PermissionRule> Rules(JsonObject? o, string field)
        {
            var list = new List<PermissionRule>();
            foreach (var text in Json.Strings(o, field))
            {
                try
                {
                    list.Add(PermissionRule.Parse(text));
                }
                catch (FormatException)
                {
                    // A malformed rule must never widen access: an unreadable deny denies everything.
                    if (field == "deny")
                    {
                        list.Add(new PermissionRule(text, "*", null));
                    }
                }
            }

            return list;
        }
    }

    public bool AppliesTo(string stage) => Key is "all" || string.Equals(Key, stage, StringComparison.Ordinal);
}

/// <summary>
/// The check before EVERY tool call (CLAUDE.md rule 7, the build plan's part 3). In order: the
/// protected-path floor, which nothing overrides; the run's deny rules; the cascade's rule sets; the
/// run's mode; the allow rules; then the default — reads are allowed, anything else would ask, and
/// unattended an ask is denied unless a checkpoint is configured there.
/// </summary>
public sealed class PermissionPolicy
{
    /// <summary>Paths inside a repository's git directory: never touched by file tools.</summary>
    public const string GitFloor = "floor:.git";

    public string Stage { get; init; } = "build";

    public AgentMode Mode { get; init; } = AgentMode.Build;

    /// <summary>Writes refused whatever any rule says, as globs relative to the workspace root.</summary>
    public IReadOnlyList<string> ProtectedPaths { get; init; } = [];

    public IReadOnlyList<PermissionRule> Deny { get; init; } = [];

    public IReadOnlyList<PermissionRule> Allow { get; init; } = [];

    /// <summary>Where an ask raises an approval instead of being denied.</summary>
    public IReadOnlyList<PermissionRule> Checkpoints { get; init; } = [];

    public IReadOnlyList<CascadeRuleSet> Cascade { get; init; } = [];

    /// <summary>No person watching: anything that would ask is denied unless a checkpoint is set there.</summary>
    public bool Unattended { get; init; } = true;

    /// <summary>The run must propose a plan before any write or command (plan as contract).</summary>
    public bool RequirePlan { get; init; }

    public PermissionPolicy WithMode(AgentMode mode) => Clone(mode, RequirePlan);

    public PermissionPolicy WithRequirePlan(bool requirePlan) => Clone(Mode, requirePlan);

    public PermissionDecision Decide(string tool, ToolEffect effect, ToolTargets targets, bool hasPlan)
    {
        ArgumentNullException.ThrowIfNull(targets);

        // 1. The floor. Nothing below can override it.
        if (targets.Paths.FirstOrDefault(p => p.IsInsideGit) is { } git)
        {
            return new PermissionDecision(PermissionVerdict.Deny, GitFloor, $"'{git.Relative}' is inside .git, which file tools never touch. Use git_diff to see changes and commit to record them.");
        }

        if (effect == ToolEffect.WritesFiles)
        {
            foreach (var path in targets.Paths)
            {
                if (ProtectedPaths.FirstOrDefault(g => Glob.IsMatch(g, path.Relative)) is { } glob)
                {
                    return new PermissionDecision(PermissionVerdict.Deny, $"floor:protected-path({glob})", $"'{path.Relative}' is protected ({glob}) and cannot be written by an agent.");
                }
            }
        }

        // 2. The run's own deny rules.
        if (Deny.FirstOrDefault(r => r.Matches(tool, targets)) is { } deny)
        {
            return new PermissionDecision(PermissionVerdict.Deny, $"deny:{deny.Text}", $"Denied by the rule '{deny.Text}'.");
        }

        // 3. The cascade's rule sets for this stage, nearest level first.
        var sets = Cascade.Where(s => s.AppliesTo(Stage)).ToList();
        foreach (var set in sets)
        {
            if (set.Deny.FirstOrDefault(r => r.Matches(tool, targets)) is { } cascadeDeny)
            {
                return new PermissionDecision(PermissionVerdict.Deny, $"cascade:{set.SetAt}:{set.Key}:deny:{cascadeDeny.Text}", $"Denied by the {set.Key} rule set set at {set.SetAt} ('{cascadeDeny.Text}').");
            }
        }

        foreach (var set in sets)
        {
            if (set.Ask.FirstOrDefault(r => r.Matches(tool, targets)) is { } ask)
            {
                // An "asks you first" rule is the owner saying they want to be asked: it raises an approval even when
                // nobody is watching, rather than refusing (AUTO-05). The rule itself is the checkpoint.
                return Asked($"cascade:{set.SetAt}:{set.Key}:ask:{ask.Text}", $"The {set.Key} rule set set at {set.SetAt} asks for sign-off on '{ask.Text}'.", tool, targets, sets, $"{set.SetAt}:{ask.Text}");
            }
        }

        // 4. The run's mode.
        if (effect != ToolEffect.ReadOnly && Mode == AgentMode.Plan)
        {
            return new PermissionDecision(PermissionVerdict.Deny, "mode:plan", "This run is in plan mode: explore with read-only tools, then call propose_plan. Nothing may be changed until the plan is accepted.");
        }

        if (effect != ToolEffect.ReadOnly && RequirePlan && !hasPlan)
        {
            return new PermissionDecision(PermissionVerdict.Deny, "plan:required", "Propose the plan first: call propose_plan with what you will make and how each item will be checked. Only then may files change.");
        }

        // 5. Allow rules: the run's, then the cascade's.
        if (Allow.FirstOrDefault(r => r.Matches(tool, targets)) is { } allow)
        {
            return new PermissionDecision(PermissionVerdict.Allow, $"allow:{allow.Text}", $"Allowed by the rule '{allow.Text}'.");
        }

        foreach (var set in sets)
        {
            if (set.Allow.FirstOrDefault(r => r.Matches(tool, targets)) is { } cascadeAllow)
            {
                return new PermissionDecision(PermissionVerdict.Allow, $"cascade:{set.SetAt}:{set.Key}:allow:{cascadeAllow.Text}", $"Allowed by the {set.Key} rule set set at {set.SetAt}.");
            }
        }

        // 6. Defaults.
        return effect == ToolEffect.ReadOnly
            ? new PermissionDecision(PermissionVerdict.Allow, "default:read-only", "Reading is allowed.")
            : Asked("default:ask", $"No rule allows {tool} here.", tool, targets, sets);
    }

    private PermissionDecision Asked(string rule, string reason, string tool, ToolTargets targets, IReadOnlyList<CascadeRuleSet> sets, string? askedBy = null)
    {
        var checkpoint = Checkpoints.FirstOrDefault(r => r.Matches(tool, targets))?.Text ?? askedBy;
        if (checkpoint is null)
        {
            foreach (var set in sets)
            {
                if (set.Checkpoints.FirstOrDefault(r => r.Matches(tool, targets)) is { } point)
                {
                    checkpoint = $"{set.SetAt}:{point.Text}";
                    break;
                }
            }
        }

        if (!Unattended)
        {
            return new PermissionDecision(PermissionVerdict.Ask, rule, reason) { Checkpoint = checkpoint ?? "attended" };
        }

        return checkpoint is null
            ? new PermissionDecision(PermissionVerdict.Deny, $"unattended:{rule}", $"{reason} Nobody is watching this run and no checkpoint is set here, so it is denied. Do the work another way, or finish and say what needs sign-off.")
            : new PermissionDecision(PermissionVerdict.Ask, rule, reason) { Checkpoint = checkpoint };
    }

    private PermissionPolicy Clone(AgentMode mode, bool requirePlan) => new()
    {
        Stage = Stage,
        Mode = mode,
        ProtectedPaths = ProtectedPaths,
        Deny = Deny,
        Allow = Allow,
        Checkpoints = Checkpoints,
        Cascade = Cascade,
        Unattended = Unattended,
        RequirePlan = requirePlan,
    };
}

/// <summary>Raises a checkpoint and waits for the owner's answer. Production: <c>POST /internal/approvals</c>.</summary>
public interface IApprovalGate
{
    Task<bool> RequestAsync(string title, string detail, CancellationToken cancellationToken);

    /// <summary>
    /// The same, with what a decline means (<see cref="ApprovalConsequence"/>) shown to the person, and the person's own
    /// note returned with the answer.
    /// </summary>
    async Task<ApprovalAnswer> AskAsync(string title, string detail, string onDecline, CancellationToken cancellationToken) =>
        new(await RequestAsync(title, detail, cancellationToken), null);

    /// <summary>
    /// The same, with the plain sentence the owner reads in <paramref name="detail"/> and the tool, its arguments and the
    /// rule kept apart in <paramref name="technical"/> for technical mode (D71).
    /// </summary>
    Task<ApprovalAnswer> AskAsync(string title, string detail, string onDecline, string? technical, CancellationToken cancellationToken) =>
        AskAsync(title, detail, onDecline, cancellationToken);
}

/// <summary>A person's answer to an approval, and the note they wrote with it (or null).</summary>
public sealed record ApprovalAnswer(bool Approved, string? Note);

/// <summary>What declining an approval does to the work, so the console can say it truthfully (RUN-07).</summary>
public static class ApprovalConsequence
{
    /// <summary>Declined, the step is not taken and the work carries on without it.</summary>
    public const string Continues = "continues";

    /// <summary>Declined, the work stops (the start or the plan checkpoint).</summary>
    public const string Stops = "stops";
}

/// <summary>A tool that can say, in the owner's words, what approving one call of it will do (an approval's title in normal mode).</summary>
public interface IApprovalTitle
{
    string ApprovalTitle(JsonObject arguments);
}

/// <summary>The plain sentence under an approval's title (D71): why it is asked, never the tool line.</summary>
public static class ApprovalDetail
{
    /// <summary>Why a permission check asked, in the owner's words, from the rule that asked.</summary>
    public static string For(PermissionDecision asked)
    {
        ArgumentNullException.ThrowIfNull(asked);
        return asked.Rule.StartsWith("cascade:", StringComparison.Ordinal) ? Endgame.Domain.Access.ApprovalWords.ByRule : Endgame.Domain.Access.ApprovalWords.ByDefault;
    }
}
