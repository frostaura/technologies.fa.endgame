using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Access;

/// <summary>Bound from <c>Operators</c>: who may act as FrostAura across organisations (God mode).</summary>
public sealed class OperatorOptions
{
    public const string SectionName = "Operators";

    /// <summary>Accounts on these e-mail domains are FrostAura operators (spec, <i>God mode</i>).</summary>
    public List<string> EmailDomains { get; set; } = ["frostaura.net"];
}

/// <summary>
/// The four roles, resolved through the cascade: what a person may do at a scope is the deepest grant
/// on the chain from the organisation down to it, except that the organisation's Owner may do
/// everything (<see cref="RoleResolver"/>). Every public endpoint asks here before it acts.
/// </summary>
public sealed class AccessService(EndgameDbContext db, ScopeResolver scopes, TenantSession session, IOptions<OperatorOptions> operators)
{
    /// <summary>The grants on the chain of <paramref name="scope"/> for one person.</summary>
    public async Task<IReadOnlyList<RoleGrant>> GrantsOnChainAsync(Guid userId, ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var rows = await db.Memberships.AsNoTracking()
            .Where(m => m.OrganisationId == scope.OrganisationId && m.UserId == userId)
            .Where(m => m.DivisionId == null || m.DivisionId == scope.DivisionId)
            .Where(m => m.ProjectId == null || m.ProjectId == scope.ProjectId)
            .Where(m => m.AppId == null || m.AppId == scope.AppId)
            .ToListAsync(cancellationToken);
        return rows.Select(r => new RoleGrant(r.UserId, MemberRoles.FromWire(r.Role), r.Level(), r.NodeId(), scope.PathAt(r.Level()))).ToList();
    }

    public async Task<RoleGrant?> EffectiveRoleAsync(Guid userId, ResolvedScope scope, CancellationToken cancellationToken) =>
        RoleResolver.Resolve(await GrantsOnChainAsync(userId, scope, cancellationToken));

    /// <summary>
    /// Resolves the scope and requires a role there. Someone with no role at all is told the scope does
    /// not exist, so the tree's shape is not disclosed to outsiders.
    /// </summary>
    public async Task<(ResolvedScope Scope, MemberRole Role)> RequireAsync(Guid userId, string? scope, MemberRole required, CancellationToken cancellationToken)
    {
        var resolved = await scopes.RequireAsync(scope, cancellationToken);
        return (resolved, await RequireAsync(userId, resolved, required, cancellationToken));
    }

    public async Task<MemberRole> RequireAsync(Guid userId, ResolvedScope scope, MemberRole required, CancellationToken cancellationToken)
    {
        var grant = await EffectiveRoleAsync(userId, scope, cancellationToken)
            ?? throw EndgameProblem.NotFound($"The scope '{scope.Path}'");
        return grant.Role.Allows(required)
            ? grant.Role
            : throw EndgameProblem.Forbidden($"This needs the {required.ToWire()} role at '{scope.Path}'; you are a {grant.Role.ToWire()} there (set at {grant.Path}).");
    }

    /// <summary>Every membership a person holds, in every organisation. Runs as the platform: it spans organisations.</summary>
    public async Task<IReadOnlyList<MembershipView>> MembershipsOfAsync(Guid userId, CancellationToken cancellationToken)
    {
        session.UseSystem();
        var rows = await db.Memberships.AsNoTracking().Where(m => m.UserId == userId).ToListAsync(cancellationToken);
        var views = new List<MembershipView>();
        foreach (var row in rows)
        {
            var scope = await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
            views.Add(new MembershipView(row.Id, scope.Path.ToString(), scope.Level.ToWire(), row.Role, scope.OrganisationId, scope.Nodes[0].Slug, scope.Nodes[0].Name));
        }

        session.Clear();
        return views.OrderBy(v => v.Scope, StringComparer.Ordinal).ToList();
    }

    /// <summary>Every grant a person holds anywhere in one organisation.</summary>
    public async Task<IReadOnlyList<RoleGrant>> GrantsInOrganisationAsync(Guid userId, Guid organisationId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var rows = await db.Memberships.AsNoTracking().Where(m => m.OrganisationId == organisationId && m.UserId == userId).ToListAsync(cancellationToken);
        var grants = new List<RoleGrant>();
        foreach (var row in rows)
        {
            var scope = await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, cancellationToken);
            grants.Add(new RoleGrant(row.UserId, MemberRoles.FromWire(row.Role), row.Level(), row.NodeId(), scope.Path.ToString()));
        }

        session.UseOrganisation(organisationId);
        return grants;
    }

    public bool IsOperator(EndgameUser user)
    {
        ArgumentNullException.ThrowIfNull(user);
        var email = user.Email ?? user.UserName ?? "";
        var at = email.LastIndexOf('@');
        return at > 0 && operators.Value.EmailDomains.Contains(email[(at + 1)..].ToLowerInvariant(), StringComparer.Ordinal);
    }
}

public sealed record MembershipView(Guid Id, string Scope, string Level, string Role, Guid OrganisationId, string OrganisationSlug, string OrganisationName);
