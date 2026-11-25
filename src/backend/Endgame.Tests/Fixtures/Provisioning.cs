namespace Endgame.Tests.Fixtures;

/// <summary>
/// What an operator's provisioning sends besides the name: what the organisation does, screened
/// against the red lines (OP-03). No model answers in most tests, so the operator's own screening
/// decision is sent too; it is used only when no model can be reached.
/// </summary>
public static class Provisioning
{
    public const string Description = "Builds and runs software products for its own customers.";

    public static readonly object Manual = new { decision = "clear", reason = "Screened by hand in a test: an ordinary software business." };
}
