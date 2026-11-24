namespace Endgame.Domain.Tree;

/// <summary>A project belongs to exactly one division, fixed when it is created.</summary>
public sealed class Project : TreeNode
{
    private Project(Guid id, Guid divisionId, string name, string slug, DateTimeOffset createdAt)
        : base(id, name, slug, createdAt)
    {
        DivisionId = RequireParent(divisionId, "project", "division");
    }

    public Guid DivisionId { get; private set; }

    public static Project Create(Division division, string name, string slug, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(division);
        return new Project(Guid.NewGuid(), division.Id, name, slug, createdAt);
    }
}
