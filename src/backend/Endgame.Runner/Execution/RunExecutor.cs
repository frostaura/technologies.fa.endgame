using System.Globalization;
using System.Net;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Platform;
using Endgame.Harness.Skills;
using Endgame.Runner.Platform;

namespace Endgame.Runner.Execution;

/// <summary>
/// Works one claimed run: reads its log back (a resumed run replays), holds its lease, makes and
/// gates the estimate, runs the workflow for its kind, then scores the estimate and finishes the run
/// in one append. A paused or lost run is left open, its lease released, to be resumed later.
/// </summary>
public sealed class RunExecutor(
    ControlPlaneClient controlPlane,
    IModelClient model,
    IWorkspaceProvider workspaces,
    IEnumerable<IWorkflow> workflows,
    AgentFactory agents,
    Estimator estimator,
    RunnerOptions options,
    ILogger<RunExecutor> logger,
    DockClient? dock = null,
    ISkillLibrary? skills = null,
    TimeProvider? clock = null)
{
    private readonly Dictionary<string, IWorkflow> byKind = workflows.ToDictionary(w => w.Kind, StringComparer.Ordinal);
    private readonly TimeProvider time = clock ?? TimeProvider.System;

    public IReadOnlyCollection<string> Kinds => byKind.Keys;

    /// <summary>Works the run until it finishes or is suspended. <paramref name="shutdown"/> asks it to stop at the next step boundary.</summary>
    public async Task ExecuteAsync(RunInfo run, string holder, Func<bool> shutdown, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        ArgumentNullException.ThrowIfNull(shutdown);
        var lease = TimeSpan.FromSeconds(options.LeaseSeconds);
        await using var keeper = new LeaseKeeper(controlPlane, run.Id, holder, lease, run.LeaseExpiresAt ?? time.GetUtcNow().Add(lease), time, logger);
        keeper.OnRenewed((expiry, ct) => workspaces.RenewAsync(run.Id, expiry, ct));
        keeper.Start();
        var control = new ShutdownAware(keeper, shutdown);
        var log = new ControlPlaneRunLog(controlPlane, run.Id, holder);
        WorkflowOutcome outcome;
        IReadOnlyList<RunEvent> history = [];
        try
        {
            var context = await controlPlane.ContextAsync(run.Scope, cancellationToken);
            history = await log.ReadAllAsync(cancellationToken);
            var ctx = new RunContext
            {
                Run = run,
                Holder = holder,
                ControlPlane = controlPlane,
                Sink = new FittingSink(log),
                LogReader = log,
                History = history,
                Control = control,
                Model = model,
                Workspaces = workspaces,
                Options = options,
                Agents = agents,
                Context = context,
                Dock = dock,
                Skills = skills,
                Clock = time,
                LeaseExpiry = () => keeper.ExpiresAt,
                Journal = new WorkflowJournal(history, log),
            };
            logger.LogInformation("Run {RunId} ({Kind}) taken by {Holder}; {Events} events to replay.", run.Id, run.Kind, holder, history.Count);
            outcome = await GateAsync(ctx, cancellationToken)
                ?? (byKind.TryGetValue(run.Kind, out var workflow)
                    ? await workflow.RunAsync(ctx, cancellationToken)
                    : WorkflowOutcome.Failure($"This Runner has no workflow for '{run.Kind}' runs."));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The process is going away without a graceful stop: leave the lease to lapse; another Runner resumes.
            return;
        }
        catch (ServiceProblemException e) when (e.Status == HttpStatusCode.Conflict)
        {
            // The log refused us: the run was finished by someone else, or our lease is gone.
            logger.LogWarning("Run {RunId} stopped: {Detail}", run.Id, e.Detail);
            return;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Run {RunId} failed in the Runner.", run.Id);
            outcome = WorkflowOutcome.Failure($"The work stopped on an internal fault and has been logged: {OutputText.Truncate(e.Message, 300)}")
                with
            {
                ForOwner = run.Kind is RunKinds.Build or RunKinds.Research or RunKinds.Task
                ? "The work stopped on an unexpected fault, which has been recorded. Nothing was lost; use “Try again” to carry on from where it stopped."
                : "The work stopped on an unexpected fault, which has been recorded. Nothing was lost."
            };
        }

        switch (outcome.End)
        {
            case WorkflowEnd.Suspended:
                logger.LogInformation("Run {RunId} suspended: {Why}.", run.Id, outcome.Summary);
                await keeper.ReleaseAsync();
                return;
            case WorkflowEnd.Cancelled:
                await keeper.StopAsync();
                return;
        }

        await FinishAsync(run, log, outcome, keeper, cancellationToken);
    }

    /// <summary>
    /// Before work starts: an estimate in the log (the control plane makes research's), then the
    /// gate. In auto-mode work whose estimate would break a budget does not begin: the run pauses,
    /// saying why. With a start checkpoint set, the owner approves the estimate first.
    /// </summary>
    private async Task<WorkflowOutcome?> GateAsync(RunContext ctx, CancellationToken cancellationToken)
    {
        if (ctx.Journal.Done("estimate.gate"))
        {
            return null;
        }

        var expected = Estimator.Latest(ctx.History);
        if (expected is null)
        {
            var estimate = await estimator.EstimateAsync(ctx, null, cancellationToken);
            await ctx.AppendAsync(HarnessEvents.EstimateMade, Estimator.Made(estimate, "start"), cancellationToken);
            expected = estimate.Credits;
        }

        var autonomy = Json.Str(new JsonObject { ["v"] = ctx.Setting("autonomy")?.DeepClone() }, "v") ?? "auto";
        decimal? headroom;
        try
        {
            headroom = await ctx.ControlPlane.HeadroomAsync(ctx.Run.Scope, cancellationToken);
        }
        catch (ServiceProblemException e)
        {
            logger.LogWarning("Credit headroom for {Scope} could not be read ({Detail}); the gateway's reservation still caps every call.", ctx.Run.Scope, e.Detail);
            headroom = null;
        }

        if (headroom is { } room && expected > room)
        {
            var text = string.Create(CultureInfo.InvariantCulture, $"This work is estimated at {expected} credits, more than the {room} left in its budget, so it has not started. Raise the budget or top up, then resume it.");
            if (autonomy == "auto")
            {
                await ctx.Sink.AppendAsync(
                [
                    new RunEvent(HarnessEvents.Message, new JsonObject { ["from"] = "runner", ["title"] = "Waiting for budget", ["code"] = "estimate_over_budget", ["text"] = text, ["estimate"] = expected, ["headroom"] = room }),
                    new RunEvent(RunEventTypes.RunPaused, new JsonObject { ["by"] = "runner", ["reason"] = "estimate_over_budget" }),
                ], cancellationToken);
                return WorkflowOutcome.Suspend("estimate over budget");
            }
        }

        if (autonomy == "checkpoints" && ctx.Setting("checkpoint.start")?.GetValueKind() == System.Text.Json.JsonValueKind.True)
        {
            var answer = await new ControlPlaneApprovals(ctx.ControlPlane, ctx.Run.Id).AskAsync(
                string.Create(CultureInfo.InvariantCulture, $"Start this work? Estimated {expected} credits."),
                headroom is { } h ? string.Create(CultureInfo.InvariantCulture, $"{h} credits are left in the budget.") : "The budget's headroom is not known.",
                ApprovalConsequence.Stops,
                cancellationToken);
            if (!answer.Approved)
            {
                return WorkflowOutcome.Failure("The owner declined to start this work at its estimate.")
                    with
                { ForOwner = "You declined to start this work at its estimate, so nothing was done and nothing was charged." };
            }
        }

        await ctx.Journal.RecordAsync("estimate.gate", new JsonObject { ["estimate"] = expected, ["headroom"] = headroom, ["autonomy"] = autonomy }, cancellationToken);
        return null;
    }

    private async Task FinishAsync(RunInfo run, ControlPlaneRunLog log, WorkflowOutcome outcome, LeaseKeeper keeper, CancellationToken cancellationToken)
    {
        try
        {
            var all = await log.ReadAllAsync(cancellationToken);
            var actual = Estimator.Score(all);
            var expected = Estimator.Latest(all) ?? 0m;
            var status = outcome.End == WorkflowEnd.Succeeded ? RunStatuses.Succeeded : RunStatuses.Failed;
            List<RunEvent> closing = [new RunEvent(HarnessEvents.EstimateScored, Estimator.Scored(expected, actual))];
            if (!outcome.Announced)
            {
                // Said once: a workflow that announced its own ending (a verdict, a published app) is not repeated here.
                closing.Add(new RunEvent(HarnessEvents.Message, new JsonObject
                {
                    ["from"] = "runner",
                    ["title"] = status == RunStatuses.Succeeded ? "Finished" : "Stopped",
                    ["text"] = Workflows.WorkflowSupport.ForPeople(outcome.ForOwner ?? (OwnerText.IsPlain(outcome.Summary)
                        ? outcome.Summary
                        : status == RunStatuses.Succeeded ? "The work is finished; technical mode has the details." : "The work stopped before it was finished; technical mode says exactly why.")),
                    ["milestone"] = "finished",
                }));
            }

            await log.AppendAsync(
            [
                .. closing,
                new RunEvent(RunEventTypes.RunFinished, new JsonObject
                {
                    ["outcome"] = status,
                    ["summary"] = OutputText.Truncate(outcome.Summary, 2000),
                    ["totals"] = new JsonObject { ["credits"] = actual.Billable, ["nonBillableCredits"] = actual.NonBillable, ["modelCalls"] = actual.Calls },
                }),
            ], cancellationToken);
            logger.LogInformation("Run {RunId} {Outcome}: {Summary}", run.Id, status, OutputText.Truncate(outcome.Summary, 200));
        }
        catch (ServiceProblemException e) when (e.Status == HttpStatusCode.Conflict)
        {
            logger.LogWarning("Run {RunId} could not be finished: {Detail}", run.Id, e.Detail);
        }
        finally
        {
            await keeper.StopAsync();
            try
            {
                await workspaces.ReleaseAsync(run.Id, CancellationToken.None);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Run {RunId}'s workspace could not be released; Dock destroys it when the lease lapses.", run.Id);
            }
        }
    }

    /// <summary>The lease keeper, plus the Runner's own shutdown: a stopping Runner suspends its runs at a step boundary.</summary>
    private sealed class ShutdownAware(LeaseKeeper keeper, Func<bool> shutdown) : IRunControl
    {
        public async ValueTask<RunSignal> CheckAsync(CancellationToken cancellationToken)
        {
            var signal = await keeper.CheckAsync(cancellationToken);
            return signal == RunSignal.Continue && shutdown() ? RunSignal.LeaseLost : signal;
        }
    }
}

/// <summary>
/// Every event a workflow appends goes through the same cleaning and fitting the agents' own writer applies: control
/// characters scrubbed and the payload cut to the log's 64 KB limit, largest strings first — a live build failed when one
/// evaluation's evidence and faults ran past it.
/// </summary>
public sealed class FittingSink(IEventSink inner) : IEventSink
{
    public Task<IReadOnlyList<RunEvent>> AppendAsync(IReadOnlyList<RunEvent> events, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(events);
        return inner.AppendAsync(events.Select(e => new RunEvent(e.Type, AgentEventWriter.Fit(AgentEventWriter.Clean(e.Payload)))).ToList(), cancellationToken);
    }
}
