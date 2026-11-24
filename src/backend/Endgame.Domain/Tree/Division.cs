namespace Endgame.Domain.Tree;

/// <summary>A division belongs to exactly one organisation, fixed when it is created.</summary>
public sealed class Division : TreeNode
{
    private Division(Guid id, Guid organisationId, string name, string slug, DateTimeOffset createdAt)
        : base(id, name, slug, createdAt)
    {
        OrganisationId = RequireParent(organisationId, "division", "organisation");
    }

    public Guid OrganisationId { get; private set; }

    public static Division Create(Organisation organisation, string name, string slug, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(organisation);
        return new Division(Guid.NewGuid(), organisation.Id, name, slug, createdAt);
    }
}
