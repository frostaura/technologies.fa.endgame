using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Endgame.Application.Gateway;

/// <summary>
/// <c>POST /internal/model/chat</c>. Messages and tools are passed through untouched, in the common
/// chat-and-tools format, so tool-call ids stay exactly as the provider issued them.
/// </summary>
public sealed class ChatRequest
{
    public string TaskType { get; set; } = "";

    public string Scope { get; set; } = "";

    public Guid? RunId { get; set; }

    public Guid? EmployeeId { get; set; }

    public JsonArray? Messages { get; set; }

    public JsonArray? Tools { get; set; }

    public JsonNode? ToolChoice { get; set; }

    public JsonNode? ResponseFormat { get; set; }

    public ChatLimits? Limits { get; set; }

    public bool Stream { get; set; }

    /// <summary>An agent repairing its own failed work. Recorded with <c>billable = false</c>; never charged.</summary>
    public bool Repair { get; set; }

    /// <summary>Optional: the same key twice reserves once.</summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>Optional sampling temperature, 0 to 2. Left to the model when absent, and not sent to a model that does not take one.</summary>
    public double? Temperature { get; set; }

    /// <summary>
    /// Optional: the providers to try, in order, sent upstream as <c>provider.order</c>. The harness
    /// pins the provider of a run's first reply (ARCH-006), so caching and tool-call behaviour hold.
    /// </summary>
    public List<string>? ProviderOrder { get; set; }

    /// <summary>
    /// Set by the platform API for an app's own calls, never read from a request body: the most the
    /// app's model calls may spend this calendar month. Checked in the same transaction that admits.
    /// </summary>
    [JsonIgnore]
    public decimal? AppMonthlyCap { get; set; }
}

public sealed class ChatLimits
{
    /// <summary>The most output the caller wants. Clamped to the route's and every model's maximum.</summary>
    public int? MaxTokens { get; set; }

    /// <summary>
    /// On a route with web search: the most searches this call may make, 0 for none. Clamped to the route's
    /// own <c>MaxUses</c>, and reserved for exactly as asked. Absent: the route's maximum.
    /// </summary>
    public int? MaxSearches { get; set; }
}

/// <summary>What the gateway knows about a call once it has settled.</summary>
public sealed record ChatSettlement(Guid ReservationId, decimal ReservedCredits, decimal SettledCredits, bool Billable, string? Model, string? GenerationId, bool CostFromProvider);

/// <summary>A non-streamed answer: the upstream body exactly as received, plus the settlement.</summary>
public sealed record ChatResult(string Body, ChatSettlement Settlement);
