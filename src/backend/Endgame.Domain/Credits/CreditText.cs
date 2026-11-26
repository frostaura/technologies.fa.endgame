using System.Globalization;

namespace Endgame.Domain.Credits;

/// <summary>
/// A credit amount as a sentence shows it: at most two decimals with trailing zeros trimmed ("277.32", "12", "0.5"),
/// and an amount too small for that as "less than 0.01" rather than a misleading "0" (D44). Machine fields keep the
/// exact value; only words a person reads go through here.
/// </summary>
public static class CreditText
{
    public static string Format(decimal credits)
    {
        var rounded = decimal.Round(credits, 2, MidpointRounding.AwayFromZero);
        if (rounded == 0 && credits != 0)
        {
            return credits > 0 ? "less than 0.01" : "less than -0.01";
        }

        return rounded.ToString("#,0.##", CultureInfo.InvariantCulture);
    }
}
