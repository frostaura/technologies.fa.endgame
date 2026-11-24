namespace Endgame.Domain.Tree;

/// <summary>A project belongs to exactly one division, fixed when it is created.</summary>
public sealed class Project : TreeNode
{
    private Project(Guid id, Guid organisationId, Guid divisionId, string name, string slug, string status, DateTimeOffset createdAt)
        : base(id, organisationId, name, slug, status, createdAt)
    {
        DivisionId = RequireParent(divisionId, "project", "division");
    }

    public Guid DivisionId { get; private set; }

    public override NodeLevel Level => NodeLevel.Project;

    public static Project Create(Division division, string name, string slug, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(division);
        return new Project(Guid.NewGuid(), division.OrganisationId, division.Id, name, slug, NodeStatuses.Active, createdAt);
    }
}
