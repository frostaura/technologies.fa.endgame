namespace Endgame.Domain.Platform;

/// <summary>What needs a person (the owner's notification feed). Each set is also a database check constraint.</summary>
public static class NotificationKinds
{
    public const string Verdict = "verdict";
    public const string Approval = "approval";
    public const string Hire = "hire";
    public const string Budget80 = "budget.80";
    public const string BudgetCap = "budget.cap";
    public const string CreditsZero = "credits.zero";
    public const string OverdraftHalf = "overdraft.half";
    public const string OverdraftLimit = "overdraft.limit";
    public const string AppCrashed = "app.crashed";
    public const string SecurityFinding = "security.finding";
    public const string TopUpRequested = "topup.requested";

    public static readonly IReadOnlyList<string> All =
        [Verdict, Approval, Hire, Budget80, BudgetCap, CreditsZero, OverdraftHalf, OverdraftLimit, AppCrashed, SecurityFinding, TopUpRequested];

    public const string Info = "info";
    public const string Urgent = "urgent";

    public static readonly IReadOnlyList<string> Severities = [Info, Urgent];

    /// <summary>
    /// The ones that cannot wait for the next visit to the console, so they are e-mailed too: work or
    /// apps are about to stop or have stopped, an app crashed, or a security review found a problem.
    /// </summary>
    public static string SeverityOf(string kind) => kind switch
    {
        BudgetCap or CreditsZero or OverdraftHalf or OverdraftLimit or AppCrashed or SecurityFinding => Urgent,
        _ => Info,
    };
}

public static class SuggestionStatuses
{
    public const string Open = "open";
    public const string Taken = "taken";
    public const string Dismissed = "dismissed";

    public static readonly IReadOnlyList<string> All = [Open, Taken, Dismissed];

    /// <summary>The most ideas one suggestion run proposes.</summary>
    public const int MaxPerRun = 5;
}

public static class TopUpRequestStatuses
{
    public const string Open = "open";
    public const string Fulfilled = "fulfilled";
    public const string Declined = "declined";

    public static readonly IReadOnlyList<string> All = [Open, Fulfilled, Declined];
}
