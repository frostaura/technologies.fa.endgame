namespace Endgame.Domain.Credits;

/// <summary>
/// The entries of the one append-only ledger (ARCH-004). Balance and spend are derived from them;
/// nothing else records spend. AI work is reserved, then settled or released; hosting is metered
/// after the fact, one entry per usage sample Dock reports (spec: credits meter AI and hosting both).
/// </summary>
public static class CreditEntryKinds
{
    public const string TopUp = "top_up";
    public const string Reservation = "reservation";
    public const string Settlement = "settlement";
    public const string Release = "release";
    public const string Hosting = "hosting";

    public static readonly IReadOnlyList<string> All = [TopUp, Reservation, Settlement, Release, Hosting];

    /// <summary>The kinds that are spend: they lower the balance and count against every budget.</summary>
    public static readonly IReadOnlyList<string> Spend = [Settlement, Hosting];
}
