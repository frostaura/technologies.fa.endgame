using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Endgame.AppKit.DevPlatform;

/// <summary>
/// TEST DOUBLE. Everything the fake platform has been told or asked, so a test can assert on it.
/// Thread-safe; one instance per fake.
/// </summary>
public sealed class DevPlatformState
{
    /// <summary>The app token the fake accepts. Tests and the proof inject the same value into the app.</summary>
    public string AppToken { get; init; } = "dev-app-token";

    /// <summary>Secrets the fake vault answers with.</summary>
    public ConcurrentDictionary<string, string> Secrets { get; } = new(StringComparer.Ordinal);

    /// <summary>When true, every model call is refused with <c>budget_exhausted</c>.</summary>
    public bool BudgetExhausted { get; set; }

    /// <summary>App-scoped session token → the user it belongs to.</summary>
    public ConcurrentDictionary<string, EndgameUser> Sessions { get; } = new(StringComparer.Ordinal);

    /// <summary>Emails the app asked the platform to send.</summary>
    public ConcurrentQueue<JsonObject> Emails { get; } = new();

    /// <summary>Custom telemetry events the app sent.</summary>
    public ConcurrentQueue<JsonObject> Events { get; } = new();

    /// <summary>Model calls the app made.</summary>
    public ConcurrentQueue<JsonObject> ModelCalls { get; } = new();

    /// <summary>OTLP requests received per signal (traces, metrics, logs).</summary>
    public ConcurrentDictionary<string, int> OtlpRequests { get; } = new(StringComparer.Ordinal);

    /// <summary>The last declared schedules.</summary>
    public JsonNode? Schedules { get; set; }

    /// <summary>The last declared webhooks.</summary>
    public JsonNode? Webhooks { get; set; }

    /// <summary>Requests that went out through the fake egress proxy, as "METHOD absolute-url".</summary>
    public ConcurrentQueue<string> EgressLog { get; } = new();

    /// <summary>Results of schedule runs the fake triggered, as "name status".</summary>
    public ConcurrentQueue<string> ScheduleRuns { get; } = new();

    /// <summary>Starts a session for a user and returns its app-scoped token.</summary>
    public string CreateSession(string email, EndgameUserKind kind = EndgameUserKind.Member, string? displayName = null)
    {
        var token = "dev-session-" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        var id = "usr_" + Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(email.ToLowerInvariant())))[..16];
        Sessions[token] = new EndgameUser(id, email, displayName ?? email.Split('@')[0], kind, kind == EndgameUserKind.Member ? "builder" : null);
        return token;
    }

    /// <summary>A JSON snapshot of the state, for tests that drive the fake over HTTP.</summary>
    public JsonObject Snapshot() => new()
    {
        ["emails"] = new JsonArray([.. Emails.Select(e => e.DeepClone())]),
        ["events"] = new JsonArray([.. Events.Select(e => e.DeepClone())]),
        ["modelCalls"] = new JsonArray([.. ModelCalls.Select(e => e.DeepClone())]),
        ["otlpRequests"] = JsonSerializer.SerializeToNode(OtlpRequests.ToDictionary()),
        ["schedules"] = Schedules?.DeepClone(),
        ["webhooks"] = Webhooks?.DeepClone(),
        ["egress"] = new JsonArray([.. EgressLog.Select(e => (JsonNode)e)]),
        ["scheduleRuns"] = new JsonArray([.. ScheduleRuns.Select(e => (JsonNode)e)]),
        ["sessions"] = Sessions.Count,
    };
}
