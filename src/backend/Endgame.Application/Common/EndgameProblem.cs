namespace Endgame.Application.Common;

/// <summary>
/// A refusal the API reports as problem details: an HTTP status, a stable machine-readable code (the
/// problem <c>type</c> ends with it) and a sentence for a person. Thrown by use cases, rendered once by
/// the host, so a failure can never be mistaken for an empty result.
/// </summary>
public class EndgameProblem(int status, string code, string title, string? detail = null) : Exception(detail ?? title)
{
    public int Status { get; } = status;

    public string Code { get; } = code;

    public string Title { get; } = title;

    public string? Detail { get; } = detail;

    /// <summary>
    /// Extra members rendered into the problem document (for example <c>terminal</c>). A name the document already
    /// has — RFC 9457's <c>type</c>, <c>title</c>, <c>status</c>, <c>detail</c>, <c>instance</c>, or Endgame's
    /// <c>code</c> — is refused where it is added: rendered, it would be the same key twice, which a strict reader
    /// cannot parse (D25: a run's status as <c>status</c> broke the Runner's lease renewal).
    /// </summary>
    public IDictionary<string, object?> Extensions { get; } = new ProblemExtensions();

    /// <summary>The members every problem document has; no extension may take one of these names.</summary>
    public static readonly IReadOnlySet<string> ReservedMembers = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "type", "title", "status", "detail", "instance", "code" };

    public static EndgameProblem NotFound(string what) => new(404, "not_found", "Not found", $"{what} was not found, or you cannot see it.");

    public static EndgameProblem Forbidden(string detail) => new(403, "forbidden", "Forbidden", detail);

    public static EndgameProblem Conflict(string detail) => new(409, "conflict", "Conflict", detail);

    public static EndgameProblem Invalid(string detail) => new(400, "invalid_request", "The request is not valid", detail);

    public static EndgameProblem Unauthenticated() => new(401, "unauthenticated", "Sign in first", "This needs a signed-in member.");
}

/// <summary>An extension dictionary that refuses the problem document's own member names.</summary>
internal sealed class ProblemExtensions : IDictionary<string, object?>
{
    private readonly Dictionary<string, object?> values = new(StringComparer.Ordinal);

    public ICollection<string> Keys => values.Keys;

    public ICollection<object?> Values => values.Values;

    public int Count => values.Count;

    public bool IsReadOnly => false;

    public object? this[string key]
    {
        get => values[key];
        set => values[Require(key)] = value;
    }

    public void Add(string key, object? value) => values.Add(Require(key), value);

    public void Add(KeyValuePair<string, object?> item) => Add(item.Key, item.Value);

    public bool ContainsKey(string key) => values.ContainsKey(key);

    public bool Contains(KeyValuePair<string, object?> item) => ((ICollection<KeyValuePair<string, object?>>)values).Contains(item);

    public bool Remove(string key) => values.Remove(key);

    public bool Remove(KeyValuePair<string, object?> item) => ((ICollection<KeyValuePair<string, object?>>)values).Remove(item);

    public bool TryGetValue(string key, out object? value) => values.TryGetValue(key, out value);

    public void Clear() => values.Clear();

    public void CopyTo(KeyValuePair<string, object?>[] array, int arrayIndex) => ((ICollection<KeyValuePair<string, object?>>)values).CopyTo(array, arrayIndex);

    public IEnumerator<KeyValuePair<string, object?>> GetEnumerator() => values.GetEnumerator();

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();

    private static string Require(string key) =>
        EndgameProblem.ReservedMembers.Contains(key)
            ? throw new ArgumentException($"'{key}' is a member every problem document already has; name the extension something else (for example 'runStatus').", nameof(key))
            : key;
}
