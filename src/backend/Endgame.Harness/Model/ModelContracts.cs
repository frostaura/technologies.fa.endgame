using System.Text.Json.Nodes;

namespace Endgame.Harness.Model;

/// <summary>
/// One model call as the harness asks for it. The control plane's gateway picks the model list for
/// <see cref="TaskType"/>, reserves credits and settles them; the harness never names a price.
/// </summary>
/// <param name="TaskType">The routing-table task type (ARCH-003): it decides model, ceiling and limits.</param>
/// <param name="Scope">The cascade scope the call is attributed to.</param>
/// <param name="RunId">The run the call belongs to; the gateway logs model.requested / model.replied on it.</param>
/// <param name="EmployeeId">The employee doing the work, when there is one.</param>
/// <param name="Messages">The conversation in the common chat format, assistant messages exactly as they came.</param>
/// <param name="Tools">Function tools, or null.</param>
/// <param name="MaxTokens">Output ceiling; the gateway clamps it further.</param>
/// <param name="Repair">The agent is repairing its own failed work: never billed (CLAUDE.md rule 9).</param>
/// <param name="ProviderOrder">The provider pinned for this run (ARCH-006), or null before the first reply.</param>
/// <param name="IdempotencyKey">The same key twice reserves once; the harness derives it from the run and step.</param>
/// <param name="ToolChoice">Sent only when the served model lists <c>tool_choice</c> as supported.</param>
/// <param name="MaxSearches">On a route with web search, the most searches this call may make (0: none); null leaves the route's maximum.</param>
public sealed record ChatCall(
    string TaskType,
    string Scope,
    Guid? RunId,
    Guid? EmployeeId,
    JsonArray Messages,
    JsonArray? Tools,
    int MaxTokens,
    bool Repair,
    IReadOnlyList<string>? ProviderOrder,
    string? IdempotencyKey,
    string? ToolChoice = null,
    int? MaxSearches = null);

/// <summary>A settled reply: the assistant message verbatim plus what the gateway reported about the call.</summary>
public sealed record ModelReply(
    JsonObject Message,
    string? FinishReason,
    string? Model,
    string? Provider,
    long PromptTokens,
    long CompletionTokens,
    long CachedTokens,
    decimal ReservedCredits,
    decimal SettledCredits,
    bool Billable)
{
    /// <summary>Server-side web searches the call made (OpenRouter's <c>usage.server_tool_use_details.web_search_requests</c>).</summary>
    public int Searches { get; init; }

    /// <summary>The addresses the reply cited (its <c>url_citation</c> annotations), in order, each once.</summary>
    public IReadOnlyList<string> Citations { get; init; } = [];
}

/// <summary>Why a model call failed, which decides whether it is retried.</summary>
public enum ModelFailure
{
    /// <summary>The credit budget refused the reservation. Terminal for the run; never retried (ARCH-002).</summary>
    BudgetExhausted,

    /// <summary>No provider can serve the call under its task type's ceiling. Not retried as is.</summary>
    CeilingUnreachable,

    /// <summary>The request itself is wrong. Never retried (ARCH-006).</summary>
    BadRequest,

    /// <summary>A rate limit. Retried.</summary>
    RateLimited,

    /// <summary>A server error or an unreachable upstream. Retried.</summary>
    ServerError,

    /// <summary>The call timed out. Retried.</summary>
    Timeout,

    /// <summary>The reply carried no message at all. Retried.</summary>
    EmptyReply,

    /// <summary>The run is finished or not ours any more; the gateway will not admit calls for it.</summary>
    RunClosed,
}

public sealed class ModelCallException(ModelFailure failure, string message, decimal settledCredits = 0m) : Exception(message)
{
    public ModelFailure Failure { get; } = failure;

    /// <summary>Credits already spent on a reply that failed part-way.</summary>
    public decimal SettledCredits { get; } = settledCredits;

    public bool Retryable => Failure is ModelFailure.RateLimited or ModelFailure.ServerError or ModelFailure.Timeout or ModelFailure.EmptyReply;

    public bool Terminal => Failure is ModelFailure.BudgetExhausted or ModelFailure.RunClosed;
}

/// <summary>The only way the harness reaches a model. Production: the control plane's gateway.</summary>
public interface IModelClient
{
    Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken);
}

/// <summary>
/// What the harness knows about the model that served a run: which request parameters it lists as
/// supported (only those are sent, ARCH-006) and whether it caches only what is marked.
/// </summary>
public static class ModelTraits
{
    /// <summary>Anthropic and Qwen cache only marked content; others cache prefixes on their own.</summary>
    public static bool NeedsExplicitCacheMarks(string? model) =>
        model is not null && (model.StartsWith("anthropic/", StringComparison.Ordinal) || model.StartsWith("qwen/", StringComparison.Ordinal));

    /// <summary>
    /// Marks the system message and the newest user or tool message for caching, on a copy. Messages
    /// are otherwise untouched: assistant messages stay exactly as they came.
    /// </summary>
    public static JsonArray WithCacheMarks(JsonArray messages, string? model)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var copy = messages.DeepClone().AsArray();
        if (!NeedsExplicitCacheMarks(model) || copy.Count == 0)
        {
            return copy;
        }

        Mark(copy[0]!.AsObject());
        var last = copy[^1]!.AsObject();
        if (last["role"]?.GetValue<string>() is "user" or "tool")
        {
            Mark(last);
        }

        return copy;

        static void Mark(JsonObject message)
        {
            if (message["content"] is JsonValue v && v.TryGetValue<string>(out var text))
            {
                message["content"] = new JsonArray(new JsonObject
                {
                    ["type"] = "text",
                    ["text"] = text,
                    ["cache_control"] = new JsonObject { ["type"] = "ephemeral" },
                });
            }
        }
    }
}

/// <summary>
/// Retries only what ARCH-006 allows: rate limits, server errors, timeouts and empty replies. A bad
/// request, a refused budget and an unreachable ceiling are never retried.
/// </summary>
public sealed class RetryPolicy(int maxAttempts = 4, TimeSpan? firstDelay = null, Func<TimeSpan, CancellationToken, Task>? delay = null)
{
    private readonly TimeSpan first = firstDelay ?? TimeSpan.FromSeconds(1);
    private readonly Func<TimeSpan, CancellationToken, Task> wait = delay ?? Task.Delay;

    public int MaxAttempts { get; } = Math.Max(1, maxAttempts);

    public async Task<(ModelReply Reply, int Attempts)> RunAsync(Func<int, Task<ModelReply>> call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return (await call(attempt), attempt);
            }
            catch (ModelCallException e) when (e.Retryable && attempt < MaxAttempts)
            {
                var backoff = TimeSpan.FromTicks(first.Ticks * (1L << (attempt - 1)));
                await wait(backoff, cancellationToken);
            }
        }
    }
}
