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

/// <summary>
/// Who may act as FrostAura across organisations (God mode): an explicit list of e-mail addresses
/// and nothing else, from <c>ENDGAME_OPERATORS</c> (comma-, semicolon- or space-separated) and/or
/// <c>Operators:Emails</c>. No address is an operator by its domain: e-mail is not verified, so
/// anyone could type one.
/// </summary>
public sealed class OperatorOptions
{
    public const string SectionName = "Operators";
    public const string Variable = "ENDGAME_OPERATORS";

    public List<string> Emails { get; set; } = [];

    /// <summary>How long one operator's entry into one organisation counts as the same visit in the audit log.</summary>
    public int EntryLogWindowMinutes { get; set; } = 10;

    public IReadOnlySet<string> All(string? variable) =>
        Emails.Concat((variable ?? "").Split([',', ';', ' ', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Select(e => e.Trim().ToLowerInvariant())
            .Where(e => e.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
}

/// <summary>
/// The four roles, resolved through the cascade: what a person may do at a scope is the deepest grant
/// on the chain from the organisation down to it, except that the organisation's Owner may do
/// everything (<see cref="RoleResolver"/>). Every public endpoint asks here before it acts.
/// </summary>
public sealed class AccessService(EndgameDbContext db, ScopeResolver scopes, TenantSession session, IOptions<OperatorOptions> operators,
    Microsoft.Extensions.Configuration.IConfiguration configuration, TimeProvider clock)
{
    public const string EntryAction = "organisation.entered";

    private IReadOnlySet<string>? operatorEmails;
    private readonly Dictionary<Guid, bool> operatorById = [];

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
            ?? await OperatorEntryAsync(userId, scope, cancellationToken)
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
        return IsOperatorEmail(user.Email);
    }

    public bool IsOperatorEmail(string? email)
    {
        operatorEmails ??= operators.Value.All(configuration[OperatorOptions.Variable]);
        return email is { Length: > 0 } && operatorEmails.Contains(email.Trim().ToLowerInvariant());
    }

    public async Task<bool> IsOperatorAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (!operatorById.TryGetValue(userId, out var isOperator))
        {
            var email = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync(cancellationToken);
            operatorById[userId] = isOperator = IsOperatorEmail(email);
        }

        return isOperator;
    }

    /// <summary>
    /// God mode (spec): an operator with no role in the organisation enters it as an Admin — never as
    /// its Owner — and the entry is written to the organisation's operator log, which its Owner reads
    /// (CLAUDE.md rule 1). Repeated requests within the log window count as one entry. Null for
    /// anyone who is not an operator.
    /// </summary>
    public async Task<RoleGrant?> OperatorEntryAsync(Guid userId, ResolvedScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        if (!await IsOperatorAsync(userId, cancellationToken))
        {
            return null;
        }

        await RecordEntryAsync(userId, scope.OrganisationId, scope.Path.ToString(), cancellationToken);
        return new RoleGrant(userId, MemberRole.Admin, NodeLevel.Organisation, scope.OrganisationId, scope.Nodes[0].Path);
    }

    /// <summary>Writes one <c>organisation.entered</c> row unless this operator entered this organisation within the window.</summary>
    public async Task RecordEntryAsync(Guid operatorId, Guid organisationId, string scope, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var now = clock.GetUtcNow();
        await using var command = await db.CommandAsync("""
            INSERT INTO operator_actions (id, organisation_id, operator_user_id, action, detail, at)
            SELECT gen_random_uuid(), @org, @operator, @action, jsonb_build_object('scope', @scope::text), @now
            WHERE NOT EXISTS (SELECT 1 FROM operator_actions
                              WHERE organisation_id = @org AND operator_user_id = @operator AND action = @action AND at > @since)
            """, cancellationToken,
            Db.P("org", organisationId), Db.P("operator", operatorId), Db.P("action", EntryAction), Db.P("scope", scope),
            Db.P("now", now), Db.P("since", now.AddMinutes(-Math.Max(0, operators.Value.EntryLogWindowMinutes))));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

public sealed record MembershipView(Guid Id, string Scope, string Level, string Role, Guid OrganisationId, string OrganisationSlug, string OrganisationName);
