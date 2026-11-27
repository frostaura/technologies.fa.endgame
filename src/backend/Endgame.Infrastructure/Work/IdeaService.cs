using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

public sealed record IdeaView(
    Guid Id,
    string Scope,
    string Text,
    string Constraints,
    string Status,
    string? Verdict,
    string? VerdictSummary,
    JsonNode? VerdictEvidence,
    bool Overruled,
    string? Decision,
    string? DecisionNote,
    DateTimeOffset? DecidedAt,
    Guid? ResearchRunId,
    Guid? BuildRunId,
    DateTimeOffset CreatedAt);

public sealed record IdeaStarted(IdeaView Idea, RunView Run);

/// <summary>
/// Ideas, as far as the control plane owns them: it records the idea and queues the research run;
/// the Runner does the research and reports the verdict; the owner decides. A "do not build" can only
/// be built over by an explicit overrule, which the idea keeps on record.
/// </summary>
public sealed class IdeaService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, RunService runs, Cascade.CascadeService cascade, TimeProvider clock)
{
    public const int MaxTextLength = 20_000;

    /// <param name="by">The person who described it; null when the conversation started it on the owner's confirmed word.</param>
    /// <param name="via"><c>console</c> or <c>conversation</c>: where the idea was raised.</param>
    public async Task<IdeaStarted> CreateAsync(ResolvedScope scope, string text, IReadOnlyList<string>? constraints, decimal estimateCredits, Guid? by, CancellationToken cancellationToken, string via = "console", string? estimateReason = null, decimal? estimateCeiling = null)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (scope.Level > NodeLevel.Division)
        {
            throw EndgameProblem.Invalid("An idea is proposed to the organisation or to a division; placement into a project comes after the verdict.");
        }

        var trimmed = text?.Trim() ?? "";
        var joined = string.Join("\n", (constraints ?? []).Select(c => c.Replace('\n', ' ').Trim()).Where(c => c.Length > 0));
        if (trimmed.Length is 0 or > MaxTextLength || joined.Length > MaxTextLength)
        {
            throw EndgameProblem.Invalid($"Describe the idea in 1 to {MaxTextLength} characters; constraints up to the same.");
        }

        var idea = new IdeaRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = scope.OrganisationId,
            DivisionId = scope.DivisionId,
            Text = trimmed,
            Constraints = joined,
            Status = IdeaStatuses.Researching,
            ResearchEstimateCredits = estimateCredits,
            CreatedBy = by,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Ideas.Add(idea);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        var run = await StartResearchAsync(scope, idea, trimmed, idea.Constraints, null, by, cancellationToken, via);
        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent("estimate.made", new JsonObject
        {
            ["credits"] = estimateCredits,
            ["basis"] = "research",
            ["reason"] = estimateReason,
            ["ceiling"] = estimateCeiling,
        })], null, by, cancellationToken);
        return new IdeaStarted(await GetAsync(scope.OrganisationId, idea.Id, cancellationToken), run);
    }

    public async Task<Guid> OrganisationOfAsync(Guid ideaId, CancellationToken cancellationToken) =>
        await scopes.OrganisationOfAsync(db.Ideas, q => q.Where(i => i.Id == ideaId).Select(i => i.OrganisationId), cancellationToken)
        ?? throw EndgameProblem.NotFound("The idea");

    public async Task<IdeaView> GetAsync(Guid organisationId, Guid ideaId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        var scope = await scopes.ForRowAsync(idea.OrganisationId, idea.DivisionId, idea.ProjectId, idea.AppId, cancellationToken);
        return View(idea, scope.Path.ToString());
    }

    public async Task<ResolvedScope> ScopeOfAsync(Guid organisationId, Guid ideaId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        return await scopes.ForRowAsync(idea.OrganisationId, idea.DivisionId, idea.ProjectId, idea.AppId, cancellationToken);
    }

    /// <summary>
    /// The Runner reports the research verdict, as the whole verdict document the console shows
    /// (<c>outcome</c>, <c>headline</c>, <c>summary</c>, <c>existing</c>, <c>gap</c>, <c>demand</c>,
    /// <c>wouldChange</c>, <c>method</c>). Only an idea under research can receive one.
    /// </summary>
    public async Task<IdeaView> RecordVerdictAsync(Guid ideaId, JsonObject verdict, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(verdict);

        // One shape, exactly (ARCH-004, The verdict document): the console renders what is stored, so
        // nothing malformed is stored. Each fault is named, so the Runner can have it corrected.
        var faults = VerdictDocument.Validate(verdict);
        if (faults.Count > 0)
        {
            var refused = new EndgameProblem(400, "verdict_invalid", "The verdict document is not in the agreed shape",
                $"{faults.Count} fault{(faults.Count == 1 ? "" : "s")}: {string.Join("; ", faults.Take(5))}{(faults.Count > 5 ? "; …" : "")}");
            refused.Extensions["errors"] = faults;
            throw refused;
        }

        var outcome = verdict["outcome"]!.GetValue<string>();
        var summary = verdict["summary"]!.GetValue<string>().Trim();
        var redLine = RedLineOf(verdict);

        var org = await OrganisationOfAsync(ideaId, cancellationToken);
        var document = verdict.ToJsonString();
        var changed = await db.Ideas.Where(i => i.OrganisationId == org && i.Id == ideaId && i.Status == IdeaStatuses.Researching)
            .ExecuteUpdateAsync(s => s
                .SetProperty(i => i.Status, IdeaStatuses.AwaitingDecision)
                .SetProperty(i => i.Verdict, outcome)
                .SetProperty(i => i.VerdictSummary, summary)
                .SetProperty(i => i.VerdictEvidenceJson, document)
                .SetProperty(i => i.RedLine, redLine)
                // A new verdict clears the decision that led to it ("change the idea"): it is kept in the decision history,
                // read from the research runs, and the owner decides again on this verdict (VERD-07).
                .SetProperty(i => i.Decision, (string?)null)
                .SetProperty(i => i.DecisionNote, (string?)null)
                .SetProperty(i => i.DecidedBy, (Guid?)null)
                .SetProperty(i => i.DecidedVia, (string?)null)
                .SetProperty(i => i.DecidedAt, (DateTimeOffset?)null), cancellationToken);
        if (changed == 0)
        {
            throw EndgameProblem.Conflict("A verdict can only be recorded for an idea that is being researched.");
        }

        return await GetAsync(org, ideaId, cancellationToken);
    }

    /// <summary>
    /// The breached red line a verdict records (<c>redLines { breached: true, line }</c>, as research
    /// writes it, or <c>redLine</c>), or null. "unnamed" when it is breached but not named.
    /// </summary>
    public static string? RedLineOf(JsonObject verdict)
    {
        ArgumentNullException.ThrowIfNull(verdict);
        foreach (var key in new[] { "redLines", "redLine" })
        {
            if (verdict[key] is JsonObject lines && lines["breached"]?.GetValueKind() == System.Text.Json.JsonValueKind.True)
            {
                var line = lines["line"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? lines["line"]!.GetValue<string>().Trim() : "";
                return line.Length == 0 ? "unnamed" : line.Length > 300 ? line[..300] : line;
            }
        }

        return null;
    }

    /// <summary>
    /// Auto-mode's decision after a verdict (the Runner, <c>by: "auto-mode"</c>): only <c>build</c>, only
    /// on a build or change verdict, and only where the idea's autonomy is auto. A do-not-build always
    /// waits for the owner.
    /// </summary>
    public async Task<(IdeaView Idea, RunView? Run)> DecideAutomaticallyAsync(Guid organisationId, Guid ideaId, string decision, CancellationToken cancellationToken)
    {
        if (decision != IdeaDecisions.Build)
        {
            throw new EndgameProblem(403, "owner_decision_required", "Only the owner can take that decision",
                "Auto-mode may only build after a build or change verdict; change, overrule and drop are the owner's.");
        }

        var scope = await ScopeOfAsync(organisationId, ideaId, cancellationToken);
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken);
        if (idea.Status == IdeaStatuses.AwaitingDecision && idea.Verdict == Verdicts.DoNotBuild)
        {
            throw new EndgameProblem(409, "owner_decision_required", "A do-not-build waits for the owner",
                "The verdict was do not build, which pauses auto-mode: the owner overrules it or drops the idea.");
        }

        if (await cascade.AutonomyAsync(scope, cancellationToken) != Domain.Cascade.Autonomy.Auto)
        {
            // People read this sentence: the level by its name; the scope's path is kept for technical mode.
            var refusal = new EndgameProblem(409, "owner_decision_required", "Checkpoints are on here",
                $"Checkpoints are on for {scope.Node.Name}, so the owner decides on the verdict.");
            refusal.Extensions["scope"] = scope.Path.ToString();
            throw refusal;
        }

        // On a "change" verdict auto-mode builds with research's change applied, and the build says so (VERD-11).
        return await DecideAsync(organisationId, ideaId, decision, "Decided by auto-mode after the verdict.", null, cancellationToken, IdeaDecisions.ByAutoMode, applyChange: idea.Verdict == Verdicts.Change);
    }

    /// <summary>The owner's decision on a verdict: build, change (research again), overrule a "do not build", or drop.</summary>
    /// <param name="applyChange">On a "change" verdict, build with research's suggested change as part of what is built.</param>
    public async Task<(IdeaView Idea, RunView? Run)> DecideAsync(Guid organisationId, Guid ideaId, string decision, string? note, Guid? by, CancellationToken cancellationToken, string via = IdeaDecisions.ByPerson, bool applyChange = false)
    {
        if (!IdeaDecisions.All.Contains(decision))
        {
            throw EndgameProblem.Invalid($"A decision is one of {string.Join(", ", IdeaDecisions.All)}.");
        }

        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        if (idea.Status != IdeaStatuses.AwaitingDecision || idea.Verdict is null)
        {
            throw EndgameProblem.Conflict($"The idea is {idea.Status}; a decision follows a verdict.");
        }

        if (idea.RedLine is { } line && decision is IdeaDecisions.Build or IdeaDecisions.Overrule)
        {
            // One of the conditions Endgame passed its governance gate on (CLAUDE.md rule 4): no one, a person included, builds over it.
            var refused = new EndgameProblem(403, "red_line", "This idea crosses a red line",
                $"The research found it crosses a red line ({line}). FrostAura never builds it, and no one can overrule that. Change the idea, or drop it.");
            refused.Extensions["redLine"] = line;
            throw refused;
        }

        if (!IdeaDecisions.IsAllowed(decision, idea.Verdict))
        {
            throw EndgameProblem.Conflict(decision == IdeaDecisions.Build
                ? "The verdict was 'do not build'. Building over it takes an explicit overrule, which the project keeps on record."
                : $"There is nothing to overrule: the verdict was '{idea.Verdict}'.");
        }

        var scope = await scopes.ForRowAsync(idea.OrganisationId, idea.DivisionId, idea.ProjectId, idea.AppId, cancellationToken);
        session.UseOrganisation(organisationId);
        idea.Decision = decision;
        idea.DecisionNote = note?.Trim();
        idea.DecidedBy = by;
        idea.DecidedVia = via;
        idea.DecidedAt = clock.GetUtcNow();
        RunView? run = null;
        switch (decision)
        {
            case IdeaDecisions.Build or IdeaDecisions.Overrule:
                var suggested = applyChange && idea.Verdict == Verdicts.Change && idea.VerdictEvidenceJson is { } evidence
                    && JsonNode.Parse(evidence)?["suggestedChange"] is JsonValue sc && sc.TryGetValue<string>(out var change) && change.Trim().Length > 0
                    ? change.Trim()
                    : null;
                if (applyChange && suggested is null)
                {
                    throw EndgameProblem.Conflict("There is no change from research to apply: the verdict was not 'change', or it named none.");
                }

                // What is built is the idea plus every change agreed after research: the owner's own notes, and research's when accepted (VERD-06).
                var changes = (await OwnerChangesAsync(organisationId, ideaId, cancellationToken)).ToList();
                if (suggested is not null)
                {
                    changes.Add(suggested);
                }

                idea.Status = IdeaStatuses.Building;
                idea.Overruled = decision == IdeaDecisions.Overrule;
                await db.SaveChangesAsync(cancellationToken);
                run = await runs.CreateAsync(scope, RunKinds.Build, $"Build: {Title(idea.Text)}", null, idea.Id, null, idea.ResearchRunId, by, cancellationToken);
                await runs.AppendAsync(organisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
                {
                    ["from"] = "owner",
                    ["text"] = idea.Text,
                    ["constraints"] = idea.Constraints,
                    ["verdict"] = idea.Verdict,
                    ["overruled"] = idea.Overruled,
                    ["note"] = idea.DecisionNote,
                    ["decidedBy"] = via,
                    ["changes"] = new JsonArray(changes.Distinct(StringComparer.Ordinal).Select(c => (JsonNode)c).ToArray()),
                    ["appliedChange"] = suggested,
                })], null, by, cancellationToken);
                await db.Ideas.Where(i => i.OrganisationId == organisationId && i.Id == ideaId)
                    .ExecuteUpdateAsync(s => s.SetProperty(i => i.BuildRunId, run.Id), cancellationToken);
                break;
            case IdeaDecisions.Change:
                idea.Status = IdeaStatuses.Researching;
                idea.Verdict = null;
                idea.VerdictSummary = null;
                idea.VerdictEvidenceJson = null;
                idea.RedLine = null;
                await db.SaveChangesAsync(cancellationToken);
                db.ChangeTracker.Clear();
                run = await StartResearchAsync(scope, idea, idea.Text, idea.Constraints, idea.DecisionNote, by, cancellationToken);
                break;
            default:
                idea.Status = IdeaStatuses.Dropped;
                await db.SaveChangesAsync(cancellationToken);
                break;
        }

        db.ChangeTracker.Clear();
        return (await GetAsync(organisationId, ideaId, cancellationToken), run);
    }

    /// <summary>The change each round of research was asked for, oldest first: what the owner wanted different after a verdict.</summary>
    public async Task<IReadOnlyList<string>> OwnerChangesAsync(Guid organisationId, Guid ideaId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var research = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == organisationId && r.IdeaId == ideaId && r.Kind == RunKinds.Research)
            .OrderBy(r => r.CreatedAt).Select(r => r.Id).ToListAsync(cancellationToken);
        var changes = new List<string>();
        foreach (var id in research)
        {
            if (await OwnerMessageAsync(organisationId, id, cancellationToken) is { } owner && owner["change"] is JsonValue v && v.TryGetValue<string>(out var change)
                && change.Trim().Length > 0 && !changes.Contains(change.Trim(), StringComparer.Ordinal))
            {
                changes.Add(change.Trim());
            }
        }

        return changes;
    }

    /// <summary>A run's first message from the owner: the idea, the change asked for, what a retry carries on from.</summary>
    public async Task<JsonObject?> OwnerMessageAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken)
    {
        var events = await runs.ReadEventsAsync(organisationId, runId, 0, 10, cancellationToken);
        return events.FirstOrDefault(e => e.Type == RunEventTypes.Message && e.Payload is JsonObject p && p["from"]?.GetValue<string>() == "owner")?.Payload as JsonObject;
    }

    /// <summary>
    /// Research that failed or was cancelled, researched again (VERD-12): the same idea, constraints and change, its estimate
    /// first in the new run's log. Only the idea's latest research, and only once — a second try of the same run is a conflict.
    /// </summary>
    public async Task<RunView> RetryResearchAsync(Guid organisationId, Guid ideaId, Guid failedRunId, decimal estimate, string basis, decimal? ceiling, Guid? by, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        if (idea.Status != IdeaStatuses.Researching || idea.ResearchRunId != failedRunId)
        {
            throw EndgameProblem.Conflict("Only the idea's latest research can be tried again, while no verdict has been reached.");
        }

        var owner = await OwnerMessageAsync(organisationId, failedRunId, cancellationToken);
        var change = owner?["change"] is JsonValue v && v.TryGetValue<string>(out var c) ? c : null;
        var scope = await scopes.ForRowAsync(idea.OrganisationId, idea.DivisionId, idea.ProjectId, idea.AppId, cancellationToken);
        var run = await StartResearchAsync(scope, idea, idea.Text, idea.Constraints, change, by, cancellationToken, "retry", failedRunId);
        await runs.AppendAsync(organisationId, run.Id, [new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate, ["basis"] = "research", ["reason"] = basis, ["ceiling"] = ceiling })], null, by, cancellationToken);
        return run;
    }

    /// <summary>
    /// A build that failed, was cancelled, stopped for budget or had its plan declined, built again (CHG-03): the same owner
    /// message, plus <c>retryOf</c>, so the Runner keeps what the earlier attempt placed, agreed and finished. Its estimate — for
    /// what is left — comes first in the new run's log.
    /// </summary>
    public async Task<RunView> RetryBuildAsync(Guid organisationId, Guid ideaId, Guid failedRunId, decimal estimate, string basis, Guid? by, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var idea = await db.Ideas.AsNoTracking().SingleOrDefaultAsync(i => i.OrganisationId == organisationId && i.Id == ideaId, cancellationToken)
            ?? throw EndgameProblem.NotFound("The idea");
        if (idea.Status != IdeaStatuses.Building || idea.BuildRunId != failedRunId)
        {
            throw EndgameProblem.Conflict("Only the idea's latest build can be built again.");
        }

        var failed = await db.Runs.AsNoTracking().SingleAsync(r => r.OrganisationId == organisationId && r.Id == failedRunId, cancellationToken);
        var owner = (await OwnerMessageAsync(organisationId, failedRunId, cancellationToken))?.DeepClone() as JsonObject ?? new JsonObject { ["from"] = "owner", ["text"] = idea.Text, ["constraints"] = idea.Constraints };
        owner["retryOf"] = failedRunId.ToString();
        owner["decidedBy"] = by is null ? "conversation" : IdeaDecisions.ByPerson;
        var scope = await scopes.ForRowAsync(idea.OrganisationId, idea.DivisionId, idea.ProjectId, idea.AppId, cancellationToken);
        var run = await runs.CreateAsync(scope, RunKinds.Build, failed.Title, null, idea.Id, null, failed.ParentRunId, by, cancellationToken);
        session.UseOrganisation(organisationId);
        var moved = await db.Ideas.Where(i => i.OrganisationId == organisationId && i.Id == ideaId && i.BuildRunId == failedRunId)
            .ExecuteUpdateAsync(u => u.SetProperty(i => i.BuildRunId, run.Id), cancellationToken);
        if (moved == 0)
        {
            await CloseDuplicateAsync(organisationId, run.Id, cancellationToken);
            throw EndgameProblem.Conflict("This build was already started again.");
        }

        await runs.AppendAsync(organisationId, run.Id, [
            new NewEvent(RunEventTypes.Message, owner),
            new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate, ["basis"] = "retry", ["reason"] = basis }),
        ], null, by, cancellationToken);
        return run;
    }

    private async Task<RunView> StartResearchAsync(ResolvedScope scope, IdeaRecord idea, string text, string constraints, string? change, Guid? by, CancellationToken cancellationToken, string via = "console", Guid? retryOf = null)
    {
        var run = await runs.CreateAsync(scope, RunKinds.Research, $"Research: {Title(text)}", null, idea.Id, null, idea.ResearchRunId, by, cancellationToken);
        session.UseOrganisation(scope.OrganisationId);
        var moved = await db.Ideas.Where(i => i.OrganisationId == scope.OrganisationId && i.Id == idea.Id && (retryOf == null || i.ResearchRunId == retryOf))
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.ResearchRunId, run.Id), cancellationToken);
        if (moved == 0)
        {
            await CloseDuplicateAsync(scope.OrganisationId, run.Id, cancellationToken);
            throw EndgameProblem.Conflict("This research was already started again.");
        }

        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
        {
            ["from"] = "owner",
            ["text"] = text,
            ["constraints"] = constraints,
            ["change"] = change,
            ["via"] = via,
            ["retryOf"] = retryOf?.ToString(),
        })], null, by, cancellationToken);
        return run;
    }

    /// <summary>A second attempt that lost the race to the first: closed at once, before it was given any work.</summary>
    private Task CloseDuplicateAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken) =>
        runs.AppendAsync(organisationId, runId, [new NewEvent(RunEventTypes.RunFinished, new JsonObject { ["outcome"] = RunStatuses.Cancelled, ["reason"] = "Another attempt started first." })], null, null, cancellationToken);

    private static string Title(string text)
    {
        // Cut at a word, never mid-word: this is the title the owner reads on cards, approvals and work (#40).
        return Endgame.Domain.Words.Clamp(text.Split('\n', 2)[0], 120);
    }

    private static IdeaView View(IdeaRecord i, string scope) => new(
        i.Id, scope, i.Text, i.Constraints, i.Status, i.Verdict, i.VerdictSummary, i.VerdictEvidenceJson is null ? null : JsonNode.Parse(i.VerdictEvidenceJson),
        i.Overruled, i.Decision, i.DecisionNote, i.DecidedAt, i.ResearchRunId, i.BuildRunId, i.CreatedAt);
}
