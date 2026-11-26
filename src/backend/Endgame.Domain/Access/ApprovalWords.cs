namespace Endgame.Domain.Access;

/// <summary>The plain sentence under an approval's title (D71): why it is asked, never the tool line.</summary>
public static class ApprovalWords
{
    /// <summary>Asked because the owner's own rules for the stage ask for sign-off.</summary>
    public const string ByRule = "Your rules for this stage ask for your sign-off before this is done. If you decline, it is not done and the work carries on without it.";

    /// <summary>Asked because nothing allows it without one.</summary>
    public const string ByDefault = "This waits for your sign-off before it is done. If you decline, it is not done and nothing changes.";
}
