using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// A conversation turn: the owner's message, answered in the scope they selected by an assistant
/// with read tools over the tree, tasks, runs and credits. It may start an idea or change a setting
/// only through the permissioned tools, each of which asks the owner first. The answer is a
/// <c>message</c> on the run, which the console streams.
/// </summary>
public sealed class ConversationWorkflow : IWorkflow
{
    public const int TurnsRemembered = 6;

    public string Kind => RunKinds.Conversation;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        var question = Json.Str(run.OwnerMessage(), "text") ?? run.Run.Title;
        var earlier = await EarlierTurnsAsync(run, cancellationToken);
        ITool[] tools =
        [
            new ReadOrganisationTool(run.ControlPlane, run.Run.Scope),
            new StartIdeaTool(run.ControlPlane, run.Run.Scope),
            new AdjustSettingTool(run.ControlPlane, run.Run.Scope),
        ];
        var task = earlier.Length == 0 ? question : $"Earlier in this conversation:\n{earlier}\nThe owner now says:\n{question}";
        var result = await WorkflowSupport.RunAgentAsync(run, run.Agents.Conversation(run, tools), NoWorkspace.Instance, task, cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is { } stopped)
        {
            return stopped;
        }

        var answer = result.Completed ? result.FinalText ?? "" : "I could not finish answering that. Please ask again.";
        if (!run.Journal.Done("answered"))
        {
            await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "assistant", ["text"] = answer }, cancellationToken);
            await run.Journal.RecordAsync("answered", new JsonObject(), cancellationToken);
        }

        return result.Completed ? WorkflowOutcome.Success(OutputText.Truncate(answer, 500)) : WorkflowOutcome.Failure(answer);
    }

    /// <summary>The previous turns, followed back through each run's parent; every read has a limit.</summary>
    private static async Task<string> EarlierTurnsAsync(RunContext run, CancellationToken cancellationToken)
    {
        var turns = new List<string>();
        var parent = run.Run.ParentRunId;
        while (parent is { } id && turns.Count < TurnsRemembered)
        {
            var events = await run.ControlPlane.ReadEventsAsync(id, 0, 500, cancellationToken);
            var asked = events.FirstOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "from") == "owner");
            var said = events.LastOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "from") == "assistant");
            turns.Add($"Owner: {Json.Str(asked?.Payload, "text")}\nYou: {Json.Str(said?.Payload, "text") ?? "(no answer)"}");
            parent = (await run.ControlPlane.GetRunAsync(id, cancellationToken)).ParentRunId;
        }

        turns.Reverse();
        var sb = new StringBuilder();
        foreach (var turn in turns)
        {
            sb.Append(OutputText.Truncate(turn, 3000)).Append('\n');
        }

        return sb.ToString();
    }
}

/// <summary>A <c>review</c> run: the security reviewer on one app, on its own, reporting its findings.</summary>
public sealed class ReviewWorkflow : IWorkflow
{
    public string Kind => RunKinds.Review;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        if (run.LevelId("app") is not { } appId)
        {
            return WorkflowOutcome.Failure("A review is of an app, and this run's scope names none.");
        }

        var (workspace, _) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), cancellationToken);
        var result = await WorkflowSupport.RunAgentAsync(run, run.Agents.SecurityReviewer(run, workspace.Root), workspace,
            "Review the app now against your checklist, then reply with the JSON object.", cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is { } stopped)
        {
            return stopped;
        }

        var report = WorkflowSupport.JsonAnswer(result.FinalText);
        if (report is null)
        {
            return WorkflowOutcome.Failure("The review gave no report, so the app is not cleared.");
        }

        var findings = report["findings"] as JsonArray ?? [];
        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "security-reviewer", ["kind"] = "security.review", ["passed"] = findings.Count == 0, ["findings"] = findings.DeepClone() }, cancellationToken);
        return findings.Count == 0
            ? WorkflowOutcome.Success("The security review found nothing that blocks publishing.")
            : WorkflowOutcome.Failure($"The security review found {findings.Count} problem{(findings.Count == 1 ? "" : "s")} that block publishing.");
    }
}
