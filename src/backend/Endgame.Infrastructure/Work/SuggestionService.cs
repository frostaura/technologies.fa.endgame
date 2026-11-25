using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

public sealed record SuggestionView(Guid Id, string Scope, Guid RunId, string Title, string Idea, string Gap, string WhyUs, IReadOnlyList<string> Reuses,
    string Status, Guid? IdeaId, DateTimeOffset CreatedAt);

/// <param name="Run">The suggestion run, queued for the Runner; its log carries the estimate.</param>
public sealed record SuggestionsStarted(RunView Run, Estimate Estimate);

public sealed record SuggestionInput(string? Title, string? Idea, string? Gap, string? WhyUs, IReadOnlyList<string>? Reuses);

/// <summary>What a suggestion run reads: the organisation as it stands, what it has built and considered, and what was suggested before.</summary>
public sealed record SuggestionContext(
    string Scope,
    string Organisation,
    IReadOnlyList<SuggestionProduct> Products,
    IReadOnlyList<SuggestionIdea> Ideas,
    IReadOnlyList<string> Context,
    IReadOnlyList<string> AlreadySuggested,
    int MaxSuggestions);

/// <param name="Kind"><c>division</c>, <c>project</c> or <c>app</c>.</param>
public sealed record SuggestionProduct(string Kind, string Scope, string Name, string Status);

public sealed record SuggestionIdea(string Title, string Status, string? Verdict);

/// <summary>
/// New ideas suggested from the organisation's own portfolio (spec: "the system can suggest new
/// product ideas from what the organisation already holds"). The control plane queues a
/// <c>suggest</c> run with its estimate shown first; the Runner reads the context, proposes up to
/// five ideas and posts them back; a person turns one into an idea, which is then researched like
/// any other.
/// </summary>
public sealed class SuggestionService(EndgameDbContext db, TenantSession session, ScopeResolver scopes, RunService runs, CascadeService cascade, IdeaService ideas, TimeProvider clock)
{
    public async Task<SuggestionsStarted> StartAsync(ResolvedScope scope, Estimate estimate, Guid by, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        ArgumentNullException.ThrowIfNull(estimate);
        var at = await ProposalScopeAsync(scope, cancellationToken);
        var run = await runs.CreateAsync(at, RunKinds.Suggest, $"Suggest ideas from {at.Node.Name}", null, null, null, null, by, cancellationToken);
        await runs.AppendAsync(at.OrganisationId, run.Id,
        [
            new NewEvent("estimate.made", new JsonObject { ["credits"] = estimate.Credits, ["basis"] = "suggest" }),
            new NewEvent(RunEventTypes.Message, new JsonObject
            {
                ["from"] = "owner",
                ["kind"] = "ideas.suggest",
                ["text"] = $"Suggest up to {SuggestionStatuses.MaxPerRun} new product ideas from what {at.Node.Name} already holds: for each, the gap it fills, why this organisation is placed to build it, and what it would reuse.",
            }),
        ], null, by, cancellationToken);
        return new SuggestionsStarted(run, estimate);
    }

    /// <summary>The characters of context a run at the scope will read: what its estimate is priced on.</summary>
    public async Task<int> ContextSizeAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        var context = await ContextAsync(await ProposalScopeAsync(scope, cancellationToken), cancellationToken);
        return System.Text.Json.JsonSerializer.Serialize(context).Length + 2_000;
    }

    public async Task<SuggestionContext> ContextForRunAsync(Guid runId, CancellationToken cancellationToken)
    {
        var (run, scope) = await runs.RequireAsync(runId, cancellationToken);
        if (run.Kind != RunKinds.Suggest)
        {
            throw EndgameProblem.Conflict("That run does not suggest ideas.");
        }

        return await ContextAsync(scope, cancellationToken);
    }

    /// <summary>The Runner's result: one to five suggestions, recorded against the run.</summary>
    public async Task<IReadOnlyList<SuggestionView>> RecordAsync(Guid runId, IReadOnlyList<SuggestionInput>? suggestions, CancellationToken cancellationToken)
    {
        var (run, scope) = await runs.RequireAsync(runId, cancellationToken);
        if (run.Kind != RunKinds.Suggest)
        {
            throw EndgameProblem.Conflict("That run does not suggest ideas.");
        }

        if (RunStatuses.IsTerminal(run.Status))
        {
            throw EndgameProblem.Conflict($"The run has {run.Status}; it records nothing more.");
        }

        var list = suggestions ?? [];
        if (list.Count is 0 or > SuggestionStatuses.MaxPerRun)
        {
            throw EndgameProblem.Invalid($"Send 1 to {SuggestionStatuses.MaxPerRun} suggestions.");
        }

        session.UseOrganisation(run.OrganisationId);
        if (await db.IdeaSuggestions.AnyAsync(s => s.OrganisationId == run.OrganisationId && s.RunId == runId, cancellationToken))
        {
            throw EndgameProblem.Conflict("This run's suggestions are already recorded.");
        }

        var now = clock.GetUtcNow();
        var records = list.Select(s => new IdeaSuggestionRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = run.OrganisationId,
            DivisionId = run.DivisionId,
            ProjectId = run.ProjectId,
            AppId = run.AppId,
            RunId = runId,
            Title = Required(s.Title, "title", 200),
            Idea = Required(s.Idea, "idea", 4000),
            Gap = Required(s.Gap, "gap", 2000),
            WhyUs = Required(s.WhyUs, "whyUs", 2000),
            Reuses = (s.Reuses ?? []).Select(r => r.Trim()).Where(r => r.Length > 0).Select(r => r.Length > 300 ? r[..300] : r).Take(20).ToArray(),
            Status = SuggestionStatuses.Open,
            CreatedAt = now,
        }).ToList();
        db.IdeaSuggestions.AddRange(records);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return records.Select(r => View(r, scope.Path.ToString())).ToList();
    }

    /// <summary>Suggestions at the scope and beneath it, newest first.</summary>
    public async Task<IReadOnlyList<SuggestionView>> ListAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        session.UseOrganisation(scope.OrganisationId);
        var rows = await db.IdeaSuggestions.AsNoTracking()
            .Where(s => s.OrganisationId == scope.OrganisationId)
            .Where(s => scope.DivisionId == null || s.DivisionId == scope.DivisionId)
            .OrderByDescending(s => s.CreatedAt).Take(100).ToListAsync(cancellationToken);
        var views = new List<SuggestionView>();
        foreach (var r in rows)
        {
            views.Add(View(r, (await scopes.ForRowAsync(r.OrganisationId, r.DivisionId, r.ProjectId, r.AppId, cancellationToken)).Path.ToString()));
        }

        return views;
    }

    public async Task<(IdeaSuggestionRecord Suggestion, ResolvedScope Scope)> RequireAsync(Guid id, CancellationToken cancellationToken)
    {
        var org = await scopes.OrganisationOfAsync(db.IdeaSuggestions, q => q.Where(s => s.Id == id).Select(s => s.OrganisationId), cancellationToken)
            ?? throw EndgameProblem.NotFound("The suggestion");
        var row = await db.IdeaSuggestions.AsNoTracking().SingleAsync(s => s.OrganisationId == org && s.Id == id, cancellationToken);
        return (row, await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken));
    }

    /// <summary>One click: the suggestion becomes an idea and its research is queued, estimate first, like any other.</summary>
    public async Task<IdeaStarted> TakeAsync(Guid id, IReadOnlyList<string>? constraints, decimal researchEstimate, Guid by, CancellationToken cancellationToken)
    {
        var (suggestion, scope) = await RequireAsync(id, cancellationToken);
        if (suggestion.Status != SuggestionStatuses.Open)
        {
            throw EndgameProblem.Conflict($"This suggestion is already {suggestion.Status}.");
        }

        var started = await ideas.CreateAsync(scope, IdeaText(suggestion), constraints, researchEstimate, by, cancellationToken, via: "suggestion");
        session.UseOrganisation(suggestion.OrganisationId);
        await db.IdeaSuggestions.Where(s => s.OrganisationId == suggestion.OrganisationId && s.Id == id && s.Status == SuggestionStatuses.Open)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.Status, SuggestionStatuses.Taken).SetProperty(s => s.IdeaId, started.Idea.Id)
                .SetProperty(s => s.DecidedAt, clock.GetUtcNow()).SetProperty(s => s.DecidedBy, by), cancellationToken);
        return started;
    }

    public async Task<SuggestionView> DismissAsync(Guid id, Guid by, CancellationToken cancellationToken)
    {
        var (suggestion, scope) = await RequireAsync(id, cancellationToken);
        if (suggestion.Status != SuggestionStatuses.Open)
        {
            throw EndgameProblem.Conflict($"This suggestion is already {suggestion.Status}.");
        }

        session.UseOrganisation(suggestion.OrganisationId);
        var now = clock.GetUtcNow();
        await db.IdeaSuggestions.Where(s => s.OrganisationId == suggestion.OrganisationId && s.Id == id)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.Status, SuggestionStatuses.Dismissed).SetProperty(s => s.DecidedAt, now).SetProperty(s => s.DecidedBy, by), cancellationToken);
        suggestion.Status = SuggestionStatuses.Dismissed;
        return View(suggestion, scope.Path.ToString());
    }

    /// <summary>The words the idea starts from: what the suggestion said, so research has the whole of it.</summary>
    public static string IdeaText(IdeaSuggestionRecord s)
    {
        ArgumentNullException.ThrowIfNull(s);
        var reuse = s.Reuses.Length == 0 ? "" : $"\n\nIt would reuse: {string.Join("; ", s.Reuses)}.";
        return $"{s.Title}\n\n{s.Idea}\n\nThe gap it fills: {s.Gap}\n\nWhy we are placed to build it: {s.WhyUs}{reuse}";
    }

    /// <summary>Like ideas, suggestions are made to the organisation or a division; from deeper, to the division.</summary>
    private async Task<ResolvedScope> ProposalScopeAsync(ResolvedScope scope, CancellationToken cancellationToken) =>
        scope.Level > NodeLevel.Division
            ? await scopes.RequireAsync(ScopePath.Of(scope.Path.Organisation, scope.Path.Division!).ToString(), cancellationToken)
            : scope;

    private async Task<SuggestionContext> ContextAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        var org = scope.OrganisationId;
        session.UseOrganisation(org);
        var orgSlug = scope.Nodes[0].Slug;
        var divisions = await db.Divisions.AsNoTracking().Where(d => d.OrganisationId == org && (scope.DivisionId == null || d.Id == scope.DivisionId)).ToListAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(p => p.OrganisationId == org && (scope.DivisionId == null || p.DivisionId == scope.DivisionId)).ToListAsync(cancellationToken);
        var projectIds = projects.Select(p => p.Id).ToList();
        var apps = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == org && projectIds.Contains(a.ProjectId)).ToListAsync(cancellationToken);
        var products = new List<SuggestionProduct>();
        foreach (var d in divisions.OrderBy(d => d.Name))
        {
            products.Add(new SuggestionProduct("division", $"{orgSlug}/{d.Slug}", d.Name, d.Status));
            foreach (var p in projects.Where(p => p.DivisionId == d.Id).OrderBy(p => p.Name))
            {
                products.Add(new SuggestionProduct("project", $"{orgSlug}/{d.Slug}/{p.Slug}", p.Name, p.Status));
                products.AddRange(apps.Where(a => a.ProjectId == p.Id).OrderBy(a => a.Name).Select(a => new SuggestionProduct("app", $"{orgSlug}/{d.Slug}/{p.Slug}/{a.Slug}", a.Name, a.Status)));
            }
        }

        var ideaRows = await db.Ideas.AsNoTracking().Where(i => i.OrganisationId == org && (scope.DivisionId == null || i.DivisionId == scope.DivisionId))
            .OrderByDescending(i => i.CreatedAt).Take(100).Select(i => new { i.Text, i.Status, i.Verdict }).ToListAsync(cancellationToken);
        var previous = await db.IdeaSuggestions.AsNoTracking().Where(s => s.OrganisationId == org && (scope.DivisionId == null || s.DivisionId == scope.DivisionId))
            .OrderByDescending(s => s.CreatedAt).Take(50).Select(s => s.Title).ToListAsync(cancellationToken);
        var context = (await cascade.ResolveAsync(scope, CascadeKind.Context, cancellationToken))
            .Select(c => $"{c.Key}: {c.Value?.ToJsonString()}").ToList();
        return new SuggestionContext(scope.Path.ToString(), scope.Nodes[0].Name, products,
            ideaRows.Select(i => new SuggestionIdea(ReadModels.IdeaTitle(i.Text), i.Status, i.Verdict)).ToList(), context, previous, SuggestionStatuses.MaxPerRun);
    }

    private static string Required(string? value, string field, int max)
    {
        var trimmed = value?.Trim() ?? "";
        return trimmed.Length is > 0 && trimmed.Length <= max ? trimmed : throw EndgameProblem.Invalid($"Each suggestion has a {field} of 1 to {max} characters.");
    }

    private static SuggestionView View(IdeaSuggestionRecord r, string scope) =>
        new(r.Id, scope, r.RunId, r.Title, r.Idea, r.Gap, r.WhyUs, r.Reuses, r.Status, r.IdeaId, r.CreatedAt);
}
