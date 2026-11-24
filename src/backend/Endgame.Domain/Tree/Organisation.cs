namespace Endgame.Domain.Tree;

/// <summary>The root of the cascade. It has no parent; its organisation id is its own id.</summary>
public sealed class Organisation : TreeNode
{
    private Organisation(Guid id, string name, string slug, string status, DateTimeOffset createdAt)
        : base(id, id, name, SlugRules.RequireOrganisationSlug(slug), status, createdAt)
    {
    }

    public override NodeLevel Level => NodeLevel.Organisation;

    public static Organisation Create(string name, string slug, DateTimeOffset createdAt) =>
        new(Guid.NewGuid(), name, slug, NodeStatuses.Active, createdAt);
}
