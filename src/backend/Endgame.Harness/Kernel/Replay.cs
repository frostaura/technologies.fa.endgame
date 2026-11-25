using System.Text.Json.Nodes;
using Endgame.Harness.Context;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;

namespace Endgame.Harness;

/// <summary>A tool call that was requested before a crash and never answered.</summary>
public sealed record InterruptedCall(string CallId, string Name);

/// <summary>An agent's state as its events describe it, and the calls left unanswered.</summary>
public sealed record ReplayedAgent(AgentState State, IReadOnlyList<InterruptedCall> Interrupted);

/// <summary>
/// Rebuilds an agent from the run log (ARCH-004: a run is resumed by replaying its events). The live
/// loop changes its state only through the same Apply methods, after writing the event, so a replay
/// reproduces the state the loop had at its last recorded step exactly.
/// </summary>
public static class Replay
{
    public const string TextToolSource = "text-tool-call";

    public const string InterruptedText = "This call was interrupted: the run stopped before its result was recorded, so its effect is unknown. Check the state of the workspace (read the file, or git_diff) before repeating it.";

    public static ReplayedAgent Fold(IReadOnlyList<RunEvent> log, string agentId)
    {
        ArgumentNullException.ThrowIfNull(log);
        var state = new AgentState { AgentId = agentId };
        var pending = new List<InterruptedCall>();
        foreach (var e in log.OrderBy(e => e.Seq))
        {
            if (Agent(e) != agentId)
            {
                continue;
            }

            var p = e.Payload;
            switch (e.Type)
            {
                case HarnessEvents.Message:
                    switch (Json.Str(p, "kind"))
                    {
                        case MessageKinds.AgentStart when !state.Started:
                            state.Messages =
                            [
                                new JsonObject { ["role"] = "system", ["content"] = Json.Str(p, "system") ?? "" },
                                new JsonObject { ["role"] = "user", ["content"] = Json.Str(p, "task") ?? "" },
                            ];
                            break;
                        case MessageKinds.AgentReply:
                            state.Steps++;
                            ApplyAccounting(state, p["accounting"] as JsonObject);
                            if (p["assistant"] is JsonObject reply)
                            {
                                state.Messages.Add(reply.DeepClone());
                            }

                            if (Json.Bool(p, "final") == true)
                            {
                                state.FinalText = (p["assistant"]?["content"] as JsonValue)?.GetValue<string>() ?? Json.Str(p, "text");
                                state.StopReason = state.EverEdited ? StopReasons.Completed : StopReasons.CompletedNoEdits;
                            }

                            break;
                        case MessageKinds.Nudge:
                            ApplyNudge(state, Json.Str(p, "source") ?? "", Json.Str(p, "text") ?? "");
                            break;
                        case MessageKinds.Compaction:
                            ApplyCompaction(state, Json.Int(p, "head") ?? 2, Json.Int(p, "cut") ?? 0, Json.Str(p, "summary") ?? "");
                            state.SettledCredits += Json.Dec(p, "credits") ?? 0m;
                            break;
                        case MessageKinds.Notes:
                            state.Notes.Add(Json.Str(p, "text") ?? "");
                            break;
                        case MessageKinds.PlanMark:
                            var item = Json.Str(p, "item") ?? "";
                            state.Marks[item] = new PlanMark(item, Json.Str(p, "status") ?? "done", Json.Str(p, "evidence") ?? "");
                            break;
                        case MessageKinds.AgentStopped:
                            state.StopReason = Json.Str(p, "reason");
                            state.FinalText ??= Json.Str(p, "text");
                            break;
                    }

                    break;
                case HarnessEvents.ToolRequested:
                    if (p["assistant"] is JsonObject assistant)
                    {
                        state.Steps++;
                        ApplyAccounting(state, p["accounting"] as JsonObject);
                        state.Messages.Add(assistant.DeepClone());
                        pending.Clear();
                        foreach (var call in (assistant["tool_calls"] as JsonArray ?? []).OfType<JsonObject>())
                        {
                            pending.Add(new InterruptedCall(call["id"]?.GetValue<string>() ?? "", call["function"]?["name"]?.GetValue<string>() ?? ""));
                        }
                    }

                    state.ToolCalls++;
                    break;
                case HarnessEvents.ToolResult:
                    ApplyToolResult(state, p);
                    pending.RemoveAll(c => c.CallId == Json.Str(p, "callId"));
                    break;
                case HarnessEvents.PlanProposed:
                    state.Plan = PlanContract.FromJson(p["plan"] as JsonObject);
                    state.PlanAccepted = false;
                    break;
                case HarnessEvents.PlanAccepted:
                    state.PlanAccepted = state.Plan is not null;
                    break;
                case HarnessEvents.SubagentStarted:
                    state.SubagentsStarted++;
                    break;
            }
        }

        // A call requested but never answered: the run died while it ran. Answer it honestly.
        foreach (var call in pending)
        {
            state.Messages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = call.CallId, ["content"] = InterruptedText });
            state.InterruptedCalls++;
        }

        return new ReplayedAgent(state, pending.ToList());
    }

    /// <summary>A tool's result entering the conversation, with every counter it moves.</summary>
    public static void ApplyToolResult(AgentState state, JsonObject result)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(result);
        var name = Json.Str(result, "name");
        var isError = Json.Bool(result, "isError") == true;
        state.Messages.Add(new JsonObject
        {
            ["role"] = "tool",
            ["tool_call_id"] = Json.Str(result, "callId"),
            ["content"] = Json.Str(result, "content") ?? "",
        });
        if (name == "edit_file")
        {
            state.EditCalls++;
        }

        if (isError)
        {
            state.ToolErrors++;
        }

        switch (Json.Str(result, "errorKind"))
        {
            case "edit_failed":
                state.FailedEdits++;
                break;
            case "denied":
                state.DeniedCalls++;
                break;
            case "malformed":
                state.MalformedCalls++;
                break;
            case "unknown_tool":
                state.UnknownToolCalls++;
                break;
        }

        state.SettledCredits += Json.Dec(result, "credits") ?? 0m;
        if (Json.Bool(result, "edited") == true)
        {
            state.EditedSinceVerify = true;
            state.EverEdited = true;
        }

        if (Json.Bool(result, "verified") == true)
        {
            state.EditedSinceVerify = false;
        }

        var failure = Json.Str(result, "failureKey");
        if (failure is null)
        {
            state.RepeatedFailures = 0;
            state.LastFailureSignature = null;
        }
        else if (failure == state.LastFailureSignature)
        {
            state.RepeatedFailures++;
        }
        else
        {
            state.LastFailureSignature = failure;
            state.RepeatedFailures = 1;
        }
    }

    public static void ApplyNudge(AgentState state, string source, string text)
    {
        ArgumentNullException.ThrowIfNull(state);
        state.Messages.Add(new JsonObject { ["role"] = "user", ["content"] = text });
        if (source == TextToolSource)
        {
            state.TextToolNudges++;
            state.MalformedCalls++;
        }
        else
        {
            state.StopHookRuns[source] = state.StopHookRuns.GetValueOrDefault(source) + 1;
        }
    }

    public static void ApplyCompaction(AgentState state, int head, int cut, string summaryMessage)
    {
        ArgumentNullException.ThrowIfNull(state);
        state.Messages = Compactor.Apply(state.Messages, head, cut, summaryMessage);
        state.Compactions++;
    }

    public static void ApplyAccounting(AgentState state, JsonObject? accounting)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (accounting is null)
        {
            return;
        }

        state.SettledCredits += Json.Dec(accounting, "settledCredits") ?? 0m;
        state.PromptTokens += Json.Int(accounting, "promptTokens") ?? 0;
        state.CompletionTokens += Json.Int(accounting, "completionTokens") ?? 0;
        state.CachedTokens += Json.Int(accounting, "cachedTokens") ?? 0;
        state.Searches += Json.Int(accounting, "searches") ?? 0;
        foreach (var url in Json.Strings(accounting, "citations").Where(u => !state.Citations.Contains(u, StringComparer.Ordinal)))
        {
            state.Citations.Add(url);
        }
        if (Json.Str(accounting, "model") is { Length: > 0 } model)
        {
            state.LastModel = model;
        }

        // ARCH-006: pin the provider order for the run, from the first reply that names one.
        if (state.PinnedProvider is null && Json.Str(accounting, "provider") is { Length: > 0 } provider)
        {
            state.PinnedProvider = provider;
        }
    }

    public static string? Agent(RunEvent e)
    {
        ArgumentNullException.ThrowIfNull(e);
        return Json.Str(e.Payload, HarnessEvents.AgentField);
    }
}
