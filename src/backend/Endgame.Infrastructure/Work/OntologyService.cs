using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>
/// One thing in the organisation's graph. Ids are typed: <c>organisation:&lt;id&gt;</c>, <c>division:…</c>,
/// <c>project:…</c>, <c>app:…</c>, <c>employee:…</c>, <c>contractor:…</c>, <c>person:&lt;user id&gt;</c>,
/// <c>secret:&lt;node id&gt;:&lt;NAME&gt;</c>, <c>webhook:…</c>, <c>schedule:…</c> and <c>service:&lt;name&gt;</c>.
/// </summary>
public sealed record OntologyNode(string Id, string Type, string Name, string? Scope, string? Status, JsonObject? Attributes);

/// <summary>A typed relation: <c>owns</c>, <c>works-on</c>, <c>reports-to</c>, <c>depends-on</c> or <c>data-flows-to</c>.</summary>
public sealed record OntologyEdge(string From, string To, string Type, string? Label);

/// <summary>
/// <c>GET /api/ontology?scope=</c>: the organisation at and beneath a scope as a graph, derived on read
/// from what already exists. <c>views</c> names the edge types of the org-chart and data-flow views.
/// </summary>
public sealed record OntologyView(string Scope, DateTimeOffset GeneratedAt, IReadOnlyList<OntologyNode> Nodes, IReadOnlyList<OntologyEdge> Edges, IReadOnlyDictionary<string, IReadOnlyList<string>> Views);

/// <summary>
/// The ontology (spec, <i>Layer 1</i>): entities, who is responsible for what, what depends on what and
/// how data flows — derived on every read from the tree, the workforce, the members, the vault's names,
/// the apps' declarations and the platform services each app has actually used. It stores nothing:
/// there is no second source of truth to drift.
/// </summary>
public sealed class OntologyService(EndgameDbContext db, TenantSession session, MemoryService memory, TimeProvider clock)
{
    public const string Owns = "owns";
    public const string WorksOn = "works-on";
    public const string ReportsTo = "reports-to";
    public const string DependsOn = "depends-on";
    public const string DataFlowsTo = "data-flows-to";

    public static readonly IReadOnlyList<string> EdgeTypes = [Owns, WorksOn, ReportsTo, DependsOn, DataFlowsTo];

    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Views = new Dictionary<string, IReadOnlyList<string>>
    {
        ["org-chart"] = [Owns, WorksOn, ReportsTo],
        ["data-flow"] = [DependsOn, DataFlowsTo],
    };

    public async Task<OntologyView> BuildAsync(ResolvedScope scope, string? view, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var org = scope.OrganisationId;
        session.UseOrganisation(org);
        var nodes = new Dictionary<string, OntologyNode>(StringComparer.Ordinal);
        var edges = new List<OntologyEdge>();
        void Node(OntologyNode n) => nodes.TryAdd(n.Id, n);
        void Edge(string from, string to, string type, string? label = null) => edges.Add(new OntologyEdge(from, to, type, label));

        var paths = await memory.PathsAsync(org, cancellationToken);
        var organisation = await db.Organisations.AsNoTracking().SingleAsync(o => o.Id == org, cancellationToken);
        var divisions = await db.Divisions.AsNoTracking().Where(d => d.OrganisationId == org && (scope.DivisionId == null || d.Id == scope.DivisionId)).ToListAsync(cancellationToken);
        var projects = await db.Projects.AsNoTracking().Where(p => p.OrganisationId == org && (scope.DivisionId == null || p.DivisionId == scope.DivisionId) && (scope.ProjectId == null || p.Id == scope.ProjectId)).ToListAsync(cancellationToken);
        var projectIds = projects.Select(p => p.Id).ToHashSet();
        var apps = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == org && (scope.AppId == null || a.Id == scope.AppId)).ToListAsync(cancellationToken);
        apps = apps.Where(a => projectIds.Contains(a.ProjectId)).ToList();
        var appIds = apps.Select(a => a.Id).ToList();

        // The tree: who owns what.
        string Key(IScopedRecord r) => r.AppId is { } a ? $"app:{a}" : r.ProjectId is { } p ? $"project:{p}" : r.DivisionId is { } d ? $"division:{d}" : $"organisation:{r.OrganisationId}";
        if (scope.DivisionId is null)
        {
            Node(new OntologyNode($"organisation:{org}", "organisation", organisation.Name, organisation.Slug, organisation.Status, null));
        }

        foreach (var d in divisions.Where(_ => scope.ProjectId is null))
        {
            var path = $"{organisation.Slug}/{d.Slug}";
            Node(new OntologyNode($"division:{d.Id}", "division", d.Name, path, d.Status, null));
            if (scope.DivisionId is null)
            {
                Edge($"organisation:{org}", $"division:{d.Id}", Owns);
            }
        }

        foreach (var p in projects.Where(_ => scope.AppId is null))
        {
            var division = divisions.FirstOrDefault(d => d.Id == p.DivisionId);
            Node(new OntologyNode($"project:{p.Id}", "project", p.Name, division is null ? null : $"{organisation.Slug}/{division.Slug}/{p.Slug}", p.Status, null));
            if (scope.ProjectId is null)
            {
                Edge($"division:{p.DivisionId}", $"project:{p.Id}", Owns);
            }
        }

        foreach (var a in apps)
        {
            var project = projects.First(p => p.Id == a.ProjectId);
            var division = divisions.First(d => d.Id == project.DivisionId);
            Node(new OntologyNode($"app:{a.Id}", "app", a.Name, $"{organisation.Slug}/{division.Slug}/{project.Slug}/{a.Slug}", a.Status,
                new JsonObject { ["version"] = a.CurrentVersion }));
            if (scope.AppId is null)
            {
                Edge($"project:{a.ProjectId}", $"app:{a.Id}", Owns);
            }
        }

        bool InScope(IScopedRecord r) => scope.Contains(r);

        // The workforce: who works on what, and to whom they report.
        var workforce = (await db.Employees.AsNoTracking().Where(e => e.OrganisationId == org && e.Status != EmployeeStatuses.Released).ToListAsync(cancellationToken))
            .Where(InScope).ToList();
        var runIds = workforce.Select(e => e.CurrentRunId).OfType<Guid>().ToList();
        var currentRuns = await db.Runs.AsNoTracking().Where(r => r.OrganisationId == org && runIds.Contains(r.Id)).ToListAsync(cancellationToken);
        foreach (var e in workforce)
        {
            var id = $"{e.Kind}:{e.Id}";
            Node(new OntologyNode(id, e.Kind, e.Name, paths(e), e.Status, new JsonObject
            {
                ["role"] = e.Role,
                ["standing"] = e.Standing,
                ["modelTier"] = e.ModelTier,
                ["monthlyCreditLimit"] = e.MonthlyCreditLimit,
            }));
            if (nodes.ContainsKey(Key(e)))
            {
                Edge(id, Key(e), WorksOn, e.Role);
            }

            if (currentRuns.FirstOrDefault(r => r.Id == e.CurrentRunId) is { } run && Key(run) != Key(e) && nodes.ContainsKey(Key(run)))
            {
                Edge(id, Key(run), WorksOn, $"now: {run.Title}");
            }

            if (e.ReportsToId is { } manager && workforce.Any(w => w.Id == manager))
            {
                Edge(id, $"employee:{manager}", ReportsTo);
            }

            if (e.BriefedById is { } briefer && workforce.Any(w => w.Id == briefer))
            {
                Edge(id, $"employee:{briefer}", ReportsTo, "briefed by");
            }
        }

        // People: members and the role each holds where.
        var grants = (await (from m in db.Memberships.AsNoTracking()
                             join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                             where m.OrganisationId == org
                             select new { Membership = m, u.DisplayName }).ToListAsync(cancellationToken))
            .Where(g => InScope(g.Membership)).ToList();
        foreach (var g in grants)
        {
            Node(new OntologyNode($"person:{g.Membership.UserId}", "person", g.DisplayName, null, null, null));
            if (nodes.ContainsKey(Key(g.Membership)))
            {
                Edge($"person:{g.Membership.UserId}", Key(g.Membership), WorksOn, g.Membership.Role);
            }
        }

        // The vault, by name only: each secret is owned by the node it is set at.
        var secrets = (await db.CascadeEntries.AsNoTracking().Where(e => e.OrganisationId == org && e.Kind == "secret").ToListAsync(cancellationToken)).Where(InScope);
        foreach (var s in secrets)
        {
            var id = $"secret:{s.NodeId()}:{s.Key}";
            Node(new OntologyNode(id, "secret", s.Key, paths(s), null, null));
            if (nodes.ContainsKey(Key(s)))
            {
                Edge(Key(s), id, Owns);
            }
        }

        // Each app's declarations and the platform services it has actually used.
        var webhooks = await db.AppWebhooks.AsNoTracking().Where(w => w.OrganisationId == org && appIds.Contains(w.AppId)).ToListAsync(cancellationToken);
        var schedules = await db.AppSchedules.AsNoTracking().Where(x => x.OrganisationId == org && appIds.Contains(x.AppId)).ToListAsync(cancellationToken);
        var usedModels = (await db.CreditEntries.AsNoTracking().Where(c => c.OrganisationId == org && c.AppId != null && appIds.Contains(c.AppId.Value) && c.TaskType != null && c.TaskType.StartsWith("app."))
            .Select(c => c.AppId!.Value).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var usedEmail = (await db.EmailMessages.AsNoTracking().Where(m => m.OrganisationId == org && m.AppId != null && appIds.Contains(m.AppId.Value)).Select(m => m.AppId!.Value).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var usedIdentity = (await db.AppEndUsers.AsNoTracking().Where(u => u.OrganisationId == org && appIds.Contains(u.AppId)).Select(u => u.AppId).Distinct().ToListAsync(cancellationToken)).ToHashSet();
        var usedTelemetry = (await db.TelemetryEvents.AsNoTracking().Where(t => t.OrganisationId == org && appIds.Contains(t.AppId)).Select(t => t.AppId).Distinct().ToListAsync(cancellationToken))
            .Concat(await db.TelemetrySpans.AsNoTracking().Where(t => t.OrganisationId == org && appIds.Contains(t.AppId)).Select(t => t.AppId).Distinct().ToListAsync(cancellationToken))
            .Concat(await db.TelemetryMetrics.AsNoTracking().Where(t => t.OrganisationId == org && appIds.Contains(t.AppId)).Select(t => t.AppId).Distinct().ToListAsync(cancellationToken))
            .Concat(await db.TelemetryLogs.AsNoTracking().Where(t => t.OrganisationId == org && appIds.Contains(t.AppId)).Select(t => t.AppId).Distinct().ToListAsync(cancellationToken))
            .ToHashSet();
        string Service(string name)
        {
            Node(new OntologyNode($"service:{name}", "service", name, null, null, null));
            return $"service:{name}";
        }

        foreach (var w in webhooks)
        {
            Node(new OntologyNode($"webhook:{w.Id}", "webhook", w.Name, null, null, new JsonObject { ["path"] = w.Path }));
            Edge($"app:{w.AppId}", $"webhook:{w.Id}", Owns);
            Edge($"app:{w.AppId}", Service("webhooks"), DependsOn);
            Edge($"webhook:{w.Id}", $"app:{w.AppId}", DataFlowsTo, "inbound calls");
        }

        foreach (var x in schedules)
        {
            Node(new OntologyNode($"schedule:{x.Id}", "schedule", x.Name, null, null, new JsonObject { ["cron"] = x.Cron, ["timeZone"] = x.TimeZone }));
            Edge($"app:{x.AppId}", $"schedule:{x.Id}", Owns);
            Edge($"app:{x.AppId}", Service("schedules"), DependsOn);
            Edge($"schedule:{x.Id}", $"app:{x.AppId}", DataFlowsTo, "scheduled calls");
        }

        foreach (var a in appIds)
        {
            if (usedModels.Contains(a))
            {
                Edge($"app:{a}", Service("models"), DependsOn);
                Edge($"app:{a}", Service("models"), DataFlowsTo, "prompts");
            }

            if (usedEmail.Contains(a))
            {
                Edge($"app:{a}", Service("email"), DependsOn);
                Edge($"app:{a}", Service("email"), DataFlowsTo, "outbound mail");
            }

            if (usedIdentity.Contains(a))
            {
                Edge($"app:{a}", Service("identity"), DependsOn);
                Edge(Service("identity"), $"app:{a}", DataFlowsTo, "signed-in end users");
            }

            if (usedTelemetry.Contains(a))
            {
                Edge($"app:{a}", Service("telemetry"), DependsOn);
                Edge($"app:{a}", Service("telemetry"), DataFlowsTo, "operational telemetry");
            }
        }

        var kept = view switch
        {
            null or "" or "all" => EdgeTypes,
            _ when Views.TryGetValue(view, out var types) => types,
            _ => throw Application.Common.EndgameProblem.Invalid($"view is all, {string.Join(", ", Views.Keys)}."),
        };
        var shown = edges.Where(e => kept.Contains(e.Type)).Distinct().ToList();
        var used = shown.SelectMany(e => new[] { e.From, e.To }).ToHashSet(StringComparer.Ordinal);
        var shownNodes = nodes.Values.Where(n => view is null or "" or "all" || used.Contains(n.Id) || n.Type is "organisation" or "division" or "project" or "app").ToList();
        return new OntologyView(scope.Path.ToString(), clock.GetUtcNow(), shownNodes, shown, Views);
    }
}
