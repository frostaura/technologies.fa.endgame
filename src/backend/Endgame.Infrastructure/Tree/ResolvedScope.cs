using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence.Records;

namespace Endgame.Infrastructure.Tree;

public sealed record ScopeNode(NodeLevel Level, Guid Id, string Slug, string Name, string Status, string Path);

/// <summary>A scope path resolved to the nodes it names, shallowest first.</summary>
public sealed record ResolvedScope(ScopePath Path, Guid OrganisationId, Guid? DivisionId, Guid? ProjectId, Guid? AppId, IReadOnlyList<ScopeNode> Nodes)
{
    public NodeLevel Level => Path.Level;

    public Guid NodeId => AppId ?? ProjectId ?? DivisionId ?? OrganisationId;

    public ScopeNode Node => Nodes[^1];

    /// <summary>The path of the node at <paramref name="level"/> on this chain.</summary>
    public string PathAt(NodeLevel level) => Nodes[(int)level].Path;

    /// <summary>True when the row sits on this scope's chain: at the scope or above it.</summary>
    public bool OnChain(IScopedRecord row) =>
        row.OrganisationId == OrganisationId
        && (row.DivisionId is null || row.DivisionId == DivisionId)
        && (row.ProjectId is null || row.ProjectId == ProjectId)
        && (row.AppId is null || row.AppId == AppId);

    /// <summary>True when the row sits at this scope or anywhere beneath it.</summary>
    public bool Contains(IScopedRecord row) =>
        row.OrganisationId == OrganisationId
        && (DivisionId is null || row.DivisionId == DivisionId)
        && (ProjectId is null || row.ProjectId == ProjectId)
        && (AppId is null || row.AppId == AppId);
}
