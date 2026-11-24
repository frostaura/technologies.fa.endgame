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

    /// <summary>Extra members rendered into the problem document (for example <c>terminal</c>).</summary>
    public IDictionary<string, object?> Extensions { get; } = new Dictionary<string, object?>(StringComparer.Ordinal);

    public static EndgameProblem NotFound(string what) => new(404, "not_found", "Not found", $"{what} was not found, or you cannot see it.");

    public static EndgameProblem Forbidden(string detail) => new(403, "forbidden", "Forbidden", detail);

    public static EndgameProblem Conflict(string detail) => new(409, "conflict", "Conflict", detail);

    public static EndgameProblem Invalid(string detail) => new(400, "invalid_request", "The request is not valid", detail);

    public static EndgameProblem Unauthenticated() => new(401, "unauthenticated", "Sign in first", "This needs a signed-in member.");
}
