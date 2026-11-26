using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Kernel;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// A <c>task</c> run on an app. A <b>change</b> a person asked for (the owner message's <c>kind</c> is <c>change</c>) goes
/// through the factory's own stages — <see cref="BuildWorkflow.ChangeAsync"/>: plan, build, evaluate, check what worked
/// before, security review, republish. Any other task is one employee's piece of work in that app's workspace, by one
/// builder agent on the cheapest building tier, committed but not published. Resumed from its log after a crash or a pause.
/// </summary>
public sealed class TaskWorkflow(BuildWorkflow? factory = null) : IWorkflow
{
    public const string ChangeKind = "change";

    public string Kind => RunKinds.Task;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        if (Json.Str(run.OwnerMessage(), "kind") == ChangeKind)
        {
            return factory is null
                ? WorkflowOutcome.Failure("This Runner cannot make changes to apps: it has no factory.")
                : await factory.ChangeAsync(run, cancellationToken);
        }

        if (run.LevelId("app") is not { } appId)
        {
            return WorkflowOutcome.Failure("A task run works on an app, and this one's scope names none.");
        }

        var request = Json.Str(run.OwnerMessage(), "text") ?? run.Run.Title;
        var (workspace, recreated) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), run.StartFrom(), cancellationToken);
        var agent = run.Agents.Builder(run, "builder", run.Options.BuildTiers[0], repair: false, workspace.Root,
            RunnerResources.Prompt("task", new Dictionary<string, string> { ["root"] = workspace.Root, ["skills"] = Endgame.Harness.Skills.SkillLibrary.Index(run.Skills, AgentFactory.BuilderSkills) }));
        var loop = new AgentLoop(agent, run.Services(), workspace, run.Sink);
        var task = recreated && run.History.Count > 0
            ? $"{request}\n\n(The workspace was recreated from the last commit when this run resumed; uncommitted changes from before were lost.)"
            : request;
        var result = await loop.ResumeAsync(run.History, task, cancellationToken);
        return WorkflowOutcome.FromAgent(result)
            ?? (result.Completed
                ? WorkflowOutcome.Success(result.FinalText ?? "Done.")
                : WorkflowOutcome.Failure($"The work stopped ({result.StopReason}): {result.FinalText}"));
    }
}
