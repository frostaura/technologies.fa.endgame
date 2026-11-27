using Endgame.Domain.Tree;

namespace Endgame.Infrastructure.Tree;

/// <summary>
/// <c>GET /internal/contents</c>: everything at a scope and beneath it — its divisions, projects and apps, each app with its
/// state in words — and the counts, read from the same tree document home counts (R5-1). The conversation answers "how many
/// apps do we run?" from this, never from recent runs, which list only recent work.
/// </summary>
/// <param name="Summary">At the organisation, home's own line ("1 division · 3 projects · 3 apps · 2 employees"); null beneath it.</param>
public sealed record ScopeContentsView(string Scope, string Name, string Level, string? Summary, ContentsCounts Counts, IReadOnlyList<ContentsDivision> Divisions);

/// <param name="Apps">Every app beneath the scope, archived and never-built ones included, exactly as home counts them.</param>
/// <param name="AppsByState">How many apps are in each state (<see cref="ContentsApp.State"/>); only the states that occur.</param>
/// <param name="Employees">Employees (not contractors, not released) at the scope and beneath it.</param>
/// <param name="ContractorsWorking">Contractors working there now; never counted as employees.</param>
public sealed record ContentsCounts(int Divisions, int Projects, int Apps, IReadOnlyDictionary<string, int> AppsByState, int Employees, int ContractorsWorking);

public sealed record ContentsDivision(string Name, string Path, bool Archived, IReadOnlyList<ContentsProject> Projects);

/// <param name="Stage">As home shows it: researching, building, reviewing, live, planning, paused or not-built.</param>
public sealed record ContentsProject(string Name, string Path, string Stage, string? Note, IReadOnlyList<ContentsApp> Apps);

/// <param name="State">
/// <c>live</c> (running), <c>sleeping</c> (live, asleep until someone opens it), <c>building</c> (its first build is under
/// way), <c>never built</c> (its build stopped before anything was published), <c>not built yet</c> (no build has run),
/// <c>paused</c> (behind the holding page: a budget or the overdraft limit), <c>down</c> (it crashed), <c>stopped</c> or
/// <c>archived</c>.
/// </param>
/// <param name="Note">Why, in words, where the state needs one (the not-built or paused line).</param>
/// <param name="Health">healthy, degraded, down, unknown or paused, as home shows it.</param>
public sealed record ContentsApp(string Name, string Path, string State, string? Note, string Health, string Access);

public static class ScopeContents
{
    public const string Live = "live";
    public const string Sleeping = "sleeping";
    public const string Building = "building";
    public const string NeverBuilt = "never built";
    public const string NotBuiltYet = "not built yet";
    public const string Paused = "paused";
    public const string Down = "down";
    public const string Stopped = "stopped";
    public const string Archived = "archived";

    /// <summary>An app's state in one word or phrase, from the row home shows for it; the project's stage tells a first build under way.</summary>
    public static (string State, string? Note) StateOf(AppNodeView app, ProjectNodeView project)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(project);
        if (app.Archived || app.Status == NodeStatuses.Archived)
        {
            return (Archived, null);
        }

        if (app.NotBuilt is { } notBuilt)
        {
            return (NeverBuilt, notBuilt.Note);
        }

        if (app.Paused is { } paused)
        {
            return (Paused, paused.Note);
        }

        return app.Status switch
        {
            NodeStatuses.Running => (Live, null),
            NodeStatuses.Sleeping => (Sleeping, "Live; asleep until someone opens it, then it wakes."),
            NodeStatuses.Failed => (Down, "It crashed; its last good version can be restored from its history."),
            NodeStatuses.Stopped => (Stopped, null),
            NodeStatuses.Building => (Building, null),
            _ => project.Stage is "building" or "researching" or "reviewing" ? (Building, null) : (NotBuiltYet, null),
        };
    }

    /// <summary>
    /// The part of the organisation's tree document at <paramref name="scope"/> and beneath it. The tree is read as the
    /// organisation's Owner sees it, so at the organisation every count is home's own.
    /// </summary>
    public static ScopeContentsView From(TreeView tree, ResolvedScope scope)
    {
        ArgumentNullException.ThrowIfNull(tree);
        ArgumentNullException.ThrowIfNull(scope);
        var organisation = tree.Organisation;
        var orgSlug = organisation?.Slug ?? scope.Path.Organisation;
        var divisions = new List<ContentsDivision>();
        var workers = new List<WorkerView>();
        if (scope.DivisionId is null)
        {
            workers.AddRange(organisation?.Workers ?? []);
        }

        foreach (var d in tree.Divisions.Where(d => scope.DivisionId is null || d.Id == scope.DivisionId))
        {
            var dPath = $"{orgSlug}/{d.Slug}";
            if (scope.ProjectId is null)
            {
                workers.AddRange(d.Workers);
            }

            var projects = new List<ContentsProject>();
            foreach (var p in d.Projects.Where(p => scope.ProjectId is null || p.Id == scope.ProjectId))
            {
                var pPath = $"{dPath}/{p.Slug}";
                if (scope.AppId is null)
                {
                    workers.AddRange(p.Workers);
                }

                var apps = new List<ContentsApp>();
                foreach (var a in p.Apps.Where(a => scope.AppId is null || a.Id == scope.AppId))
                {
                    workers.AddRange(a.Workers);
                    var (state, note) = StateOf(a, p);
                    apps.Add(new ContentsApp(a.Name, $"{pPath}/{a.Slug}", state, note, a.Health, a.Access));
                }

                projects.Add(new ContentsProject(p.Name, pPath, p.Stage, p.Note, apps));
            }

            divisions.Add(new ContentsDivision(d.Name, dPath, d.Archived, projects));
        }

        var allApps = divisions.SelectMany(d => d.Projects).SelectMany(p => p.Apps).ToList();
        var byState = allApps.GroupBy(a => a.State).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.Ordinal);
        var counts = new ContentsCounts(
            scope.DivisionId is null ? divisions.Count : 0,
            scope.ProjectId is null ? divisions.Sum(d => d.Projects.Count) : 0,
            allApps.Count,
            byState,
            workers.Count(w => w.Kind == Domain.Workforce.EmployeeKinds.Employee),
            workers.Count(w => w.Kind == Domain.Workforce.EmployeeKinds.Contractor));
        return new ScopeContentsView(scope.Path.ToString(), scope.Node.Name, scope.Level.ToWire(),
            scope.Level == NodeLevel.Organisation ? organisation?.Summary : null, counts, divisions);
    }
}
