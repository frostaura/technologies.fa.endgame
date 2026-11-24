namespace Endgame.Domain.Tree;

/// <summary>
/// What every node of the cascade <c>Organisation → Division → Project → App</c> has: an id, the
/// organisation it belongs to, a display name, a slug, a status and the moment it was created. The
/// parent link is declared by each level, because each level has exactly one kind of parent.
/// </summary>
public abstract class TreeNode
{
    public const int MaxNameLength = 200;

    protected TreeNode(Guid id, Guid organisationId, string name, string slug, string status, DateTimeOffset createdAt)
    {
        if (id == Guid.Empty)
        {
            throw new DomainException("A node needs a non-empty id.");
        }

        Id = id;
        OrganisationId = organisationId == Guid.Empty
            ? throw new DomainException("A node belongs to exactly one organisation; none was given.")
            : organisationId;
        Name = RequireName(name);
        Slug = SlugRules.Require(slug);
        Status = NodeStatuses.Require(Level, status);
        CreatedAt = createdAt.ToUniversalTime();
    }

    public Guid Id { get; private set; }

    /// <summary>The organisation the node belongs to. For an organisation, its own id.</summary>
    public Guid OrganisationId { get; private set; }

    public string Name { get; private set; }

    public string Slug { get; private set; }

    public string Status { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public abstract NodeLevel Level { get; }

    public void Rename(string name) => Name = RequireName(name);

    public void ChangeStatus(string status) => Status = NodeStatuses.Require(Level, status);

    protected static Guid RequireParent(Guid parentId, string level, string parentLevel) =>
        parentId == Guid.Empty
            ? throw new DomainException($"A {level} belongs to exactly one {parentLevel}; none was given.")
            : parentId;

    private static string RequireName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new DomainException("A name cannot be empty.");
        }

        if (trimmed.Length > MaxNameLength)
        {
            throw new DomainException($"A name is at most {MaxNameLength} characters.");
        }

        return trimmed;
    }
}
