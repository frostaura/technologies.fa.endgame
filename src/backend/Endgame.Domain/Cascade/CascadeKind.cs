namespace Endgame.Domain.Cascade;

/// <summary>What the cascade carries (ARCH-004). Each is resolved by the same walk down the tree.</summary>
public enum CascadeKind
{
    Permission,
    Secret,
    Budget,
    RuleSet,
    Context,
    Setting,
}

public static class CascadeKinds
{
    public static readonly IReadOnlyList<string> All = ["permission", "secret", "budget", "rule_set", "context", "setting"];

    public static string ToWire(this CascadeKind kind) => kind switch
    {
        CascadeKind.Permission => "permission",
        CascadeKind.Secret => "secret",
        CascadeKind.Budget => "budget",
        CascadeKind.RuleSet => "rule_set",
        CascadeKind.Context => "context",
        CascadeKind.Setting => "setting",
        _ => throw new DomainException($"Unknown cascade kind {kind}."),
    };

    public static CascadeKind FromWire(string? value) => value switch
    {
        "permission" => CascadeKind.Permission,
        "secret" => CascadeKind.Secret,
        "budget" => CascadeKind.Budget,
        "rule_set" => CascadeKind.RuleSet,
        "context" => CascadeKind.Context,
        "setting" => CascadeKind.Setting,
        _ => throw new DomainException($"'{value}' is not a cascade kind: use {string.Join(", ", All)}."),
    };

    /// <summary>
    /// Entry keys: lower-case words joined by dots, hyphens or underscores, at most 200 characters
    /// (for example <c>monthly_credits</c>, <c>sleep.mode</c>, <c>build.stage-rules</c>).
    /// </summary>
    public static string RequireKey(string? key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200 || !key.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-' or '_'))
        {
            throw new DomainException($"'{key}' is not a cascade key: use 1-200 lower-case letters, digits, dots, hyphens and underscores.");
        }

        return key;
    }
}

/// <summary>Well-known keys the control plane itself reads.</summary>
public static class CascadeKeys
{
    /// <summary>Budget: the most credits that may be spent at this node in one calendar month (UTC).</summary>
    public const string MonthlyCredits = "monthly_credits";

    /// <summary>Setting: how far below zero the organisation's balance may run. The tightest level wins.</summary>
    public const string OverdraftLimit = "overdraft_limit";

    /// <summary>Setting: <c>auto</c> (sleep when idle) or <c>always_on</c>.</summary>
    public const string SleepMode = "sleep.mode";

    /// <summary>Setting: minutes idle before an app sleeps.</summary>
    public const string SleepIdleMinutes = "sleep.idle_minutes";
}
