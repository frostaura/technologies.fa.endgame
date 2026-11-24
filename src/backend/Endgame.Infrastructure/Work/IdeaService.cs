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
public sealed class IdeaService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, RunService runs, TimeProvider clock)
{
    public const int MaxTextLength = 20_000;

    public async Task<IdeaStarted> CreateAsync(ResolvedScope scope, string text, IReadOnlyList<string>? constraints, decimal estimateCredits, Guid by, CancellationToken cancellationToken)
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
        var run = await StartResearchAsync(scope, idea, trimmed, idea.Constraints, null, by, cancellationToken);
        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent("estimate.made", new JsonObject
        {
            ["credits"] = estimateCredits,
            ["basis"] = "research",
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
        var outcome = verdict["outcome"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? verdict["outcome"]!.GetValue<string>().Replace('_', '-') : null;
        if (outcome is null || !Verdicts.All.Contains(outcome))
        {
            throw EndgameProblem.Invalid($"A verdict's outcome is one of {string.Join(", ", Verdicts.All)}.");
        }

        var summary = verdict["summary"]?.GetValueKind() == System.Text.Json.JsonValueKind.String ? verdict["summary"]!.GetValue<string>().Trim() : "";
        if (summary.Length == 0)
        {
            throw EndgameProblem.Invalid("A verdict carries a summary of its evidence.");
        }

        verdict["outcome"] = outcome;
        var org = await OrganisationOfAsync(ideaId, cancellationToken);
        var document = verdict.ToJsonString();
        var changed = await db.Ideas.Where(i => i.OrganisationId == org && i.Id == ideaId && i.Status == IdeaStatuses.Researching)
            .ExecuteUpdateAsync(s => s
                .SetProperty(i => i.Status, IdeaStatuses.AwaitingDecision)
                .SetProperty(i => i.Verdict, outcome)
                .SetProperty(i => i.VerdictSummary, summary)
                .SetProperty(i => i.VerdictEvidenceJson, document), cancellationToken);
        if (changed == 0)
        {
            throw EndgameProblem.Conflict("A verdict can only be recorded for an idea that is being researched.");
        }

        return await GetAsync(org, ideaId, cancellationToken);
    }

    /// <summary>The owner's decision on a verdict: build, change (research again), overrule a "do not build", or drop.</summary>
    public async Task<(IdeaView Idea, RunView? Run)> DecideAsync(Guid organisationId, Guid ideaId, string decision, string? note, Guid by, CancellationToken cancellationToken)
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
                })], null, by, cancellationToken);
                await db.Ideas.Where(i => i.OrganisationId == organisationId && i.Id == ideaId)
                    .ExecuteUpdateAsync(s => s.SetProperty(i => i.BuildRunId, run.Id), cancellationToken);
                break;
            case IdeaDecisions.Change:
                idea.Status = IdeaStatuses.Researching;
                idea.Verdict = null;
                idea.VerdictSummary = null;
                idea.VerdictEvidenceJson = null;
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

    private async Task<RunView> StartResearchAsync(ResolvedScope scope, IdeaRecord idea, string text, string constraints, string? change, Guid by, CancellationToken cancellationToken)
    {
        var run = await runs.CreateAsync(scope, RunKinds.Research, $"Research: {Title(text)}", null, idea.Id, null, idea.ResearchRunId, by, cancellationToken);
        await runs.AppendAsync(scope.OrganisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
        {
            ["from"] = "owner",
            ["text"] = text,
            ["constraints"] = constraints,
            ["change"] = change,
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
