using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness.Context;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness;

/// <summary>
/// The kernel (ARCH-006, the build plan's part 1): model call → tool calls → results → repeat, until
/// the model stops calling tools or a limit is reached. Every step is an event in the run log, written
/// before the state it describes changes, so a crashed run is rebuilt exactly by <see cref="Replay"/>.
/// </summary>
public sealed class AgentLoop
{
    /// <summary>What a tool result may carry into the context.</summary>
    public const int MaxResultChars = RunTool.MaxOutput + 500;

    private static readonly Regex TextToolCall = new(@"<tool_call>|<function=|<\|tool|""name""\s*:\s*""[a-z_]+""\s*,\s*""(arguments|parameters)""", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly AgentDefinition agent;
    private readonly AgentServices services;
    private readonly IWorkspace workspace;
    private readonly AgentEventWriter events;

    /// <summary>The actions since the last progress report (D29).</summary>
    private readonly List<string> sinceReport = [];

    public AgentLoop(AgentDefinition agent, AgentServices services, IWorkspace workspace, IEventSink sink)
    {
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(workspace);
        ArgumentNullException.ThrowIfNull(sink);
        this.agent = agent;
        this.services = services;
        this.workspace = workspace;
        events = new AgentEventWriter(sink, agent.Id);
    }

    public AgentDefinition Definition => agent;

    /// <summary>Starts a fresh session on a task.</summary>
    public async Task<AgentResult> StartAsync(string task, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(task);
        var state = new AgentState { AgentId = agent.Id };
        await events.WriteAsync(HarnessEvents.Message, new JsonObject
        {
            ["kind"] = MessageKinds.AgentStart,
            ["title"] = agent.Title,
            ["taskType"] = agent.TaskType,
            ["system"] = agent.SystemPrompt,
            ["task"] = task,
        }, cancellationToken);
        state.Messages =
        [
            new JsonObject { ["role"] = "system", ["content"] = agent.SystemPrompt },
            new JsonObject { ["role"] = "user", ["content"] = task },
        ];
        return await ContinueAsync(state, cancellationToken);
    }

    /// <summary>
    /// Resumes from the run's log: replays this agent's events into its state, answers any call that
    /// was in flight when the run died, and carries on. An agent that had already stopped returns at once.
    /// </summary>
    public async Task<AgentResult> ResumeAsync(IReadOnlyList<RunEvent> log, string task, CancellationToken cancellationToken)
    {
        var replayed = Replay.Fold(log, agent.Id);
        if (!replayed.State.Started)
        {
            return await StartAsync(task, cancellationToken);
        }

        if (replayed.State.StopReason is { } stopped)
        {
            return new AgentResult(stopped, replayed.State.FinalText, replayed.State);
        }

        foreach (var call in replayed.Interrupted)
        {
            await events.WriteAsync(HarnessEvents.ToolResult, new JsonObject
            {
                ["callId"] = call.CallId,
                ["name"] = call.Name,
                ["isError"] = true,
                ["errorKind"] = "interrupted",
                ["content"] = Replay.InterruptedText,
            }, cancellationToken);
        }

        return await ContinueAsync(replayed.State, cancellationToken);
    }

    /// <summary>Runs the loop on a state, which may be fresh or replayed.</summary>
    public async Task<AgentResult> ContinueAsync(AgentState state, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(state);
        var schemas = agent.Tools.Schemas();
        while (true)
        {
            var signal = await services.Control.CheckAsync(cancellationToken);
            if (signal != RunSignal.Continue)
            {
                return Suspend(state, signal switch
                {
                    RunSignal.Pause => StopReasons.Paused,
                    RunSignal.Cancel => StopReasons.Cancelled,
                    _ => StopReasons.LeaseLost,
                });
            }

            if (state.Steps >= agent.Limits.MaxSteps)
            {
                return await StopAsync(state, StopReasons.MaxSteps, $"Stopped after {state.Steps} steps without finishing.", cancellationToken);
            }

            if (agent.Limits.CreditBudget is { } budget && state.SettledCredits >= budget)
            {
                return await StopAsync(state, StopReasons.BudgetSliceSpent, $"This agent's budget of {budget} credits is spent.", cancellationToken);
            }

            if (Compactor.ShouldCompact(state.Messages, agent.Compaction))
            {
                var compacted = await CompactAsync(state, cancellationToken);
                if (compacted is not null)
                {
                    return compacted;
                }
            }

            if (state.SearchAllowed is null && agent.Limits.MaxSearchesPerCall is not 0)
            {
                await DecideSearchAsync(state, cancellationToken);
            }

            ModelReply reply;
            try
            {
                reply = await CallModelAsync(state, schemas, cancellationToken);
            }
            catch (ModelCallException e)
            {
                state.SettledCredits += e.SettledCredits;
                var reason = e.Failure switch
                {
                    ModelFailure.BudgetExhausted => StopReasons.BudgetExhausted,
                    ModelFailure.RunClosed => StopReasons.RunClosed,
                    ModelFailure.CeilingUnreachable => StopReasons.CeilingUnreachable,
                    _ when e.Unreachable => StopReasons.ModelUnreachable,
                    _ => StopReasons.ModelError,
                };
                return await StopAsync(state, reason, e.Message, cancellationToken);
            }

            var message = reply.Message;
            message.Remove("refusal");
            var toolCalls = message["tool_calls"] as JsonArray;
            if (toolCalls is { Count: 0 })
            {
                message.Remove("tool_calls");
                toolCalls = null;
            }

            var accounting = Accounting(reply);
            if (toolCalls is null)
            {
                var text = message["content"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
                var nudge = await StopNudgeAsync(state, text, cancellationToken);
                await events.WriteAsync(HarnessEvents.Message, new JsonObject
                {
                    ["kind"] = MessageKinds.AgentReply,
                    ["assistant"] = message.DeepClone(),
                    ["final"] = nudge is null,
                    ["reply"] = OutputText.Truncate(text, 4000),
                    ["accounting"] = accounting,
                }, cancellationToken);
                state.Messages.Add(message);
                if (nudge is null)
                {
                    state.FinalText = text;
                    state.StopReason = state.EverEdited ? StopReasons.Completed : StopReasons.CompletedNoEdits;
                    return new AgentResult(state.StopReason, text, state);
                }

                await events.WriteAsync(HarnessEvents.Message, new JsonObject { ["kind"] = MessageKinds.Nudge, ["nudge"] = nudge.Value.Text, ["source"] = nudge.Value.Source }, cancellationToken);
                Replay.ApplyNudge(state, nudge.Value.Source, nudge.Value.Text);
                continue;
            }

            var calls = toolCalls.OfType<JsonObject>().ToList();
            for (var n = 0; n < calls.Count; n++)
            {
                calls[n]["id"] ??= $"call_{state.Steps}_{n}";
            }

            var requests = calls.Select((call, n) => new JsonObject
            {
                ["callId"] = call["id"]!.GetValue<string>(),
                ["name"] = (call["function"] as JsonObject)?["name"]?.GetValue<string>() ?? "",
                ["arguments"] = (call["function"] as JsonObject)?["arguments"]?.DeepClone(),
                ["step"] = state.Steps,
            }).ToList();
            requests[0]["assistant"] = message.DeepClone();
            requests[0]["accounting"] = accounting.DeepClone();
            var repeated = false;
            if (Parallel(requests))
            {
                // Independent read-only sub-agents run at once, up to the fan-out cap (ARCH-006): every call is
                // requested first, they work concurrently, and their results enter the conversation in order.
                foreach (var requested in requests)
                {
                    await events.WriteAsync(HarnessEvents.ToolRequested, requested, cancellationToken);
                    state.ToolCalls++;
                }

                state.Messages.Add(message);
                var outcomes = await Task.WhenAll(requests.Select((r, n) => ExecuteAsync(state, Json.Str(r, "callId")!, Json.Str(r, "name")!, r["arguments"], n, cancellationToken)));
                for (var n = 0; n < requests.Count; n++)
                {
                    repeated |= await RecordResultAsync(state, requests[n], outcomes[n], cancellationToken);
                }
            }
            else
            {
                for (var n = 0; n < requests.Count; n++)
                {
                    await events.WriteAsync(HarnessEvents.ToolRequested, requests[n], cancellationToken);
                    if (n == 0)
                    {
                        state.Messages.Add(message);
                    }

                    state.ToolCalls++;
                    var outcome = await ExecuteAsync(state, Json.Str(requests[n], "callId")!, Json.Str(requests[n], "name")!, requests[n]["arguments"], n, cancellationToken);
                    repeated |= await RecordResultAsync(state, requests[n], outcome, cancellationToken);
                }
            }

            if (repeated)
            {
                return await StopAsync(state, StopReasons.RepeatedFailure, $"The same call failed the same way {state.RepeatedFailures} times in a row.", cancellationToken);
            }

            await ReportProgressAsync(state, requests, cancellationToken);
        }
    }

    /// <summary>
    /// Web search is the model's own capability, not a tool call, so the permission check is made for it here, before the
    /// session's first call (D18): a "may not" rule means the route's search is not offered at all; an "asks you first"
    /// rule raises one approval for the step, and a decline runs the step without search. The decision is an event, so a
    /// resumed session neither asks again nor searches after a refusal.
    /// </summary>
    private async Task DecideSearchAsync(AgentState state, CancellationToken cancellationToken)
    {
        var decision = agent.Permissions.Decide(WebSearch.Name, ToolEffect.ReadOnly, ToolTargets.None, hasPlan: true);
        if (decision.Verdict == PermissionVerdict.Allow)
        {
            state.SearchAllowed = true;
            return;
        }

        if (decision.Verdict == PermissionVerdict.Ask)
        {
            if (services.Approvals is null || decision.Checkpoint is null)
            {
                decision = decision with { Verdict = PermissionVerdict.Deny, Rule = $"unattended:{decision.Rule}" };
            }
            else
            {
                var answer = await services.Approvals.AskAsync(
                    WebSearch.ApprovalTitle(agent.Title),
                    "Your rules for this stage ask before the web is searched. If you decline, this step works without searching.",
                    ApprovalConsequence.Continues,
                    $"{WebSearch.Name}. {decision.Reason} Checkpoint: {decision.Checkpoint}.",
                    cancellationToken);
                var note = string.IsNullOrWhiteSpace(answer.Note) ? "" : $" Their note: \"{OutputText.Truncate(answer.Note.Trim(), 1000)}\"";
                decision = answer.Approved
                    ? new PermissionDecision(PermissionVerdict.Allow, $"checkpoint:{decision.Checkpoint}:approved", $"The owner approved web search for this step.{note}")
                    : new PermissionDecision(PermissionVerdict.Deny, $"checkpoint:{decision.Checkpoint}:rejected", $"The owner declined web search for this step.{note}");
            }
        }

        var allowed = decision.Verdict == PermissionVerdict.Allow;
        await events.WriteAsync(allowed ? HarnessEvents.ToolPermitted : HarnessEvents.ToolDenied, new JsonObject
        {
            ["callId"] = WebSearch.CallId,
            ["name"] = WebSearch.Name,
            ["rule"] = decision.Rule,
            ["reason"] = decision.Reason,
        }, cancellationToken);
        state.SearchAllowed = allowed;
        if (!allowed)
        {
            var nudge = $"Web search is not available for this step: {decision.Reason} Do not search and do not cite addresses you have not seen; work from what you already know, say plainly that nothing was searched, and still reply in the agreed form.";
            await events.WriteAsync(HarnessEvents.Message, new JsonObject { ["kind"] = MessageKinds.Nudge, ["nudge"] = nudge, ["source"] = WebSearch.CallId }, cancellationToken);
            Replay.ApplyNudge(state, WebSearch.CallId, nudge);
        }
    }

    /// <summary>
    /// During a long step, a plain report every so many actions (D29), so the owner sees the step move: what it has been
    /// doing, counted from the calls it actually made — never invented, and never naming a file.
    /// </summary>
    private async Task ReportProgressAsync(AgentState state, IReadOnlyList<JsonObject> requests, CancellationToken cancellationToken)
    {
        if (agent.Progress is not { Every: > 0 } progress)
        {
            return;
        }

        var before = state.ToolCalls - requests.Count;
        sinceReport.AddRange(requests.Select(r => Json.Str(r, "name") ?? ""));
        if (state.ToolCalls / progress.Every == before / progress.Every)
        {
            return;
        }

        var text = ProgressText(progress.Lead, sinceReport, state.ToolCalls);
        sinceReport.Clear();
        await events.WriteAsync(HarnessEvents.Message, new JsonObject { ["from"] = progress.From, ["title"] = progress.Title, ["text"] = text, ["progress"] = state.ToolCalls }, cancellationToken);
    }

    /// <summary>A progress report's text from the actions since the last one, in plain words.</summary>
    public static string ProgressText(string lead, IReadOnlyCollection<string> actions, int total)
    {
        ArgumentNullException.ThrowIfNull(lead);
        ArgumentNullException.ThrowIfNull(actions);
        int Count(params string[] names) => actions.Count(a => names.Contains(a, StringComparer.Ordinal));
        static string Times(int n, string one, string many) => n == 1 ? one : string.Create(CultureInfo.InvariantCulture, $"{n} {many}");
        var parts = new List<string>();
        var read = Count("read_file", "list_files", "git_diff", "load_skill");
        var searched = Count("search");
        var changed = Count("edit_file", "write_file");
        var checks = Count("run", "call_app", "check_preview", "call_webhook", "sent_emails");
        var saved = Count("commit");
        if (read > 0)
        {
            parts.Add($"read {Times(read, "one part of the app", "parts of the app")}");
        }

        if (searched > 0)
        {
            parts.Add($"searched it {Times(searched, "once", "times")}");
        }

        if (changed > 0)
        {
            parts.Add($"made {Times(changed, "one change", "changes")}");
        }

        if (checks > 0)
        {
            parts.Add($"ran {Times(checks, "one check", "checks")}");
        }

        if (saved > 0)
        {
            parts.Add($"saved {Times(saved, "one version", "versions")}");
        }

        var other = actions.Count - read - searched - changed - checks - saved;
        if (other > 0)
        {
            parts.Add($"took {Times(other, "one other step", "other steps")}");
        }

        var did = parts.Count switch
        {
            0 => "",
            1 => parts[0],
            _ => $"{string.Join(", ", parts.Take(parts.Count - 1))} and {parts[^1]}",
        };
        var lead1 = lead.TrimEnd().TrimEnd('.') + ".";
        return string.Create(CultureInfo.InvariantCulture, $"{lead1} Since the last update it {did}; {total} actions so far.");
    }

    /// <summary>A turn of two or more <c>spawn</c> calls whose sub-agents only read, within the fan-out cap: independent, so they may run at once.</summary>
    private bool Parallel(IReadOnlyList<JsonObject> requests)
    {
        if (requests.Count < 2 || requests.Count > Math.Min(agent.Limits.MaxSubagents, agent.Limits.MaxToolCallsPerTurn))
        {
            return false;
        }

        foreach (var r in requests)
        {
            if (Json.Str(r, "name") != "spawn" || Json.ParseArguments(r["arguments"]).Args is not { } args)
            {
                return false;
            }

            var tools = Json.Strings(args, "tools");
            if (tools.Any(t => !Subagents.SpawnTool.DefaultTools.Contains(t)))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>A call's result into the log and the conversation; true when the same failure has now repeated too often.</summary>
    private async Task<bool> RecordResultAsync(AgentState state, JsonObject requested, ToolOutcome outcome, CancellationToken cancellationToken)
    {
        var name = Json.Str(requested, "name") ?? "";
        var arguments = requested["arguments"];
        var failed = outcome.IsError || (name == "run" && !outcome.Content.StartsWith("[exit code 0]", StringComparison.Ordinal));
        var result = new JsonObject
        {
            ["callId"] = Json.Str(requested, "callId"),
            ["name"] = name,
            ["isError"] = outcome.IsError,
            ["errorKind"] = outcome.ErrorKind,
            ["content"] = OutputText.Truncate(outcome.Content, MaxResultChars),
            ["edited"] = (!outcome.IsError && IsWrite(name)) || outcome.Edited,
            ["credits"] = outcome.Credits,
            ["verified"] = name == "run" && agent.VerifyCommand.IsMatch(Json.Str(ParseOrEmpty(arguments), "command") ?? ""),
            ["failureKey"] = failed ? Signature(name, arguments, outcome.Content) : null,
        };
        await events.WriteAsync(HarnessEvents.ToolResult, result, cancellationToken);
        Replay.ApplyToolResult(state, result);
        return state.RepeatedFailures >= agent.Limits.MaxRepeatedFailures;
    }

    private async Task<ModelReply> CallModelAsync(AgentState state, JsonArray schemas, CancellationToken cancellationToken)
    {
        state.Steps++;
        var step = state.Steps;
        var (reply, _) = await services.Retry.RunAsync(attempt => services.Model.CompleteAsync(new ChatCall(
            agent.TaskType,
            agent.Scope,
            agent.RunId,
            agent.EmployeeId,
            ModelTraits.WithCacheMarks(state.Messages, state.LastModel),
            schemas.Count > 0 ? schemas : null,
            agent.Limits.MaxOutputTokens,
            agent.Repair,
            state.PinnedProvider is { } p ? [p] : null,
            $"{agent.RunId}:{agent.Id}:{step}:{attempt}:{services.SessionNonce}",
            MaxSearches: state.SearchAllowed == false ? 0 : agent.Limits.MaxSearchesPerCall), cancellationToken), cancellationToken);
        Replay.ApplyAccounting(state, Accounting(reply));
        return reply;
    }

    private async Task<ToolOutcome> ExecuteAsync(AgentState state, string callId, string name, JsonNode? rawArguments, int index, CancellationToken cancellationToken)
    {
        var (arguments, parseError) = Json.ParseArguments(rawArguments);
        if (parseError is not null)
        {
            return ToolOutcome.Error($"The arguments for {name} were not valid JSON ({parseError}). Nothing ran. Send the call again with a JSON object.", "malformed");
        }

        if (index >= agent.Limits.MaxToolCallsPerTurn)
        {
            return ToolOutcome.Error($"Not run: at most {agent.Limits.MaxToolCallsPerTurn} tool calls are run per turn. Send the rest in your next turn.", "turn_cap");
        }

        if (!agent.Tools.TryGet(name, out var tool))
        {
            return ToolOutcome.Error($"There is no tool called '{name}'. The tools are: {string.Join(", ", agent.Tools.Names)}.", "unknown_tool");
        }

        var (targets, targetError) = tool.Target(arguments!, workspace.Root);
        if (targetError is not null)
        {
            return ToolOutcome.Error(targetError, targetError.Contains("outside the workspace", StringComparison.Ordinal) ? "denied" : "bad_arguments");
        }

        var decision = agent.Permissions.Decide(name, tool.Effect, targets, state.Plan is not null && state.PlanAccepted);
        if (decision.Verdict == PermissionVerdict.Ask)
        {
            decision = await AskAsync(name, tool, arguments!, targets, decision, cancellationToken);
        }

        await events.WriteAsync(decision.Verdict == PermissionVerdict.Allow ? HarnessEvents.ToolPermitted : HarnessEvents.ToolDenied, new JsonObject
        {
            ["callId"] = callId,
            ["name"] = name,
            ["rule"] = decision.Rule,
            ["reason"] = decision.Reason,
            ["paths"] = Json.Array(targets.Paths.Select(p => p.Relative)),
            ["command"] = targets.Command is { } c ? OutputText.Truncate(c, 1000) : null,
        }, cancellationToken);
        if (decision.Verdict != PermissionVerdict.Allow)
        {
            return ToolOutcome.Error($"Permission denied ({decision.Rule}): {decision.Reason}", "denied");
        }

        var context = new ToolContext(workspace, state, services, events, agent);
        var toolCall = new ToolCall(callId, name, arguments!, context);
        foreach (var hook in agent.ToolHooks)
        {
            if (await hook.BeforeAsync(toolCall, cancellationToken) is { } blocked)
            {
                return ToolOutcome.Error(blocked, "blocked");
            }
        }

        ToolOutcome outcome;
        try
        {
            outcome = await tool.ExecuteAsync(toolCall, cancellationToken);
        }
        catch (WorkspaceException e)
        {
            outcome = ToolOutcome.Error($"The workspace refused: {e.Message}", e.Code == "protected_path" ? "denied" : "workspace_error");
        }
        catch (Exception e) when (e is not OperationCanceledException and not ModelCallException)
        {
            outcome = ToolOutcome.Error($"{name} failed: {e.Message}", "tool_error");
        }

        foreach (var hook in agent.ToolHooks)
        {
            outcome = await hook.AfterAsync(toolCall, outcome, cancellationToken);
        }

        return outcome;
    }

    private async Task<PermissionDecision> AskAsync(string name, ITool tool, JsonObject arguments, ToolTargets targets, PermissionDecision asked, CancellationToken cancellationToken)
    {
        if (services.Approvals is null || asked.Checkpoint is null)
        {
            return asked with { Verdict = PermissionVerdict.Deny, Rule = $"unattended:{asked.Rule}" };
        }

        var what = targets.Command ?? string.Join(", ", targets.Paths.Select(p => p.Relative));
        // The title is for the owner (ARCH-004): what will happen if they approve, in words; the tool, its command or its
        // files are technical detail, kept for the detail line technical mode shows. A tool that knows its own plain words says them.
        var title = tool is IApprovalTitle plain ? plain.ApprovalTitle(arguments) : name switch
        {
            "edit_file" or "write_file" => "Let the agent change part of the app",
            "run" => "Let the agent run a check on the app",
            "commit" => "Let the agent save a new version",
            "tasks" => "Let the agent update its task list",
            _ => "Let the agent take this step",
        };
        var answer = await services.Approvals.AskAsync(
            OutputText.Truncate($"{title.TrimEnd('.', '?')}?", 300),
            ApprovalDetail.For(asked),
            ApprovalConsequence.Continues,
            OutputText.Truncate($"{name}{(what.Length > 0 ? $": {what}" : "")}. {asked.Reason} Checkpoint: {asked.Checkpoint}.", 2000),
            cancellationToken);
        var note = string.IsNullOrWhiteSpace(answer.Note) ? "" : $" Their note: \"{OutputText.Truncate(answer.Note.Trim(), 1000)}\"";
        return answer.Approved
            ? new PermissionDecision(PermissionVerdict.Allow, $"checkpoint:{asked.Checkpoint}:approved", $"The owner approved this call.{note}")
            : new PermissionDecision(PermissionVerdict.Deny, $"checkpoint:{asked.Checkpoint}:rejected", $"The owner declined this call, so it was not done.{note} Carry on without it, or finish and say plainly that it was not done.");
    }

    private async Task<(string Text, string Source)?> StopNudgeAsync(AgentState state, string text, CancellationToken cancellationToken)
    {
        if (TextToolCall.IsMatch(text) && state.TextToolNudges < agent.Limits.MaxTextToolNudges)
        {
            return ("Your last reply wrote a tool call as plain text, so nothing ran. Call tools through the function-calling interface instead or, if you have finished, reply with your summary only.", Replay.TextToolSource);
        }

        foreach (var hook in agent.StopHooks)
        {
            if (state.StopHookRuns.GetValueOrDefault(hook.Name) >= hook.MaxRuns)
            {
                continue;
            }

            if (await hook.OnStopAsync(state, workspace, cancellationToken) is { } nudge)
            {
                return (nudge, hook.Name);
            }
        }

        return null;
    }

    private async Task<AgentResult?> CompactAsync(AgentState state, CancellationToken cancellationToken)
    {
        var head = agent.Compaction.KeepHeadMessages;
        var cut = Compactor.CutPoint(state.Messages, agent.Compaction);
        if (cut < 0)
        {
            return null;
        }

        ModelReply summary;
        try
        {
            (summary, _) = await services.Retry.RunAsync(attempt => services.Model.CompleteAsync(new ChatCall(
                agent.SummaryTaskType,
                agent.Scope,
                agent.RunId,
                agent.EmployeeId,
                [
                    new JsonObject { ["role"] = "system", ["content"] = Compactor.SummariserPrompt },
                    new JsonObject { ["role"] = "user", ["content"] = Compactor.Transcript(state.Messages, head, cut) },
                ],
                null,
                3000,
                agent.Repair,
                null,
                $"{agent.RunId}:{agent.Id}:compact:{state.Compactions}:{attempt}:{services.SessionNonce}"), cancellationToken), cancellationToken);
        }
        catch (ModelCallException e) when (e.Terminal)
        {
            return await StopAsync(state, e.Failure == ModelFailure.BudgetExhausted ? StopReasons.BudgetExhausted : StopReasons.RunClosed, e.Message, cancellationToken);
        }
        catch (ModelCallException)
        {
            // A failed summary is not fatal: carry on uncompacted, and the next step tries again.
            return null;
        }

        state.SettledCredits += summary.SettledCredits;
        var text = summary.Message["content"]?.GetValue<string>() ?? "";
        var message = Compactor.SummaryMessage(text, state);
        await events.WriteAsync(HarnessEvents.Message, new JsonObject
        {
            ["kind"] = MessageKinds.Compaction,
            ["head"] = head,
            ["cut"] = cut,
            ["count"] = state.Messages.Count,
            ["summary"] = message,
            ["credits"] = summary.SettledCredits,
            ["tokensBefore"] = Compactor.EstimateTokens(state.Messages),
        }, cancellationToken);
        Replay.ApplyCompaction(state, head, cut, message);
        return null;
    }

    private async Task<AgentResult> StopAsync(AgentState state, string reason, string text, CancellationToken cancellationToken)
    {
        await events.WriteAsync(HarnessEvents.Message, new JsonObject { ["kind"] = MessageKinds.AgentStopped, ["reason"] = reason, ["detail"] = text }, cancellationToken);
        state.StopReason = reason;
        state.FinalText ??= text;
        return new AgentResult(reason, text, state);
    }

    private static AgentResult Suspend(AgentState state, string reason) => new(reason, null, state);

    private static JsonObject Accounting(ModelReply reply) => new()
    {
        ["model"] = reply.Model,
        ["provider"] = reply.Provider,
        ["promptTokens"] = reply.PromptTokens,
        ["completionTokens"] = reply.CompletionTokens,
        ["cachedTokens"] = reply.CachedTokens,
        ["settledCredits"] = reply.SettledCredits,
        ["finishReason"] = reply.FinishReason,
        ["searches"] = reply.Searches,
        ["citations"] = Json.Array(reply.Citations.Take(40)),
    };

    private static bool IsWrite(string name) => name is "edit_file" or "write_file";

    private static JsonObject ParseOrEmpty(JsonNode? raw) => Json.ParseArguments(raw).Args ?? [];

    private static string Signature(string name, JsonNode? arguments, string content)
    {
        var text = $"{name}\n{(arguments is JsonValue v && v.TryGetValue<string>(out var s) ? s : arguments?.ToJsonString())}\n{content}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16].ToLower(CultureInfo.InvariantCulture);
    }
}

/// <summary>The route's server-side web search, which the permission check covers as if it were a tool (D18).</summary>
public static class WebSearch
{
    /// <summary>The name a rule uses for it ("Search the web" in the console).</summary>
    public const string Name = "web_search";

    /// <summary>The call id of the one decision a session makes about it, in <c>tool.permitted</c> or <c>tool.denied</c>.</summary>
    public const string CallId = "capability:web_search";

    /// <summary>The approval's title: what approving does, in plain words, for the step it belongs to.</summary>
    public static string ApprovalTitle(string? step) =>
        OutputText.Truncate(string.IsNullOrWhiteSpace(step) ? "Let this step search the web?" : $"Let this step search the web: {step.Trim().TrimEnd('.', '?')}?", 300);
}

/// <summary>The <c>kind</c> of the harness's <c>message</c> events.</summary>
public static class MessageKinds
{
    public const string AgentStart = "agent.start";
    public const string AgentReply = "agent.reply";
    public const string AgentStopped = "agent.stopped";
    public const string Nudge = "nudge";
    public const string Compaction = "compaction";
    public const string Notes = "notes";
    public const string PlanMark = "plan.mark";
    public const string Workflow = "workflow.step";
}
