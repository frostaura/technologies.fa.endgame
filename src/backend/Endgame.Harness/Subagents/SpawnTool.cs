using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Hooks;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;

namespace Endgame.Harness.Subagents;

/// <summary>
/// <c>spawn</c>: a sub-agent (a contractor) with its own context, a brief — objective, output
/// format, boundaries — a subset of the parent's tools and a slice of its budget. It returns a short
/// summary; its events nest in the parent's run log under its own agent id. The parent's permission
/// policy binds it: a sub-agent can never do what its parent may not.
/// </summary>
public sealed class SpawnTool : ITool
{
    public const int MaxSummaryChars = 2500;
    public const int DefaultSteps = 25;

    public static readonly IReadOnlyList<string> DefaultTools = ["read_file", "list_files", "search", "git_diff", "notes"];

    public string Name => "spawn";

    public string Description => "Hand a self-contained piece of work to a sub-agent with a fresh context, for example surveying many files, or a change confined to a few files. Give it a brief: the objective, the output format you want back, and its boundaries. It gets read-only tools unless you list more, and returns only its short report, so your own context stays small.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["title"] = Schema.Str("A few plain words for the owner saying what it will do, for example 'Survey the legacy handlers'."),
        ["objective"] = Schema.Str("What the sub-agent must achieve, with everything it needs to know."),
        ["output_format"] = Schema.Str("Exactly what to report back, and how briefly."),
        ["boundaries"] = Schema.Str("What it must not do or touch."),
        ["tools"] = Schema.Strings($"Tools it may use, from yours (default: {string.Join(", ", DefaultTools)})."),
        ["max_steps"] = Schema.Int($"Its step limit (default {DefaultSteps})."),
    }, "objective", "output_format", "boundaries");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var parent = call.Context.Agent;
        var state = call.Context.State;

        var objective = Json.Str(call.Arguments, "objective")?.Trim() ?? "";
        var format = Json.Str(call.Arguments, "output_format")?.Trim() ?? "";
        var boundaries = Json.Str(call.Arguments, "boundaries")?.Trim() ?? "";
        if (objective.Length == 0 || format.Length == 0 || boundaries.Length == 0)
        {
            return ToolOutcome.Error("A sub-agent needs a full brief: objective, output_format and boundaries.", "bad_arguments");
        }

        var requested = Json.Strings(call.Arguments, "tools");
        var names = (requested.Count > 0 ? requested : DefaultTools.Where(n => parent.Tools.TryGet(n, out _))).Where(n => n != Name).ToList();
        var unknown = names.Where(n => !parent.Tools.TryGet(n, out _)).ToList();
        if (unknown.Count > 0)
        {
            return ToolOutcome.Error($"You cannot give a sub-agent tools you do not have: {string.Join(", ", unknown)}. Yours: {string.Join(", ", parent.Tools.Names.Where(n => n != Name))}.", "bad_arguments");
        }

        var remainingSteps = Math.Max(1, parent.Limits.MaxSteps - state.Steps);
        var steps = Math.Clamp(Json.Int(call.Arguments, "max_steps") ?? DefaultSteps, 1, Math.Min(remainingSteps, 40));
        decimal? slice = parent.Limits.CreditBudget is { } budget ? Math.Max(0m, (budget - state.SettledCredits) / 2m) : null;
        var tools = parent.Tools.Subset(names);
        var writes = names.Any(n => n is "edit_file" or "write_file");

        // Claimed before any await: sub-agents of one turn may start at once, and each takes its own number.
        int number;
        lock (state)
        {
            if (state.SubagentsStarted >= parent.Limits.MaxSubagents)
            {
                return ToolOutcome.Error($"The fan-out cap is reached: this agent may start at most {parent.Limits.MaxSubagents} sub-agents. Do the rest yourself.", "fan_out_cap");
            }

            number = ++state.SubagentsStarted;
        }

        var id = string.Create(CultureInfo.InvariantCulture, $"{parent.Id}.sub-{number}");
        var title = Title(Json.Str(call.Arguments, "title"), objective);
        var child = parent with
        {
            Id = id,
            SystemPrompt = SystemPrompt(objective, format, boundaries, call.Context.Workspace.Root),
            Tools = tools,
            Limits = parent.Limits with { MaxSteps = steps, CreditBudget = slice, MaxSubagents = 0 },
            Permissions = parent.Permissions.WithRequirePlan(false),
            StopHooks = writes ? [new VerifyAfterEditStopHook()] : [],
            AutoAcceptPlan = true,
        };

        await call.Context.Events.WriteAsync(HarnessEvents.SubagentStarted, new JsonObject
        {
            ["subagent"] = id,
            ["callId"] = call.CallId,
            ["title"] = title,
            ["role"] = "contractor",
            ["brief"] = OutputText.Truncate(objective, 1000),
            ["briefDetail"] = new JsonObject { ["objective"] = objective, ["outputFormat"] = format, ["boundaries"] = boundaries },
            ["tools"] = Json.Array(tools.Names),
            ["maxSteps"] = steps,
            ["creditBudget"] = slice,
        }, cancellationToken);

        var loop = new AgentLoop(child, call.Context.Services, call.Context.Workspace, call.Context.Events.Sink);
        var result = await loop.StartAsync($"Your brief.\n\nObjective: {objective}\n\nReport back: {format}\n\nBoundaries: {boundaries}", cancellationToken);
        if (StopReasons.IsSuspension(result.StopReason))
        {
            return ToolOutcome.Error("The run was suspended while the sub-agent worked; spawn it again once the run resumes.", "interrupted");
        }

        var summary = OutputText.Truncate(result.FinalText ?? "(no report)", MaxSummaryChars);
        await call.Context.Events.WriteAsync(HarnessEvents.SubagentFinished, new JsonObject
        {
            ["subagent"] = id,
            ["callId"] = call.CallId,
            ["title"] = title,
            ["stopReason"] = result.StopReason,
            ["summary"] = Sentence(result.Completed ? summary : $"It stopped before finishing ({result.StopReason})."),
            ["report"] = summary,
            ["searches"] = result.State.Searches,
            ["steps"] = result.State.Steps,
            ["credits"] = result.State.SettledCredits,
            ["edited"] = result.State.EverEdited,
        }, cancellationToken);

        var ok = result.Completed;
        var text = $"Sub-agent {id} {(ok ? "finished" : $"stopped ({result.StopReason})")} after {result.State.Steps} steps.\n\n{summary}";
        // Its spend counts against the parent's slice and its edits as the parent's own (through the tool result, so replay agrees).
        var outcome = ok ? new ToolOutcome(text) : ToolOutcome.Error(text, "subagent_stopped");
        return outcome with { Edited = result.State.EverEdited, Credits = result.State.SettledCredits };
    }

    /// <summary>The owner-facing heading: the briefer's own words, or the objective's first sentence.</summary>
    public static string Title(string? given, string objective)
    {
        var text = (given?.Trim() is { Length: > 0 } t ? t : objective.Split(['.', '\n'], 2)[0]).Trim();
        // The owner reads the title (ARCH-004): one naming a file, a command or code says what kind of step it is instead.
        if (!Events.OwnerText.IsPlain(text))
        {
            return "Looked into part of the work";
        }

        return text.Length <= 60 ? text : text[..57].TrimEnd() + "...";
    }

    /// <summary>The first sentence of a report, plain, at most 300 characters: what the console shows in normal mode.</summary>
    public static string Sentence(string report)
    {
        var flat = string.Join(' ', report.Split((char[])['\n', '\r'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Trim('#', '*', ' ', '-');
        var end = flat.IndexOfAny(['.', '!', '?']);
        var sentence = end > 0 ? flat[..(end + 1)] : flat;
        return sentence.Length <= 300 ? sentence : sentence[..297].TrimEnd() + "...";
    }

    private static string SystemPrompt(string objective, string format, string boundaries, string root) => $"""
        You are a sub-agent: a contractor briefed by another agent, working in the repository at {root}
        inside a sandboxed container. Nobody will answer questions; decide sensibly and finish.

        Objective: {objective}

        Boundaries: {boundaries}

        When you are done, reply with your report only, in this format: {format}
        Keep the report short (under 300 words). It is all your briefer will see of your work.
        """;
}
