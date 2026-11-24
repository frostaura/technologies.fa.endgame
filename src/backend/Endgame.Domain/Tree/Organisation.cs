namespace Endgame.Domain.Tree;

/// <summary>The root of the cascade. It has no parent.</summary>
public sealed class Organisation : TreeNode
{
    private Organisation(Guid id, string name, string slug, DateTimeOffset createdAt)
        : base(id, name, slug, createdAt)
    {
    }

    public static Organisation Create(string name, string slug, DateTimeOffset createdAt) =>
        new(Guid.NewGuid(), name, slug, createdAt);
}
