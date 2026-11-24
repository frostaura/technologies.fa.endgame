using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Tools;

/// <summary>
/// <c>run</c>: a bash command in the workspace container. Bounded by the container, not by path
/// (ARCH-006): nothing else is mounted writable. Output keeps its head and tail, colour off.
/// </summary>
public sealed class RunTool : ITool
{
    public const int MaxOutput = 12_000;
    public const int DefaultTimeout = 180;
    public const int MaxTimeout = 600;

    public string Name => "run";

    public string Description => "Run a bash command from the repository root and get its exit code and output. Use it to build, test, run migrations and inspect git. There is no network beyond the package registries, and nothing can be installed system-wide.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["command"] = Schema.Str("The bash command."),
        ["timeout_seconds"] = Schema.Int($"Timeout in seconds (default {DefaultTimeout}, at most {MaxTimeout})."),
    }, "command");

    public ToolEffect Effect => ToolEffect.Executes;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        var command = Json.Str(arguments, "command");
        return string.IsNullOrWhiteSpace(command) ? (ToolTargets.None, "run needs a command.") : (new ToolTargets([], command.Trim()), null);
    }

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var command = Json.Str(call.Arguments, "command")!;
        var timeout = Math.Clamp(Json.Int(call.Arguments, "timeout_seconds") ?? DefaultTimeout, 1, MaxTimeout);
        var result = await call.Context.Workspace.ExecAsync(new WorkspaceCommand(null, "exec 2>&1; " + command, timeout, 256 * 1024), cancellationToken);
        var head = result.TimedOut ? $"[timed out after {timeout}s]\n" : $"[exit code {result.ExitCode}]\n";
        return new ToolOutcome(head + OutputText.Truncate(OutputText.StripAnsi(result.Combined), MaxOutput));
    }
}

/// <summary><c>git_diff</c>: what the run has changed since its baseline, read-only.</summary>
public sealed class GitDiffTool : ITool
{
    public string Name => "git_diff";

    public string Description => "Show what has changed in the repository since the last commit: a summary of changed files, then the diff (new files included). Pass stat_only for the summary alone.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["path"] = Schema.Str("Limit the diff to this file or directory."),
        ["stat_only"] = Schema.Bool("Only the list of changed files and line counts."),
    });

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        var raw = Json.Str(arguments, "path");
        if (string.IsNullOrWhiteSpace(raw))
        {
            return (ToolTargets.None, null);
        }

        var (path, error) = WorkspacePath.Resolve(raw, root, allowRoot: true);
        return path is null ? (ToolTargets.None, error) : (new ToolTargets([path], null), null);
    }

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var root = call.Context.Workspace.Root;
        var scope = Json.Str(call.Arguments, "path") is { Length: > 0 } p ? WorkspacePath.Resolve(p, root, true).Path?.Relative ?? "." : ".";
        var statOnly = Json.Bool(call.Arguments, "stat_only") ?? false;
        // Intent-to-add makes new files show in the diff without staging their content.
        var script = $"git -c core.quotepath=off add -N -- {Quote(scope)} >/dev/null 2>&1; git --no-pager -c color.ui=never diff --stat -- {Quote(scope)}"
            + (statOnly ? "" : $"; echo; git --no-pager -c color.ui=never diff -- {Quote(scope)}");
        var result = await call.Context.Workspace.ExecAsync(new WorkspaceCommand(null, script, 60, 256 * 1024), cancellationToken);
        if (result.ExitCode != 0)
        {
            return ToolOutcome.Error($"git diff failed: {OutputText.Truncate(result.Combined, 800)}", "tool_error");
        }

        var output = result.Stdout.Trim();
        return new ToolOutcome(output.Length == 0 ? "No changes since the last commit." : OutputText.Truncate(output, RunTool.MaxOutput));
    }

    internal static string Quote(string value) => "'" + value.Replace("'", "'\\''", StringComparison.Ordinal) + "'";
}

/// <summary><c>commit</c>: commits the workspace to the app's repository, with the employee as author.</summary>
public sealed class CommitTool : ITool
{
    public string Name => "commit";

    public string Description => "Commit every change in the workspace with a message saying what was done and why. One finished feature per commit.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["message"] = Schema.Str("The commit message: a short summary line, then why, if it is not obvious."),
    }, "message");

    public ToolEffect Effect => ToolEffect.External;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        string.IsNullOrWhiteSpace(Json.Str(arguments, "message")) ? (ToolTargets.None, "commit needs a message.") : (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var message = Json.Str(call.Arguments, "message")!.Trim();
        try
        {
            var commit = await call.Context.Workspace.CommitAsync(message, call.Context.Agent.AuthorName, call.Context.Agent.AuthorEmail, cancellationToken);
            call.Context.State.Commits.Add(commit.CommitId);
            return new ToolOutcome(commit.Changed
                ? string.Create(CultureInfo.InvariantCulture, $"Committed {commit.CommitId[..Math.Min(12, commit.CommitId.Length)]}.")
                : "Nothing to commit: the workspace has no changes since the last commit.");
        }
        catch (WorkspaceException e)
        {
            return ToolOutcome.Error($"The commit failed: {e.Message}", "tool_error");
        }
    }
}
