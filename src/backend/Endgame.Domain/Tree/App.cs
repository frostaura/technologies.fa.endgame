namespace Endgame.Domain.Tree;

/// <summary>
/// An app belongs to exactly one project, fixed when it is created. A new app is a draft until Dock
/// reports a running version; <see cref="CurrentVersion"/> is the version Dock last published.
/// </summary>
public sealed class App : TreeNode
{
    public const int MaxVersionLength = 100;

    private App(Guid id, Guid organisationId, Guid projectId, string name, string slug, string status, DateTimeOffset createdAt)
        : base(id, organisationId, name, slug, status, createdAt)
    {
        ProjectId = RequireParent(projectId, "app", "project");
    }

    public Guid ProjectId { get; private set; }

    public string? CurrentVersion { get; private set; }

    public DateTimeOffset? PublishedAt { get; private set; }

    public override NodeLevel Level => NodeLevel.App;

    public static App Create(Project project, string name, string slug, DateTimeOffset createdAt)
    {
        ArgumentNullException.ThrowIfNull(project);
        return new App(Guid.NewGuid(), project.OrganisationId, project.Id, name, slug, NodeStatuses.Draft, createdAt);
    }

    /// <summary>Dock reports a new running version.</summary>
    public void Published(string version, DateTimeOffset at)
    {
        var trimmed = version?.Trim();
        if (string.IsNullOrEmpty(trimmed) || trimmed.Length > MaxVersionLength)
        {
            throw new DomainException($"A published version is 1 to {MaxVersionLength} characters.");
        }

        CurrentVersion = trimmed;
        PublishedAt = at.ToUniversalTime();
        ChangeStatus(NodeStatuses.Running);
    }
}
