namespace Endgame.Domain.Credits;

/// <summary>
/// The four entries of the one append-only ledger (ARCH-004). Balance and spend are derived from them;
/// nothing else records spend.
/// </summary>
public static class CreditEntryKinds
{
    public const string TopUp = "top_up";
    public const string Reservation = "reservation";
    public const string Settlement = "settlement";
    public const string Release = "release";

    public static readonly IReadOnlyList<string> All = [TopUp, Reservation, Settlement, Release];
}
