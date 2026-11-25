using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>What trying a stopped piece of work again would do and cost, shown before it starts (CLAUDE.md rule 11).</summary>
/// <param name="What"><c>research</c>, <c>build</c> or <c>change</c>.</param>
/// <param name="PartsDone">Parts already built and checked, kept and not charged again; null when the work has no agreed plan yet.</param>
/// <param name="Parts">The parts of the agreed plan; null when there is none.</param>
public sealed record RetryEstimateView(Guid RunId, string What, decimal Credits, string Basis, int? PartsDone, int? Parts);

/// <summary>
/// Trying again (CHG-03, VERD-12, RUN-10, RUN-11): research that failed or was cancelled is researched again; a build or a
/// change that failed, was cancelled, stopped for budget or had its plan declined is started again as a new run that carries
/// on from what the earlier one placed, agreed and finished. Only the latest attempt can be tried again, and only once.
/// </summary>
public sealed class RetryService(EndgameDbContext db, TenantSession session, RunService runs, IdeaService ideas, ResearchEstimator research, FactoryEstimates estimates)
{
    /// <summary>Whether a run is one that can be tried again: research, a build or a change that stopped without finishing.</summary>
    public static bool Retryable(RunRecord run, bool change) =>
        run.Status is RunStatuses.Failed or RunStatuses.Cancelled && (run.Kind is RunKinds.Research or RunKinds.Build || (run.Kind == RunKinds.Task && change));

    public async Task<RetryEstimateView> EstimateAsync(Guid runId, CancellationToken cancellationToken)
    {
        var (run, owner, what) = await RequireAsync(runId, cancellationToken);
        if (what == "research")
        {
            var idea = await IdeaAsync(run, cancellationToken);
            var estimate = await research.ResearchAsync(run.OrganisationId, idea.Text, IdeaLines(idea.Constraints), cancellationToken);
            return new RetryEstimateView(runId, what, estimate.Credits, estimate.Basis, null, null);
        }

        var (done, parts) = await ProgressAsync(run, cancellationToken);
        var left = parts is { } n ? n - (done ?? 0) : 1;
        var priced = what == "build"
            ? await estimates.BuildAsync(run.OrganisationId, left, parts ?? 1, cancellationToken)
            : await estimates.ChangeAsync(run.OrganisationId, left, parts ?? 1, cancellationToken);
        _ = owner;
        return new RetryEstimateView(runId, what, priced.Credits, priced.Basis, done, parts);
    }

    /// <summary>Starts the work again; the new run's log opens with the estimate made here.</summary>
    public async Task<RunView> RetryAsync(Guid runId, Guid? by, CancellationToken cancellationToken)
    {
        var (run, owner, what) = await RequireAsync(runId, cancellationToken);
        var estimate = await EstimateAsync(runId, cancellationToken);
        switch (what)
        {
            case "research":
                {
                    var idea = await IdeaAsync(run, cancellationToken);
                    var priced = await research.ResearchAsync(run.OrganisationId, idea.Text, IdeaLines(idea.Constraints), cancellationToken);
                    return await ideas.RetryResearchAsync(run.OrganisationId, idea.Id, runId, priced.Credits, priced.Basis, priced.Ceiling, by, cancellationToken);
                }

            case "build":
                return await ideas.RetryBuildAsync(run.OrganisationId, run.IdeaId!.Value, runId, estimate.Credits, estimate.Basis, by, cancellationToken);
            default:
                {
                    session.UseOrganisation(run.OrganisationId);
                    var later = await db.Runs.AsNoTracking().AnyAsync(r => r.OrganisationId == run.OrganisationId && r.ParentRunId == runId && r.Kind == RunKinds.Task, cancellationToken);
                    var busy = await db.Runs.AsNoTracking().AnyAsync(r => r.OrganisationId == run.OrganisationId && r.AppId == run.AppId && (r.Kind == RunKinds.Build || r.Kind == RunKinds.Task)
                        && r.Status != RunStatuses.Succeeded && r.Status != RunStatuses.Failed && r.Status != RunStatuses.Cancelled, cancellationToken);
                    if (later || busy)
                    {
                        throw EndgameProblem.Conflict(later ? "This change was already started again." : "Another build or change of this app is under way; wait for it, or cancel it, first.");
                    }

                    var scope = (await runs.RequireAsync(runId, cancellationToken)).Scope;
                    var message = owner.DeepClone().AsObject();
                    message["retryOf"] = runId.ToString();
                    message["userId"] = by?.ToString();
                    var again = await runs.CreateAsync(scope, RunKinds.Task, run.Title, null, null, null, runId, by, cancellationToken);
                    await runs.AppendAsync(run.OrganisationId, again.Id, [
                        new NewEvent(RunEventTypes.Message, message),
                    new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate.Credits, ["basis"] = "retry", ["reason"] = estimate.Basis }),
                ], null, by, cancellationToken);
                    return await runs.GetAsync(run.OrganisationId, again.Id, cancellationToken);
                }
        }
    }

    private async Task<(RunRecord Run, JsonObject Owner, string What)> RequireAsync(Guid runId, CancellationToken cancellationToken)
    {
        var (run, _) = await runs.RequireAsync(runId, cancellationToken);
        var owner = await ideas.OwnerMessageAsync(run.OrganisationId, runId, cancellationToken) ?? new JsonObject();
        var change = owner["kind"] is JsonValue k && k.TryGetValue<string>(out var kind) && kind == ChangeService.ChangeKind;
        if (!Retryable(run, change) || (run.Kind is RunKinds.Research or RunKinds.Build && run.IdeaId is null))
        {
            throw new EndgameProblem(409, "not_retryable", "This work cannot be tried again",
                RunStatuses.IsTerminal(run.Status)
                    ? "Only research, a build or a change of an app that stopped without finishing can be tried again."
                    : "It has not stopped: pause, resume or cancel it instead.");
        }

        return (run, owner, run.Kind == RunKinds.Research ? "research" : run.Kind == RunKinds.Build ? "build" : "change");
    }

    private async Task<IdeaRecord> IdeaAsync(RunRecord run, CancellationToken cancellationToken)
    {
        session.UseOrganisation(run.OrganisationId);
        return await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == run.OrganisationId && i.Id == run.IdeaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
    }

    private static List<string> IdeaLines(string constraints) =>
        constraints.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    /// <summary>The agreed plan's parts, and how many passed their check, from the earlier run's own journal (null when no plan was agreed).</summary>
    public async Task<(int? Done, int? Parts)> ProgressAsync(RunRecord run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        JsonArray? items = null;
        var passed = new HashSet<string>(StringComparer.Ordinal);
        long after = 0;
        while (true)
        {
            var page = await runs.ReadEventsAsync(run.OrganisationId, run.Id, after, RunService.MaxEventsPerRead, cancellationToken);
            foreach (var e in page)
            {
                after = e.Seq;
                if (e.Type != RunEventTypes.Message || e.Payload is not JsonObject p || Str(p, "kind") != "workflow.step" || p["data"] is not JsonObject data)
                {
                    continue;
                }

                var step = Str(p, "step") ?? "";
                if (step == "plan")
                {
                    items = data["items"] as JsonArray;
                }
                else if (step.StartsWith("item:", StringComparison.Ordinal) && step.Count(c => c == ':') == 1 && data["passed"] is JsonValue v && v.TryGetValue<bool>(out var ok) && ok)
                {
                    passed.Add(step[5..]);
                }
            }

            if (page.Count < RunService.MaxEventsPerRead)
            {
                break;
            }
        }

        if (items is null)
        {
            return (null, null);
        }

        var ids = items.OfType<JsonObject>().Select(i => Str(i, "id")).OfType<string>().ToList();
        return (ids.Count(passed.Contains), ids.Count);
    }

    private static string? Str(JsonObject o, string key) => o[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
