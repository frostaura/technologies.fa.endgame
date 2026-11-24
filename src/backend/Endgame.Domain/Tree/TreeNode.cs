namespace Endgame.Domain.Tree;

/// <summary>
/// What every node of the cascade <c>Organisation → Division → Project → App</c> has: an id, a
/// display name, a slug and the moment it was created. The parent link is declared by each level,
/// because each level has exactly one kind of parent.
/// </summary>
public abstract class TreeNode
{
    public const int MaxNameLength = 200;

    protected TreeNode(Guid id, string name, string slug, DateTimeOffset createdAt)
    {
        if (id == Guid.Empty)
        {
            throw new DomainException("A node needs a non-empty id.");
        }

        Id = id;
        Name = RequireName(name);
        Slug = SlugRules.Require(slug);
        CreatedAt = createdAt.ToUniversalTime();
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; }

    public string Slug { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public void Rename(string name) => Name = RequireName(name);

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
