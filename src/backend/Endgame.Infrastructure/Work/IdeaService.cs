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
                .SetProperty(i => i.RedLine, redLine), cancellationToken);
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
            throw new EndgameProblem(409, "owner_decision_required", "Checkpoints are on here",
                $"Autonomy at {scope.Path} is 'checkpoints', so the owner decides on the verdict.");
        }

        return await DecideAsync(organisationId, ideaId, decision, "Decided by auto-mode after the verdict.", null, cancellationToken, IdeaDecisions.ByAutoMode);
    }

    /// <summary>The owner's decision on a verdict: build, change (research again), overrule a "do not build", or drop.</summary>
    public async Task<(IdeaView Idea, RunView? Run)> DecideAsync(Guid organisationId, Guid ideaId, string decision, string? note, Guid? by, CancellationToken cancellationToken, string via = IdeaDecisions.ByPerson)
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

    private async Task<RunView> StartResearchAsync(ResolvedScope scope, IdeaRecord idea, string text, string constraints, string? change, Guid? by, CancellationToken cancellationToken, string via = "console")
    {
        var run = await runs.CreateAsync(scope, RunKinds.Research, $"Research: {Title(text)}", null, idea.Id, null, idea.ResearchRunId, by, cancellationToken);
        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
        {
            ["from"] = "owner",
            ["text"] = text,
            ["constraints"] = constraints,
            ["change"] = change,
            ["via"] = via,
        })], null, by, cancellationToken);
        session.UseOrganisation(scope.OrganisationId);
        await db.Ideas.Where(i => i.OrganisationId == scope.OrganisationId && i.Id == idea.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.ResearchRunId, run.Id), cancellationToken);
        return run;
    }

    private static string Title(string text)
    {
        var line = text.Split('\n', 2)[0].Trim();
        return line.Length <= 120 ? line : line[..117] + "...";
    }

    private static IdeaView View(IdeaRecord i, string scope) => new(
        i.Id, scope, i.Text, i.Constraints, i.Status, i.Verdict, i.VerdictSummary, i.VerdictEvidenceJson is null ? null : JsonNode.Parse(i.VerdictEvidenceJson),
        i.Overruled, i.Decision, i.DecisionNote, i.DecidedAt, i.ResearchRunId, i.BuildRunId, i.CreatedAt);
}
