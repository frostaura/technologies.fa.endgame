using System.Text.Json.Nodes;

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
}

public sealed class ChatLimits
{
    /// <summary>The most output the caller wants. Clamped to the route's and every model's maximum.</summary>
    public int? MaxTokens { get; set; }
}

/// <summary>What the gateway knows about a call once it has settled.</summary>
public sealed record ChatSettlement(Guid ReservationId, decimal ReservedCredits, decimal SettledCredits, bool Billable, string? Model, string? GenerationId, bool CostFromProvider);

/// <summary>A non-streamed answer: the upstream body exactly as received, plus the settlement.</summary>
public sealed record ChatResult(string Body, ChatSettlement Settlement);
