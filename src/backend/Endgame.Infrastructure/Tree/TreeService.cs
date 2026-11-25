using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.Infrastructure.Tree;

/// <summary>Bound from <c>Addresses</c>: the two address shapes (spec, <i>Addresses and hosting</i>).</summary>
public sealed class AddressOptions
{
    public const string SectionName = "Addresses";

    /// <summary>The path form's host: <c>https://{PathHost}/{org}/{division}/{project}/{app}/</c>.</summary>
    public string PathHost { get; set; } = "endgame.frostaura.net";

    /// <summary>The subdomain form: <c>https://{org}.{OrganisationDomain}/{division}/{project}/{app}/</c>.</summary>
    public string OrganisationDomain { get; set; } = "frostaura.net";

    /// <summary>The scheme visitors use at both addresses: <c>https</c>, except a stack on a developer's machine.</summary>
    public string Scheme { get; set; } = "https";

    /// <summary>The port visitors use at both addresses; none (the scheme's default) unless set.</summary>
    public int? Port { get; set; }

    /// <summary><c>scheme://host[:port]</c> for <paramref name="host"/>.</summary>
    public string Origin(string host) => Port is { } port ? $"{Scheme}://{host}:{port}" : $"{Scheme}://{host}";
}

public sealed record NodeView(Guid Id, string Level, string Slug, string Name, string Path, string Status, DateTimeOffset CreatedAt);

public sealed record AppAddresses(string Path, string Subdomain);

public sealed record SleepSetting(string Mode, int IdleMinutes, string ModeSetAt, string IdleSetAt);

/// <param name="Access"><c>private</c>, <c>shared</c> or <c>public</c>, resolved down the cascade.</param>
/// <param name="Paused">True when the app must not be served: Edge shows the holding page. Nothing is deleted.</param>
/// <param name="PausedReason"><c>overdraft_limit</c> (the organisation's balance is past its overdraft limit) or <c>budget_exhausted</c> (a monthly budget on the app's chain is spent); null when not paused.</param>
/// <param name="Hooks">The app's declared webhook names: Edge admits <c>POST hooks/&lt;name&gt;</c> for these, even on a private app.</param>
public sealed record RouteView(Guid AppId, Guid OrganisationId, string Scope, string PathBase, string Host, string HostPathBase, string Target, string Status, bool Sleeping, SleepSetting Sleep, string? Version,
    string Access, bool Paused, string? PausedReason, IReadOnlyList<string> Hooks);

public sealed record RoutingTable(DateTimeOffset GeneratedAt, IReadOnlyList<RouteView> Routes);

/// <summary>The organisation tree: creating and changing its nodes, and reading it as one document.</summary>
public sealed class TreeService(
    EndgameDbContext db,
    TenantSession session,
    IOptions<AddressOptions> addresses,
    TimeProvider clock,
    IServiceProvider services)
{
    public const string DefaultSleepMode = "auto";
    public const int DefaultIdleMinutes = 15;

    /// <summary>Creates an organisation and makes <paramref name="owner"/> its Owner, in one transaction.</summary>
    public async Task<Organisation> CreateOrganisationAsync(string name, string slug, Guid owner, CancellationToken cancellationToken)
    {
        var organisation = Domain(() => Organisation.Create(name, slug, clock.GetUtcNow()));
        session.UseSystem();
        if (await db.Organisations.AnyAsync(o => o.Slug == organisation.Slug, cancellationToken))
        {
            throw EndgameProblem.Conflict($"An organisation is already called '{organisation.Slug}'.");
        }

        session.UseOrganisation(organisation.Id);
        // Joins the caller's transaction when there is one (first-run bootstrap creates the person too).
        await using var transaction = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(cancellationToken) : null;
        db.Organisations.Add(organisation);
        db.Memberships.Add(new MembershipRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisation.Id,
            UserId = owner,
            Role = MemberRole.Owner.ToWire(),
            GrantedBy = owner,
            GrantedAt = clock.GetUtcNow(),
        });
        // The one standing hire every organisation has from its creation (spec, Workforce).
        db.Employees.Add(Work.EmployeeService.SecurityReviewer(organisation.Id, clock.GetUtcNow()));
        await SaveAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        db.ChangeTracker.Clear();
        return organisation;
    }

    public async Task<NodeView> CreateChildAsync(ResolvedScope parent, string name, string slug, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(parent);
        var now = clock.GetUtcNow();
        TreeNode node;
        switch (parent.Level)
        {
            case NodeLevel.Organisation:
                var organisation = await db.Organisations.AsNoTracking().SingleAsync(o => o.Id == parent.OrganisationId, cancellationToken);
                var division = Domain(() => Division.Create(organisation, name, slug, now));
                db.Divisions.Add(division);
                node = division;
                break;
            case NodeLevel.Division:
                var owner = await db.Divisions.AsNoTracking().SingleAsync(d => d.OrganisationId == parent.OrganisationId && d.Id == parent.DivisionId, cancellationToken);
                var project = Domain(() => Project.Create(owner, name, slug, now));
                db.Projects.Add(project);
                node = project;
                break;
            case NodeLevel.Project:
                var home = await db.Projects.AsNoTracking().SingleAsync(p => p.OrganisationId == parent.OrganisationId && p.Id == parent.ProjectId, cancellationToken);
                var app = Domain(() => App.Create(home, name, slug, now));
                db.Apps.Add(app);
                node = app;
                break;
            default:
                throw EndgameProblem.Invalid("An app is the deepest level; nothing is created beneath it.");
        }

        await SaveAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(node, $"{parent.Path}/{node.Slug}");
    }

    /// <summary>
    /// The factory's placement: the child of <paramref name="parent"/> with this slug, created when
    /// there is none. Created is false when it already existed (also when a concurrent placement won).
    /// </summary>
    public async Task<(NodeView Node, bool Created)> EnsureChildAsync(ResolvedScope parent, NodeLevel level, string name, string slug, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(parent);
        if (parent.Level != level - 1)
        {
            throw EndgameProblem.Invalid($"{NodeLevels.Capitalised(level.WithArticle())} is created under {(level - 1).WithArticle()}; '{parent.Path}' is {parent.Level.WithArticle()}.");
        }

        var wanted = (slug ?? "").Trim().ToLowerInvariant();
        if (await FindChildAsync(parent, level, wanted, cancellationToken) is { } existing)
        {
            return (existing, false);
        }

        try
        {
            return (await CreateChildAsync(parent, name, wanted, cancellationToken), true);
        }
        catch (EndgameProblem problem) when (problem.Status == 409)
        {
            // A concurrent placement created it first.
            var raced = await FindChildAsync(parent, level, wanted, cancellationToken);
            if (raced is null)
            {
                throw;
            }

            return (raced, false);
        }
    }

    private async Task<NodeView?> FindChildAsync(ResolvedScope parent, NodeLevel level, string slug, CancellationToken cancellationToken)
    {
        TreeNode? node = level switch
        {
            NodeLevel.Division => await db.Divisions.AsNoTracking().SingleOrDefaultAsync(d => d.OrganisationId == parent.OrganisationId && d.Slug == slug, cancellationToken),
            NodeLevel.Project => await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.OrganisationId == parent.OrganisationId && p.DivisionId == parent.DivisionId && p.Slug == slug, cancellationToken),
            NodeLevel.App => await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.OrganisationId == parent.OrganisationId && a.ProjectId == parent.ProjectId && a.Slug == slug, cancellationToken),
            _ => throw EndgameProblem.Invalid("Placement creates a division, a project or an app."),
        };
        return node is null ? null : View(node, $"{parent.Path}/{node.Slug}");
    }

    public async Task<NodeView> UpdateAsync(ResolvedScope scope, string? name, string? status, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        TreeNode node = scope.Level switch
        {
            NodeLevel.Organisation => await db.Organisations.SingleAsync(o => o.Id == scope.OrganisationId, cancellationToken),
            NodeLevel.Division => await db.Divisions.SingleAsync(d => d.OrganisationId == scope.OrganisationId && d.Id == scope.DivisionId, cancellationToken),
            NodeLevel.Project => await db.Projects.SingleAsync(p => p.OrganisationId == scope.OrganisationId && p.Id == scope.ProjectId, cancellationToken),
            _ => await db.Apps.SingleAsync(a => a.OrganisationId == scope.OrganisationId && a.Id == scope.AppId, cancellationToken),
        };
        if (name is not null)
        {
            Domain(() => node.Rename(name));
        }

        if (status is not null)
        {
            Domain(() => node.ChangeStatus(status));
        }

        await SaveAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(node, scope.Path.ToString());
    }

    /// <summary>
    /// Deletes a node that has nothing hanging off it. A node with children, history or spend is refused
    /// by the database's restricting foreign keys; archive it instead.
    /// </summary>
    public async Task DeleteAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        try
        {
            // Settings, budgets and grants set on the node itself go with it.
            await db.CascadeEntries.Where(e => e.OrganisationId == scope.OrganisationId && e.DivisionId == scope.DivisionId && e.ProjectId == scope.ProjectId && e.AppId == scope.AppId).ExecuteDeleteAsync(cancellationToken);
            await db.Memberships.Where(m => m.OrganisationId == scope.OrganisationId && m.DivisionId == scope.DivisionId && m.ProjectId == scope.ProjectId && m.AppId == scope.AppId).ExecuteDeleteAsync(cancellationToken);
            var removed = scope.Level switch
            {
                NodeLevel.Organisation => await db.Organisations.Where(o => o.Id == scope.OrganisationId).ExecuteDeleteAsync(cancellationToken),
                NodeLevel.Division => await db.Divisions.Where(d => d.OrganisationId == scope.OrganisationId && d.Id == scope.DivisionId).ExecuteDeleteAsync(cancellationToken),
                NodeLevel.Project => await db.Projects.Where(p => p.OrganisationId == scope.OrganisationId && p.Id == scope.ProjectId).ExecuteDeleteAsync(cancellationToken),
                _ => await db.Apps.Where(a => a.OrganisationId == scope.OrganisationId && a.Id == scope.AppId).ExecuteDeleteAsync(cancellationToken),
            };
            if (removed == 0)
            {
                throw EndgameProblem.NotFound($"The scope '{scope.Path}'");
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw EndgameProblem.Conflict($"'{scope.Path}' still has children, work or credit history attached. Archive it instead (status: archived).");
        }
    }

    /// <summary>Dock reports a new running version of an app.</summary>
    public async Task<NodeView> PublishedAsync(ResolvedScope scope, string version, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var app = await db.Apps.SingleAsync(a => a.OrganisationId == scope.OrganisationId && a.Id == scope.AppId, cancellationToken);
        Domain(() => app.Published(version, clock.GetUtcNow()));
        await SaveAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return View(app, scope.Path.ToString());
    }

    /// <summary>Dock or the edge report that an app went to sleep, woke, stopped or failed.</summary>
    public async Task<NodeView> AppStateAsync(ResolvedScope scope, string status, CancellationToken cancellationToken)
    {
        if (status is not (NodeStatuses.Running or NodeStatuses.Sleeping or NodeStatuses.Stopped or NodeStatuses.Failed or NodeStatuses.Building))
        {
            throw EndgameProblem.Invalid("An app's reported state is building, running, sleeping, stopped or failed.");
        }

        return await UpdateAsync(scope, null, status, cancellationToken);
    }

    /// <summary>The edge's routing table: every app in every organisation (<c>GET /internal/routes</c>). Runs as the platform.</summary>
    public async Task<RoutingTable> RoutesAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var rows = await (from a in db.Apps.AsNoTracking()
                          join p in db.Projects.AsNoTracking() on a.ProjectId equals p.Id
                          join d in db.Divisions.AsNoTracking() on p.DivisionId equals d.Id
                          join o in db.Organisations.AsNoTracking() on d.OrganisationId equals o.Id
                          // An archived app, or one inside an archived project or division, is not served (TREE-07).
                          where a.Status != NodeStatuses.Archived && p.Status != NodeStatuses.Archived && d.Status != NodeStatuses.Archived && o.Status == NodeStatuses.Active
                          orderby o.Slug, d.Slug, p.Slug, a.Slug
                          select new { App = a, Org = o.Slug, Division = d.Slug, DivisionId = d.Id, Project = p.Slug }).ToListAsync(cancellationToken);
        string[] keys = [CascadeKeys.SleepMode, CascadeKeys.SleepIdleMinutes, CascadeKeys.Access, CascadeKeys.OverdraftLimit, CascadeKeys.OverdraftOwnLimit];
        var settingEntries = await db.CascadeEntries.AsNoTracking()
            .Where(e => (e.Kind == "setting" && keys.Contains(e.Key)) || (e.Kind == "budget" && e.Key == CascadeKeys.MonthlyCredits))
            .ToListAsync(cancellationToken);
        var hooks = (await db.AppWebhooks.AsNoTracking().Select(w => new { w.AppId, w.Name }).ToListAsync(cancellationToken))
            .ToLookup(w => w.AppId, w => w.Name);
        var ledger = services.GetRequiredService<Credits.CreditLedger>();
        session.UseSystem();
        var balances = await ledger.SettledBalancesAsync(cancellationToken);
        var spend = await MonthSpendByNodeAsync(cancellationToken);
        var routes = new List<RouteView>();
        foreach (var row in rows)
        {
            var path = ScopePath.Of(row.Org, row.Division, row.Project, row.App.Slug);
            var nodes = new[] { row.Org, $"{row.Org}/{row.Division}", $"{row.Org}/{row.Division}/{row.Project}", path.ToString() };
            var chainRows = settingEntries
                .Where(e => e.OrganisationId == row.App.OrganisationId
                    && (e.DivisionId == null || e.DivisionId == row.DivisionId)
                    && (e.ProjectId == null || e.ProjectId == row.App.ProjectId)
                    && (e.AppId == null || e.AppId == row.App.Id))
                .ToList();
            var chain = chainRows
                .Where(e => e.Kind == "setting")
                .Select(e => new CascadeEntry(CascadeKind.Setting, e.Key, e.ValueJson, e.Level(), e.NodeId(), nodes[(int)e.Level()], e.SetAt))
                .ToList();
            var sleep = Sleep(chain);
            var accessEntry = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.Access, chain);
            var access = accessEntry is not null && JsonNode.Parse(accessEntry.Entry.ValueJson)?.GetValue<string>() is { } a && AppAccess.All.Contains(a) ? a : AppAccess.Private;

            // At the limit (spec, Overdraft): apps pause behind a holding page; a top-up restores them at once.
            string? paused = null;
            var balance = balances.GetValueOrDefault(row.App.OrganisationId);
            if (balance + CascadeService.EffectiveOverdraft(chain) < 0)
            {
                paused = Application.Gateway.Refusals.OverdraftLimit;
            }
            else if (chainRows.Where(e => e.Kind == "budget").Any(e => CascadeService.NumberOf(JsonNode.Parse(e.ValueJson)) is { } cap
                && spend.GetValueOrDefault((e.OrganisationId, e.Level(), e.NodeId())) is var spent && spent > 0 && spent >= cap))
            {
                paused = Application.Gateway.Refusals.BudgetExhausted;
            }

            var tail = $"/{row.Division}/{row.Project}/{row.App.Slug}/";
            routes.Add(new RouteView(row.App.Id, row.App.OrganisationId, path.ToString(), $"/{path}/", $"{row.Org}.{addresses.Value.OrganisationDomain}", tail,
                $"http://app-{row.App.Id:N}:8080", row.App.Status, row.App.Status == NodeStatuses.Sleeping, sleep, row.App.CurrentVersion,
                access, paused is not null, paused, hooks[row.App.Id].Order(StringComparer.Ordinal).ToList()));
        }

        session.Clear();
        return new RoutingTable(clock.GetUtcNow(), routes);
    }

    /// <summary>This month's billable spend (model calls and hosting) at every node of every organisation. Runs as the platform.</summary>
    private async Task<Dictionary<(Guid Organisation, NodeLevel Level, Guid Node), decimal>> MonthSpendByNodeAsync(CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("""
            SELECT organisation_id, division_id, project_id, app_id, SUM(amount)
            FROM credit_entries
            WHERE kind IN ('settlement', 'hosting') AND billable AND created_at >= @month
            GROUP BY organisation_id, division_id, project_id, app_id
            """, cancellationToken, Db.P("month", Credits.CreditLedger.MonthStart(clock.GetUtcNow())));
        var spend = new Dictionary<(Guid, NodeLevel, Guid), decimal>();
        void Add(Guid org, NodeLevel level, Guid node, decimal amount) => spend[(org, level, node)] = spend.GetValueOrDefault((org, level, node)) + amount;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var org = reader.GetGuid(0);
            var amount = reader.GetDecimal(4);
            Add(org, NodeLevel.Organisation, org, amount);
            if (reader.GuidOrNull("division_id") is { } division)
            {
                Add(org, NodeLevel.Division, division, amount);
            }

            if (reader.GuidOrNull("project_id") is { } project)
            {
                Add(org, NodeLevel.Project, project, amount);
            }

            if (reader.GuidOrNull("app_id") is { } app)
            {
                Add(org, NodeLevel.App, app, amount);
            }
        }

        return spend;
    }

    public AppAddresses Addresses(ScopePath path)
    {
        ArgumentNullException.ThrowIfNull(path);
        var tail = string.Join('/', path.Segments.Skip(1));
        var o = addresses.Value;
        return new AppAddresses($"{o.Origin(o.PathHost)}/{path}/", $"{o.Origin($"{path.Organisation}.{o.OrganisationDomain}")}/{tail}/");
    }

    private static SleepSetting Sleep(IEnumerable<CascadeEntry> settings)
    {
        var list = settings.ToList();
        var mode = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.SleepMode, list);
        var idle = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.SleepIdleMinutes, list);
        return new SleepSetting(
            mode is null ? DefaultSleepMode : JsonNode.Parse(mode.Entry.ValueJson)?.ToString() ?? DefaultSleepMode,
            idle is null ? DefaultIdleMinutes : (int)(CascadeService.NumberOf(JsonNode.Parse(idle.Entry.ValueJson)) ?? DefaultIdleMinutes),
            mode?.Entry.Path ?? "default",
            idle?.Entry.Path ?? "default");
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            throw EndgameProblem.Conflict("A sibling already uses that slug.");
        }
    }

    private static T Domain<T>(Func<T> make)
    {
        try
        {
            return make();
        }
        catch (DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }
    }

    private static void Domain(Action act) => Domain(() =>
    {
        act();
        return 0;
    });

    private static NodeView View(TreeNode n, string path) => new(n.Id, n.Level.ToWire(), n.Slug, n.Name, path, n.Status, n.CreatedAt);
}
