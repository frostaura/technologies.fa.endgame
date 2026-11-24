namespace Endgame.Domain.Tree;

/// <summary>
/// A node in the tree written as a path of slugs (ARCH-004): <c>org</c>, <c>org/division</c>,
/// <c>org/division/project</c> or <c>org/division/project/app</c>. The depth is the level.
/// </summary>
public sealed record ScopePath
{
    private ScopePath(IReadOnlyList<string> segments) => Segments = segments;

    public IReadOnlyList<string> Segments { get; }

    public NodeLevel Level => (NodeLevel)(Segments.Count - 1);

    public string Organisation => Segments[0];

    public string? Division => Segments.Count > 1 ? Segments[1] : null;

    public string? Project => Segments.Count > 2 ? Segments[2] : null;

    public string? App => Segments.Count > 3 ? Segments[3] : null;

    public static ScopePath Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new DomainException("A scope is required, written as org, org/division, org/division/project or org/division/project/app.");
        }

        var segments = value.Trim().Trim('/').Split('/');
        if (segments.Length is < 1 or > 4)
        {
            throw new DomainException($"'{value}' is not a scope: it has {segments.Length} segments, and a scope has one to four.");
        }

        foreach (var segment in segments)
        {
            SlugRules.Require(segment);
        }

        return new ScopePath(segments);
    }

    public static bool TryParse(string? value, out ScopePath? path)
    {
        try
        {
            path = Parse(value);
            return true;
        }
        catch (DomainException)
        {
            path = null;
            return false;
        }
    }

    public static ScopePath Of(params string[] segments) => Parse(string.Join('/', segments));

    /// <summary>This path and every ancestor, shallowest first.</summary>
    public IEnumerable<ScopePath> Chain() =>
        Enumerable.Range(1, Segments.Count).Select(n => new ScopePath(Segments.Take(n).ToArray()));

    public ScopePath Child(string slug) => Parse($"{this}/{slug}");

    public override string ToString() => string.Join('/', Segments);

    public bool Equals(ScopePath? other) => other is not null && Segments.SequenceEqual(other.Segments, StringComparer.Ordinal);

    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(ToString());
}
