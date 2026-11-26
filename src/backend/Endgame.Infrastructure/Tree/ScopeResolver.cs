using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Tree;

/// <summary>
/// Turns a scope path, or a node's id, into the nodes it names. The lookup itself crosses
/// organisations (the organisation is what it finds out), so it runs as the platform; the session is
/// then confined to the organisation found, and everything after it is under row-level security.
/// </summary>
public sealed class ScopeResolver(EndgameDbContext db, TenantSession session)
{
    public async Task<ResolvedScope> RequireAsync(string? scope, CancellationToken cancellationToken)
    {
        ScopePath path;
        try
        {
            path = ScopePath.Parse(scope);
        }
        catch (DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }

        return await FindAsync(path, cancellationToken) ?? throw EndgameProblem.NotFound($"The scope '{path}'");
    }

    public async Task<ResolvedScope?> FindAsync(ScopePath path, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var org = await db.Organisations.AsNoTracking().SingleOrDefaultAsync(o => o.Slug == path.Organisation, cancellationToken);
        if (org is null)
        {
            session.Clear();
            return null;
        }

        var nodes = new List<ScopeNode> { new(NodeLevel.Organisation, org.Id, org.Slug, org.Name, org.Status, org.Slug) };
        Guid? divisionId = null, projectId = null, appId = null;
        if (path.Division is { } divisionSlug)
        {
            var division = await db.Divisions.AsNoTracking().SingleOrDefaultAsync(d => d.OrganisationId == org.Id && d.Slug == divisionSlug, cancellationToken);
            if (division is null)
            {
                session.Clear();
                return null;
            }

            divisionId = division.Id;
            nodes.Add(new(NodeLevel.Division, division.Id, division.Slug, division.Name, division.Status, $"{org.Slug}/{division.Slug}"));
            if (path.Project is { } projectSlug)
            {
                var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(p => p.DivisionId == division.Id && p.Slug == projectSlug, cancellationToken);
                if (project is null)
                {
                    session.Clear();
                    return null;
                }

                projectId = project.Id;
                nodes.Add(new(NodeLevel.Project, project.Id, project.Slug, project.Name, project.Status, $"{nodes[^1].Path}/{project.Slug}"));
                if (path.App is { } appSlug)
                {
                    var app = await db.Apps.AsNoTracking().SingleOrDefaultAsync(a => a.ProjectId == project.Id && a.Slug == appSlug, cancellationToken);
                    if (app is null)
                    {
                        session.Clear();
                        return null;
                    }

                    appId = app.Id;
                    nodes.Add(new(NodeLevel.App, app.Id, app.Slug, app.Name, app.Status, $"{nodes[^1].Path}/{app.Slug}"));
                }
            }
        }

        session.UseOrganisation(org.Id);
        return new ResolvedScope(path, org.Id, divisionId, projectId, appId, nodes);
    }

    /// <summary>The scope of a node known by id. Null when no such node exists.</summary>
    public async Task<ResolvedScope?> FindNodeAsync(NodeLevel level, Guid id, CancellationToken cancellationToken)
    {
        session.UseSystem();
        string? path = level switch
        {
            NodeLevel.Organisation => await db.Organisations.AsNoTracking().Where(o => o.Id == id).Select(o => o.Slug).SingleOrDefaultAsync(cancellationToken),
            NodeLevel.Division => await (from d in db.Divisions
                                         join o in db.Organisations on d.OrganisationId equals o.Id
                                         where d.Id == id
                                         select o.Slug + "/" + d.Slug).SingleOrDefaultAsync(cancellationToken),
            NodeLevel.Project => await (from p in db.Projects
                                        join d in db.Divisions on p.DivisionId equals d.Id
                                        join o in db.Organisations on d.OrganisationId equals o.Id
                                        where p.Id == id
                                        select o.Slug + "/" + d.Slug + "/" + p.Slug).SingleOrDefaultAsync(cancellationToken),
            _ => await (from a in db.Apps
                        join p in db.Projects on a.ProjectId equals p.Id
                        join d in db.Divisions on p.DivisionId equals d.Id
                        join o in db.Organisations on d.OrganisationId equals o.Id
                        where a.Id == id
                        select o.Slug + "/" + d.Slug + "/" + p.Slug + "/" + a.Slug).SingleOrDefaultAsync(cancellationToken),
        };
        if (path is null)
        {
            session.Clear();
            return null;
        }

        return await FindAsync(ScopePath.Parse(path), cancellationToken);
    }

    /// <summary>The scope a scoped row sits at.</summary>
    public async Task<ResolvedScope> ForRowAsync(Guid organisationId, Guid? divisionId, Guid? projectId, Guid? appId, CancellationToken cancellationToken)
    {
        var level = appId is not null ? NodeLevel.App : projectId is not null ? NodeLevel.Project : divisionId is not null ? NodeLevel.Division : NodeLevel.Organisation;
        var id = appId ?? projectId ?? divisionId ?? organisationId;
        return await FindNodeAsync(level, id, cancellationToken) ?? throw EndgameProblem.NotFound("The scope of this record");
    }

    /// <summary>Finds which organisation owns a row of a tenant table, then confines the session to it.</summary>
    public async Task<Guid?> OrganisationOfAsync<T>(IQueryable<T> rows, Func<IQueryable<T>, IQueryable<Guid>> select, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(select);
        session.UseSystem();
        // Two are enough to tell "one owner" from "ambiguous"; ordered, so the limit is deterministic (D26).
        var ids = await select(rows).OrderBy(id => id).Take(2).ToListAsync(cancellationToken);
        if (ids.Count != 1)
        {
            session.Clear();
            return null;
        }

        session.UseOrganisation(ids[0]);
        return ids[0];
    }
}
