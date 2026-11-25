using Endgame.Domain.Cascade;
using Endgame.Domain.Tree;

namespace Endgame.Domain.Access;

/// <summary>The four fixed member roles (spec), ordered by what they may do.</summary>
public enum MemberRole
{
    Viewer = 1,
    Builder = 2,
    Admin = 3,
    Owner = 4,
}

public static class MemberRoles
{
    public static readonly IReadOnlyList<string> All = ["owner", "admin", "builder", "viewer"];

    public static string ToWire(this MemberRole role) => role switch
    {
        MemberRole.Owner => "owner",
        MemberRole.Admin => "admin",
        MemberRole.Builder => "builder",
        MemberRole.Viewer => "viewer",
        _ => throw new DomainException($"Unknown role {role}."),
    };

    /// <summary>The role with its article, as a sentence says it: "an admin", "an owner", "a builder", "a viewer".</summary>
    public static string WithArticle(this MemberRole role) =>
        role is MemberRole.Admin or MemberRole.Owner ? $"an {role.ToWire()}" : $"a {role.ToWire()}";

    public static MemberRole FromWire(string? value) => value switch
    {
        "owner" => MemberRole.Owner,
        "admin" => MemberRole.Admin,
        "builder" => MemberRole.Builder,
        "viewer" => MemberRole.Viewer,
        _ => throw new DomainException($"'{value}' is not a role: use owner, admin, builder or viewer."),
    };

    public static bool Allows(this MemberRole held, MemberRole required) => held >= required;
}

/// <summary>A role granted to one person at one node.</summary>
public sealed record RoleGrant(Guid UserId, MemberRole Role, NodeLevel Level, Guid NodeId, string Path);

/// <summary>
/// A person's effective role at a scope, through the cascade: the deepest grant on the chain wins, so
/// one person can be a Builder in one division and a Viewer in another. The single exception is the
/// organisation's Owner, who may do everything everywhere — a grant lower down never narrows it.
/// </summary>
public static class RoleResolver
{
    public static RoleGrant? Resolve(IEnumerable<RoleGrant> chainGrants)
    {
        var grants = chainGrants.OrderBy(g => g.Level).ToList();
        var owner = grants.FirstOrDefault(g => g.Level == NodeLevel.Organisation && g.Role == MemberRole.Owner);
        return owner ?? grants.LastOrDefault();
    }

    /// <summary>The same walk, expressed through the generic resolver for the <c>permission</c> kind.</summary>
    public static CascadeEntry ToEntry(this RoleGrant grant, DateTimeOffset at) =>
        new(CascadeKind.Permission, grant.UserId.ToString(), $"\"{grant.Role.ToWire()}\"", grant.Level, grant.NodeId, grant.Path, at);
}
