namespace Endgame.Domain.Tree;

/// <summary>An app belongs to exactly one project, fixed when it is created.</summary>
public sealed class App : TreeNode
{
    private App(Guid id, Guid projectId, string name, string slug, DateTimeOffset createdAt)
        : base(id, name, slug, createdAt)
    {
        ProjectId = RequireParent(projectId, "app", "project");
    }

    public Guid ProjectId { get; private set; }

    public static App Create(Project project, string name, string slug, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(project);
        return new App(Guid.NewGuid(), project.Id, name, slug, createdAt);
    }
}
