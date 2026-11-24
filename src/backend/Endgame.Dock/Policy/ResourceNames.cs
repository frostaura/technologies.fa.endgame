namespace Endgame.Dock.Policy;

/// <summary>
/// Every Docker resource Dock creates, named and labelled in one place. Names follow ARCH-004
/// (<c>app-&lt;app id&gt;</c>, <c>ws-&lt;run id&gt;</c>) behind a prefix that is empty in
/// production and <c>test-endgame-</c> in tests, so a test run can never touch a real app.
/// </summary>
public sealed class ResourceNames(string prefix, string instance)
{
    public const string ManagedByLabel = "endgame.dock";
    public const string KindLabel = "endgame.kind";
    public const string AppLabel = "endgame.app";
    public const string RunLabel = "endgame.run";
    public const string CommitLabel = "endgame.commit";
    public const string OrganisationLabel = "endgame.organisation";
    public const string TokenLabel = "endgame.token-sha256";
    public const string LeaseLabel = "endgame.lease-expires";

    public const string AppKind = "app";
    public const string AppNetworkKind = "app-network";
    public const string WorkspaceKind = "workspace";
    public const string WorkspaceNetworkKind = "workspace-network";
    public const string BuildKind = "build";
    public const string BuildNetworkKind = "build-network";

    public string Prefix { get; } = prefix;

    /// <summary>The value of <see cref="ManagedByLabel"/> on everything this Dock owns.</summary>
    public string Instance { get; } = instance;

    public string AppContainer(Guid appId) => $"{Prefix}app-{appId:D}";

    public string AppNetwork(Guid appId) => $"{Prefix}appnet-{appId:D}";

    public string AppImageRepository(Guid appId) => $"{Prefix}app-{appId:D}";

    public string WorkspaceContainer(Guid runId) => $"{Prefix}ws-{runId:D}";

    public string WorkspaceNetwork(Guid runId) => $"{Prefix}wsnet-{runId:D}";

    public string BuildContainer(Guid appId, string nonce) => $"{Prefix}build-{appId:D}-{nonce}";

    public string BuildNetwork(Guid appId, string nonce) => $"{Prefix}buildnet-{appId:D}-{nonce}";

    public Dictionary<string, string> Labels(string kind, Guid? appId = null, Guid? runId = null)
    {
        var labels = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ManagedByLabel] = Instance,
            [KindLabel] = kind,
        };
        if (appId is { } app)
        {
            labels[AppLabel] = app.ToString("D");
        }

        if (runId is { } run)
        {
            labels[RunLabel] = run.ToString("D");
        }

        return labels;
    }
}
