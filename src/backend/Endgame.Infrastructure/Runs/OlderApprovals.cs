using System.Text.RegularExpressions;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Tree;

namespace Endgame.Infrastructure.Runs;

/// <summary>
/// Approvals raised before the plain-detail fix (D71) kept the permission check's tool line as their detail
/// ("adjust_setting: hire_checkpoint=false. No rule allows adjust_setting here. Checkpoint: adjust_setting.") and a
/// setting change the generic title "Change a setting here?". On read (R2-5) such a row is said as a new one would be:
/// the tool line becomes its technical detail, the detail the plain sentence, and a setting change's title what
/// approving it does, in the same words the Runner now uses (<see cref="SettingWords"/>, <see cref="ApprovalWords"/>).
/// </summary>
public static partial class OlderApprovals
{
    /// <summary>The title a setting change was given before it could be named.</summary>
    public const string GenericSettingTitle = "Change a setting here?";

    public static (string Title, string Detail, string? Technical) Plain(string title, string detail, string? technical, ResolvedScope? scope)
    {
        if (technical is not null || ToolLine().Match(detail ?? "") is not { Success: true } line)
        {
            return (title, detail ?? "", technical);
        }

        var plain = detail!.Contains("Your rules", StringComparison.Ordinal) || detail.Contains("cascade:", StringComparison.Ordinal) ? ApprovalWords.ByRule : ApprovalWords.ByDefault;
        var named = title;
        if (title == GenericSettingTitle && line.Groups[1].Value == "adjust_setting" && Setting().Match(line.Groups[2].Value) is { Success: true } setting)
        {
            var place = scope?.Node.Name is { Length: > 0 } name ? name : "here";
            var apps = scope?.Level == NodeLevel.App ? $"the {place} app" : scope is null ? "the apps here" : $"apps in {place}";
            if (SettingWords.Describe(setting.Groups[1].Value, setting.Groups[2].Value, place, apps) is { } described)
            {
                named = (scope is null ? described.Title.Replace(" in here", " here", StringComparison.Ordinal) : described.Title) + "?";
            }
        }

        return (named, plain, detail);
    }

    [GeneratedRegex(@"^([a-z_]+): (.*)$", RegexOptions.Singleline)]
    private static partial Regex ToolLine();

    [GeneratedRegex(@"^([a-z_.]+)=([^.\s]+)")]
    private static partial Regex Setting();
}
