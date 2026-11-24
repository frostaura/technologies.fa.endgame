using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;

namespace Endgame.Harness.Context;

/// <summary>When to compact and what to keep (the build plan's part 7).</summary>
public sealed record CompactionOptions
{
    /// <summary>The context the agent may fill, in estimated tokens.</summary>
    public int ContextTokens { get; init; } = 120_000;

    /// <summary>Compact once the conversation passes this share of <see cref="ContextTokens"/>.</summary>
    public double TriggerFraction { get; init; } = 0.75;

    /// <summary>The newest messages always kept verbatim: recent tool results matter most.</summary>
    public int KeepRecentMessages { get; init; } = 8;

    /// <summary>The leading messages always kept: the system prompt and the task.</summary>
    public int KeepHeadMessages { get; init; } = 2;

    public int TriggerTokens => (int)(ContextTokens * TriggerFraction);
}

/// <summary>
/// Compaction near the context limit: the middle of the conversation becomes one summary message,
/// written by the model, with the plan, the task list and a pointer to the notes pinned beside it.
/// The cut always falls before an assistant message, so no tool result is separated from its call.
/// </summary>
public static class Compactor
{
    /// <summary>Tokens, estimated as bytes over four (a conservative rule for code and English).</summary>
    public static int EstimateTokens(JsonArray messages)
    {
        ArgumentNullException.ThrowIfNull(messages);
        return Encoding.UTF8.GetByteCount(messages.ToJsonString(Json.Compact)) / 4;
    }

    public static bool ShouldCompact(JsonArray messages, CompactionOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return messages.Count > options.KeepHeadMessages + options.KeepRecentMessages + 1 && EstimateTokens(messages) > options.TriggerTokens;
    }

    /// <summary>The index of the first kept recent message, or -1 when there is nothing worth cutting.</summary>
    public static int CutPoint(JsonArray messages, CompactionOptions options)
    {
        ArgumentNullException.ThrowIfNull(messages);
        ArgumentNullException.ThrowIfNull(options);
        var cut = messages.Count - options.KeepRecentMessages;
        while (cut > options.KeepHeadMessages && Role(messages[cut]) != "assistant")
        {
            cut--;
        }

        return cut <= options.KeepHeadMessages + 1 ? -1 : cut;
    }

    /// <summary>The messages to be summarised, as plain text for the summariser (tool results bounded).</summary>
    public static string Transcript(JsonArray messages, int headCount, int cut)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var sb = new StringBuilder();
        for (var i = headCount; i < cut; i++)
        {
            var m = messages[i]!.AsObject();
            var role = Role(m);
            var content = m["content"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : m["content"]?.ToJsonString() ?? "";
            sb.Append('[').Append(role).Append("] ").Append(OutputText.Truncate(content, role == "tool" ? 1500 : 4000)).Append('\n');
            if (m["tool_calls"] is JsonArray calls)
            {
                foreach (var call in calls.OfType<JsonObject>())
                {
                    sb.Append("  -> ").Append(call["function"]?["name"]).Append(' ').Append(OutputText.Truncate(call["function"]?["arguments"]?.ToString() ?? "", 600)).Append('\n');
                }
            }
        }

        return OutputText.Truncate(sb.ToString(), 60_000);
    }

    /// <summary>Replaces messages <c>[head, cut)</c> with one user message carrying the summary and the pinned state.</summary>
    public static JsonArray Apply(JsonArray messages, int headCount, int cut, string summaryMessage)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var result = new JsonArray();
        for (var i = 0; i < Math.Min(headCount, messages.Count); i++)
        {
            result.Add(messages[i]!.DeepClone());
        }

        result.Add(new JsonObject { ["role"] = "user", ["content"] = summaryMessage });
        for (var i = cut; i < messages.Count; i++)
        {
            result.Add(messages[i]!.DeepClone());
        }

        return result;
    }

    /// <summary>The summary plus what compaction must never lose: the plan, the task list and the notes.</summary>
    public static string SummaryMessage(string summary, AgentState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        var sb = new StringBuilder("The earlier part of this session was summarised to save space. Summary of the work so far:\n\n");
        sb.Append(summary.Trim()).Append("\n\n");
        if (state.Plan is { } plan)
        {
            sb.Append("The accepted plan (your contract):\n").Append(plan.Render()).Append('\n');
            if (state.Marks.Count > 0)
            {
                sb.Append("Marked so far: ").Append(string.Join(", ", state.Marks.Values.Select(m => $"{m.ItemId}={m.Status}"))).Append('\n');
            }
        }

        if (state.Tasks.Count > 0)
        {
            sb.Append("Tasks: ").Append(string.Join("; ", state.Tasks.Values.Select(t => $"{t.Id} [{t.Status}] {t.Title}"))).Append('\n');
        }

        if (state.Notes.Count > 0)
        {
            sb.Append(state.Notes.Count).Append(" notes are kept outside the conversation: read them with the notes tool.\n");
        }

        sb.Append("Continue the task from here. Re-read any file before editing it: your memory of its exact text may be stale.");
        return sb.ToString();
    }

    public const string SummariserPrompt = """
        You compress an AI software agent's working session so it can continue with less context.
        Write a dense summary, in the first person plural, of: the task; what has been learned about the
        code (files, names, conventions); every change made so far (file and what changed); commands run
        and their outcomes, especially failures still open; decisions taken and why; and what is left to
        do. Keep exact file paths, identifiers and error messages. No preamble.
        """;

    private static string Role(JsonNode? message) => message?["role"]?.GetValue<string>() ?? "";
}
