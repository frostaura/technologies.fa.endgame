using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Hooks;

/// <summary>Runs before and after a tool (the build plan's part 11). A hook may block a call with a message that says how to proceed.</summary>
public interface IToolHook
{
    /// <summary>A message to send back instead of running the call, or null to let it run.</summary>
    Task<string?> BeforeAsync(ToolCall call, CancellationToken cancellationToken);

    /// <summary>The outcome the model sees, possibly with something added.</summary>
    Task<ToolOutcome> AfterAsync(ToolCall call, ToolOutcome outcome, CancellationToken cancellationToken);
}

/// <summary>Runs when the agent stops calling tools. A nudge sends it back to work once more.</summary>
public interface IStopHook
{
    string Name { get; }

    /// <summary>The most times this hook may send the agent back in one session.</summary>
    int MaxRuns { get; }

    /// <summary>A message for the agent, or null when it may stop.</summary>
    Task<string?> OnStopAsync(AgentState state, IWorkspace workspace, CancellationToken cancellationToken);
}

/// <summary>ARCH-006's stop hook: if the agent stops having edited since its last build or test, remind it once to verify.</summary>
public sealed class VerifyAfterEditStopHook : IStopHook
{
    public string Name => "verify-after-edit";

    public int MaxRuns => 1;

    public Task<string?> OnStopAsync(AgentState state, IWorkspace workspace, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(state);
        return Task.FromResult(state.EditedSinceVerify
            ? "Stop hook: you changed files after your last build or test run. Run the relevant build and tests now, fix anything that fails, then finish with your summary."
            : null);
    }
}

/// <summary>
/// A format, lint or test gate run when the agent stops after editing. On failure it sends the agent
/// back with the command's output and a sentence that says how to fix the fault.
/// </summary>
public sealed class CheckCommandStopHook(string name, string command, string howToFix, int maxRuns = 2, int timeoutSeconds = 600) : IStopHook
{
    public string Name { get; } = name;

    public int MaxRuns { get; } = maxRuns;

    public async Task<string?> OnStopAsync(AgentState state, IWorkspace workspace, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(workspace);
        if (!state.EverEdited)
        {
            return null;
        }

        var result = await workspace.ExecAsync(new WorkspaceCommand(null, "exec 2>&1; " + command, timeoutSeconds, 256 * 1024), cancellationToken);
        if (result.ExitCode == 0 && !result.TimedOut)
        {
            return null;
        }

        var output = OutputText.Truncate(OutputText.StripAnsi(result.Combined), 6000);
        return $"Stop hook '{Name}': `{command}` {(result.TimedOut ? "timed out" : $"failed with exit code {result.ExitCode}")}. {howToFix}\n\n{output}";
    }
}

/// <summary>Blocks tool calls whose target matches a rule, with a message naming the fix — for house rules that are not permissions.</summary>
public sealed class HouseRuleHook(Func<ToolCall, string?> check) : IToolHook
{
    public Task<string?> BeforeAsync(ToolCall call, CancellationToken cancellationToken) => Task.FromResult(check(call));

    public Task<ToolOutcome> AfterAsync(ToolCall call, ToolOutcome outcome, CancellationToken cancellationToken) => Task.FromResult(outcome);
}
