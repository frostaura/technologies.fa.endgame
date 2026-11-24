using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Kernel;

namespace Endgame.Harness.Events;

/// <summary>One step of a run, as appended to its log (ARCH-004, <i>Run log</i>).</summary>
public sealed record RunEvent(string Type, JsonObject Payload)
{
    /// <summary>The sequence number the control plane assigned; 0 until appended.</summary>
    public long Seq { get; init; }
}

/// <summary>
/// The event types the harness writes, exactly as ARCH-004 lists them. Payload fields the harness
/// adds are named here so replay reads exactly what was written.
/// </summary>
public static class HarnessEvents
{
    public const string ToolRequested = "tool.requested";
    public const string ToolPermitted = "tool.permitted";
    public const string ToolDenied = "tool.denied";
    public const string ToolResult = "tool.result";
    public const string PlanProposed = "plan.proposed";
    public const string PlanAccepted = "plan.accepted";
    public const string SubagentStarted = "subagent.started";
    public const string SubagentFinished = "subagent.finished";
    public const string EvaluationPassed = "evaluation.passed";
    public const string EvaluationFailed = "evaluation.failed";
    public const string EstimateMade = "estimate.made";
    public const string EstimateScored = "estimate.scored";
    public const string Message = RunEventTypes.Message;

    /// <summary>Which agent in the run wrote an event: <c>main</c>, or a sub-agent's id. Replay folds one agent at a time.</summary>
    public const string AgentField = "agent";

    public const string MainAgent = "main";

    /// <summary>The largest payload the control plane accepts (RunService.MaxPayloadBytes).</summary>
    public const int MaxPayloadBytes = 64 * 1024;

    /// <summary>Every type the control plane accepts. A harness event of any other type is a bug.</summary>
    public static bool IsKnown(string type) => RunEventTypes.All.Contains(type);
}

/// <summary>Appends a run's events. Production: the control plane, under the run's lease.</summary>
public interface IEventSink
{
    Task<IReadOnlyList<RunEvent>> AppendAsync(IReadOnlyList<RunEvent> events, CancellationToken cancellationToken);
}

/// <summary>Reads a run's log back, for replay.</summary>
public interface IRunLogReader
{
    Task<IReadOnlyList<RunEvent>> ReadAsync(long afterSeq, int limit, CancellationToken cancellationToken);
}

public static class RunLogExtensions
{
    /// <summary>The whole log, page by page (every history read has a limit, ARCH-002).</summary>
    public static async Task<IReadOnlyList<RunEvent>> ReadAllAsync(this IRunLogReader reader, CancellationToken cancellationToken, int pageSize = 500, int maxEvents = 200_000)
    {
        ArgumentNullException.ThrowIfNull(reader);
        var all = new List<RunEvent>();
        long after = 0;
        while (all.Count < maxEvents)
        {
            var page = await reader.ReadAsync(after, pageSize, cancellationToken);
            if (page.Count == 0)
            {
                break;
            }

            all.AddRange(page);
            after = page[^1].Seq;
            if (page.Count < pageSize)
            {
                break;
            }
        }

        return all;
    }
}

/// <summary>
/// Writes an agent's events tagged with its id, so a sub-agent's events nest in the parent's log.
/// Payloads over the control plane's limit are shrunk field by field, never refused.
/// </summary>
public sealed class AgentEventWriter(IEventSink sink, string agent)
{
    public string Agent { get; } = agent;

    public IEventSink Sink { get; } = sink;

    public Task<IReadOnlyList<RunEvent>> WriteAsync(string type, JsonObject payload, CancellationToken cancellationToken) =>
        WriteManyAsync([(type, payload)], cancellationToken);

    public async Task<IReadOnlyList<RunEvent>> WriteManyAsync(IReadOnlyList<(string Type, JsonObject Payload)> events, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(events);
        var batch = new List<RunEvent>(events.Count);
        foreach (var (type, payload) in events)
        {
            if (!HarnessEvents.IsKnown(type))
            {
                throw new InvalidOperationException($"'{type}' is not a run event type (ARCH-004).");
            }

            payload[HarnessEvents.AgentField] = Agent;
            batch.Add(new RunEvent(type, Fit(payload)));
        }

        // The control plane takes at most 100 events per append.
        var written = new List<RunEvent>();
        foreach (var chunk in batch.Chunk(100))
        {
            written.AddRange(await Sink.AppendAsync(chunk, cancellationToken));
        }

        return written;
    }

    /// <summary>Shrinks the largest string fields until the payload fits, marking what was cut.</summary>
    public static JsonObject Fit(JsonObject payload)
    {
        ArgumentNullException.ThrowIfNull(payload);
        var size = System.Text.Encoding.UTF8.GetByteCount(payload.ToJsonString(Json.Compact));
        var guard = 0;
        while (size > HarnessEvents.MaxPayloadBytes - 1024 && guard++ < 32)
        {
            var (parent, key, length) = Largest(payload, null, "");
            if (parent is null || length < 256)
            {
                break;
            }

            var text = parent[key]!.GetValue<string>();
            var keep = Math.Max(128, text.Length - (size - (HarnessEvents.MaxPayloadBytes - 2048)) - 64);
            parent[key] = OutputText.Truncate(text, Math.Min(keep, text.Length / 2));
            payload["truncated"] = true;
            size = System.Text.Encoding.UTF8.GetByteCount(payload.ToJsonString(Json.Compact));
        }

        return payload;
    }

    private static (JsonObject? Parent, string Key, int Length) Largest(JsonNode node, JsonObject? best, string bestKey, int bestLength = 0)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var (key, value) in o)
                {
                    if (value is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > bestLength)
                    {
                        (best, bestKey, bestLength) = (o, key, s.Length);
                    }
                    else if (value is JsonObject or JsonArray)
                    {
                        (best, bestKey, bestLength) = Largest(value, best, bestKey, bestLength);
                    }
                }

                break;
            case JsonArray a:
                foreach (var item in a.OfType<JsonNode>())
                {
                    (best, bestKey, bestLength) = Largest(item, best, bestKey, bestLength);
                }

                break;
        }

        return (best, bestKey, bestLength);
    }
}

/// <summary>
/// An in-process run log with the control plane's rules: gapless sequence numbers, known types
/// only, a payload limit, a closed log once finished. Used by the benchmark and the tests.
/// </summary>
public sealed class InMemoryRunLog : IEventSink, IRunLogReader
{
    private readonly List<RunEvent> events = [];
    private readonly Lock gate = new();

    /// <summary>When set, appends throw it: simulates the Runner dying mid-run.</summary>
    public Func<RunEvent, Exception?>? FailWhen { get; set; }

    public IReadOnlyList<RunEvent> Events
    {
        get
        {
            lock (gate)
            {
                return events.ToList();
            }
        }
    }

    public Task<IReadOnlyList<RunEvent>> AppendAsync(IReadOnlyList<RunEvent> batch, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            if (events.Count > 0 && events[^1].Type == RunEventTypes.RunFinished)
            {
                throw new InvalidOperationException("The run has finished; its log is closed.");
            }

            var written = new List<RunEvent>();
            foreach (var e in batch)
            {
                if (FailWhen?.Invoke(e) is { } failure)
                {
                    throw failure;
                }

                if (!HarnessEvents.IsKnown(e.Type))
                {
                    throw new InvalidOperationException($"'{e.Type}' is not a run event type.");
                }

                if (System.Text.Encoding.UTF8.GetByteCount(e.Payload.ToJsonString()) > HarnessEvents.MaxPayloadBytes)
                {
                    throw new InvalidOperationException("An event's payload is over 64 KB.");
                }

                var stored = new RunEvent(e.Type, e.Payload.DeepClone().AsObject()) { Seq = events.Count + 1 };
                events.Add(stored);
                written.Add(stored);
            }

            return Task.FromResult<IReadOnlyList<RunEvent>>(written);
        }
    }

    public Task<IReadOnlyList<RunEvent>> ReadAsync(long afterSeq, int limit, CancellationToken cancellationToken)
    {
        lock (gate)
        {
            return Task.FromResult<IReadOnlyList<RunEvent>>(events.Where(e => e.Seq > afterSeq).Take(Math.Clamp(limit, 1, 500))
                .Select(e => e with { Payload = e.Payload.DeepClone().AsObject() }).ToList());
        }
    }
}
