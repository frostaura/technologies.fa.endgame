using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness;
using Endgame.Harness.Workspaces;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>Helpers every factory stage shares: running an agent resumably, and reading its JSON answer.</summary>
public static partial class WorkflowSupport
{
    /// <summary>
    /// Runs one agent of the run: resumed from the log if it had started, returned at once if it had
    /// already stopped. Agent ids are unique per stage, item and round, so replay finds each again.
    /// </summary>
    public static Task<AgentResult> RunAgentAsync(RunContext run, AgentDefinition agent, IWorkspace workspace, string task, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        var loop = new AgentLoop(agent, run.Services(), workspace, run.Sink);
        return loop.ResumeAsync(run.History, task, cancellationToken);
    }

    /// <summary>
    /// The JSON object an agent was told to reply with: a fenced block, or the outermost braces. Null
    /// when there is none — the workflow then decides, never a guess.
    /// </summary>
    public static JsonObject? JsonAnswer(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var fenced = Fenced().Match(text);
        var candidate = fenced.Success ? fenced.Groups[1].Value : text;
        var start = candidate.IndexOf('{', StringComparison.Ordinal);
        var end = candidate.LastIndexOf('}');
        if (start < 0 || end <= start)
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(candidate[start..(end + 1)]) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A workflow's closing summary as the owner reads it: one plain paragraph, at most 600 characters.</summary>
    public static string ForPeople(string summary) => Sentences.Plain(summary, 600);

    /// <summary>A slug the tree accepts: lowercase letters, digits and hyphens, 2 to 40 characters.</summary>
    public static string Slug(string? text, string fallback)
    {
        var slug = NotSlug().Replace((text ?? "").ToLowerInvariant().Trim(), "-").Trim('-');
        slug = Hyphens().Replace(slug, "-");
        if (slug.Length > 40)
        {
            slug = slug[..40].TrimEnd('-');
        }

        return slug.Length >= 2 ? slug : fallback;
    }

    [GeneratedRegex(@"```(?:json)?\s*(\{.*?\})\s*```", RegexOptions.Singleline)]
    private static partial Regex Fenced();

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NotSlug();

    [GeneratedRegex("-{2,}")]
    private static partial Regex Hyphens();
}
