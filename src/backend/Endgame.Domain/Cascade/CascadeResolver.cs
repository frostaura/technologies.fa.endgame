using Endgame.Domain.Tree;

namespace Endgame.Domain.Cascade;

/// <summary>One value set at one node of the tree.</summary>
/// <param name="Level">The level of the node that set it.</param>
/// <param name="NodeId">The node that set it.</param>
/// <param name="Path">That node's scope path.</param>
public sealed record CascadeEntry(CascadeKind Kind, string Key, string ValueJson, NodeLevel Level, Guid NodeId, string Path, DateTimeOffset SetAt);

/// <summary>The value that applies at a scope, and the level that set it.</summary>
/// <param name="Overridden">Values set higher up the chain that this one narrows or overrides, shallowest first.</param>
public sealed record EffectiveEntry(CascadeEntry Entry, IReadOnlyList<CascadeEntry> Overridden)
{
    public string Key => Entry.Key;

    public NodeLevel SetAt => Entry.Level;
}

/// <summary>
/// The one implementation of inheritance (ARCH-004): something set at a level applies to everything
/// beneath it unless a lower level narrows or overrides it, so the deepest entry for a key wins. Pure —
/// the caller supplies the entries set anywhere on the chain from the organisation to the scope.
/// </summary>
public static class CascadeResolver
{
    public static IReadOnlyList<EffectiveEntry> Resolve(CascadeKind kind, IEnumerable<CascadeEntry> chainEntries) =>
        chainEntries
            .Where(e => e.Kind == kind)
            .GroupBy(e => e.Key, StringComparer.Ordinal)
            .Select(g =>
            {
                var ordered = g.OrderBy(e => e.Level).ToList();
                return new EffectiveEntry(ordered[^1], ordered.Take(ordered.Count - 1).ToList());
            })
            .OrderBy(e => e.Key, StringComparer.Ordinal)
            .ToList();

    public static EffectiveEntry? ResolveKey(CascadeKind kind, string key, IEnumerable<CascadeEntry> chainEntries) =>
        Resolve(kind, chainEntries.Where(e => e.Key == key)).SingleOrDefault();
}
