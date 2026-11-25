using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Platform;
using Endgame.Harness.Tools;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// A conversation turn: the owner's message, answered in the scope they selected by an assistant
/// with read tools over the tree, tasks, runs and credits. It may start an idea or change a setting
/// only through the permissioned tools, each of which asks the owner first. The answer is a
/// <c>message</c> on the run, which the console streams.
/// </summary>
public sealed class ConversationWorkflow : IWorkflow
{
    public const int TurnsRemembered = 6;

    public string Kind => RunKinds.Conversation;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        var question = Json.Str(run.OwnerMessage(), "text") ?? run.Run.Title;
        var earlier = await EarlierTurnsAsync(run, cancellationToken);
        var scope = run.Run.Scope;
        ITool[] tools =
        [
            new ReadOrganisationTool(run.ControlPlane, scope),
            new StartIdeaTool(run.ControlPlane, scope),
            new ChangeAppTool(run.ControlPlane, scope),
            new TryAgainTool(run.ControlPlane, scope),
            new AdjustSettingTool(run.ControlPlane, scope),
        ];
        var agent = run.Agents.Conversation(run, tools);
        string? speaker = null;
        if (run.Run.EmployeeId is { } employeeId)
        {
            // Talking to an employee is answered by that employee (TALK-05): its job, its mandate, what it remembers, its thinking power.
            var who = await EmployeeAsync(run, employeeId, cancellationToken);
            speaker = Json.Str(who, "name");
            agent = AgentFactory.As(run, agent with
            {
                TaskType = Json.Str(who?["jobDescription"] as JsonObject, "modelTier") is { Length: > 0 } tier ? tier : agent.TaskType,
                SystemPrompt = agent.SystemPrompt.TrimEnd() + "\n\n" + AsEmployee(who),
            }, employeeId, await Workforce.MemoryBlockAsync(run, employeeId, scope, cancellationToken), canRemember: true, scope);
        }

        var task = earlier.Length == 0 ? question : $"Earlier in this conversation:\n{earlier}\nThe owner now says:\n{question}";
        var result = await WorkflowSupport.RunAgentAsync(run, agent, NoWorkspace.Instance, task, cancellationToken);
        if (result.StopReason == StopReasons.BudgetExhausted && !run.Journal.Done("answered"))
        {
            // Said in the conversation itself, not only on the run page (TALK-15): no reply was written, and why.
            await run.AppendAsync(HarnessEvents.Message, new JsonObject
            {
                ["from"] = "runner",
                ["code"] = "budget_exhausted",
                ["title"] = "No reply: the budget ran out",
                ["text"] = "The credit budget ran out before a reply could be written, so nothing was answered and nothing more was charged. Top up or raise the budget, then ask again.",
            }, cancellationToken);
            await run.Journal.RecordAsync("answered", new JsonObject { ["budget"] = true }, cancellationToken);
        }

        if (WorkflowOutcome.FromAgent(result) is { } stopped)
        {
            return stopped;
        }

        var answer = result.Completed ? result.FinalText ?? "" : "I could not finish answering that. Please ask again.";
        if (!run.Journal.Done("answered"))
        {
            var said = new JsonObject { ["from"] = "assistant", ["text"] = answer };
            if (speaker is not null)
            {
                said["by"] = speaker;
                said["employeeId"] = run.Run.EmployeeId?.ToString();
            }

            await run.AppendAsync(HarnessEvents.Message, said, cancellationToken);
            await run.Journal.RecordAsync("answered", new JsonObject(), cancellationToken);
        }

        return result.Completed ? WorkflowOutcome.Success(OutputText.Truncate(answer, 500)) : WorkflowOutcome.Failure(answer);
    }

    private static async Task<JsonObject?> EmployeeAsync(RunContext run, Guid employeeId, CancellationToken cancellationToken)
    {
        try
        {
            return (await run.ControlPlane.EmployeeAsync(employeeId, cancellationToken))["employee"] as JsonObject;
        }
        catch (Harness.Model.ServiceProblemException)
        {
            return null;
        }
    }

    /// <summary>Who is answering, from the employee's own record: the person they are talking to hears the employee, not a general assistant.</summary>
    public static string AsEmployee(JsonObject? employee)
    {
        var name = Json.Str(employee, "name") ?? "the employee";
        var role = Json.Str(employee, "role") ?? "employee";
        var mandate = Json.Str(employee?["jobDescription"] as JsonObject, "mandate");
        return $"You are {name}, {role} in this organisation, and the owner is talking to you directly. Answer as {name}, in the first person, from your job and from what you remember (below)."
            + (string.IsNullOrWhiteSpace(mandate) ? "" : $"\nYour job, as written in your job description: {mandate.Trim()}")
            + "\nIf you learn something worth keeping for your work here, keep it with remember (at most twice).";
    }

    /// <summary>The previous turns, followed back through each run's parent; every read has a limit.</summary>
    private static async Task<string> EarlierTurnsAsync(RunContext run, CancellationToken cancellationToken)
    {
        var turns = new List<string>();
        var parent = run.Run.ParentRunId;
        while (parent is { } id && turns.Count < TurnsRemembered)
        {
            var events = await run.ControlPlane.ReadEventsAsync(id, 0, 500, cancellationToken);
            var asked = events.FirstOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "from") == "owner");
            var said = events.LastOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "from") == "assistant");
            turns.Add($"Owner: {Json.Str(asked?.Payload, "text")}\nYou: {Json.Str(said?.Payload, "text") ?? "(no answer)"}");
            parent = (await run.ControlPlane.GetRunAsync(id, cancellationToken)).ParentRunId;
        }

        turns.Reverse();
        var sb = new StringBuilder();
        foreach (var turn in turns)
        {
            sb.Append(OutputText.Truncate(turn, 3000)).Append('\n');
        }

        return sb.ToString();
    }
}

/// <summary>
/// A <c>review</c> run. A <b>memory review</b> (the owner's <c>POST /api/employees/{id}/reviews</c>): the
/// employee's curated memory is consolidated, pruned and corrected, and the result applied through
/// <c>POST /internal/employees/{id}/memory/review</c>. Otherwise, the security reviewer on one app.
/// </summary>
public sealed class ReviewWorkflow : IWorkflow
{
    public const string MemoryReviewKind = "memory.review";

    public string Kind => RunKinds.Review;

    public Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        return Json.Str(run.OwnerMessage(), "kind") == MemoryReviewKind ? MemoryReviewAsync(run, cancellationToken) : SecurityReviewAsync(run, cancellationToken);
    }

    private static async Task<WorkflowOutcome> MemoryReviewAsync(RunContext run, CancellationToken cancellationToken)
    {
        var owner = run.OwnerMessage();
        if ((Guid.TryParse(Json.Str(owner, "employeeId"), out var id) ? id : run.Run.EmployeeId) is not { } employeeId)
        {
            return WorkflowOutcome.Failure("A memory review is of one employee, and this run names none.");
        }

        if (run.Journal.Get("memory.review.applied") is { } done)
        {
            return WorkflowOutcome.Success(Json.Str(done, "summary") ?? "The memory review was applied.") with { Announced = true };
        }

        var entries = await run.ControlPlane.MemoryAsync(employeeId, null, cancellationToken);
        var employee = (await run.ControlPlane.EmployeesAsync(run.Run.Scope, cancellationToken)).FirstOrDefault(e => e.Id == employeeId);
        var name = employee?.Name ?? "The employee";
        if (entries.Count == 0)
        {
            await run.ControlPlane.ApplyMemoryReviewAsync(employeeId, run.Run.Id, [], [], [], cancellationToken);
            const string empty = "There was nothing to review: the memory is empty.";
            await run.Journal.RecordAsync("memory.review.applied", new JsonObject { ["summary"] = empty }, cancellationToken);
            await Workforce.SayAsync(run, "runner", "Memory reviewed", $"{name}'s memory is empty, so there was nothing to review.", cancellationToken, "memory.reviewed");
            return WorkflowOutcome.Success(empty) with { Announced = true };
        }

        var listing = string.Join("\n", entries.Select(e => $"- id {e.Id:D} ({e.Kind}, about {e.Scope}) {e.Title}: {e.Body.ReplaceLineEndings(" ")}"));
        var prompt = RunnerResources.Prompt("memory-review", new Dictionary<string, string> { ["name"] = name, ["role"] = employee?.Role ?? "employee", ["entries"] = listing });
        var agent = run.Agents.Researcher(run, "memory-reviewer", prompt) with
        {
            TaskType = run.Options.SummaryTaskType,
            EmployeeId = employeeId,
            Limits = new AgentLimits { MaxSteps = 3, MaxOutputTokens = 6000, MaxSearchesPerCall = 0 },
        };
        var result = await WorkflowSupport.RunAgentAsync(run, agent, NoWorkspace.Instance, "Review the memory now and reply with the JSON object.", cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is { } stopped)
        {
            return stopped;
        }

        if (WorkflowSupport.JsonAnswer(result.FinalText) is not { } answer)
        {
            return WorkflowOutcome.Failure("The review gave no answer in the agreed form, so the memory was left as it was.");
        }

        var (merged, removed, corrected, dropped) = MemoryReview.Clean(answer, entries);
        await run.ControlPlane.ApplyMemoryReviewAsync(employeeId, run.Run.Id, merged, removed, corrected, cancellationToken);
        var summary = Sentences.Join([
            $"Reviewed {entries.Count} entr{(entries.Count == 1 ? "y" : "ies")} of {name}'s memory: {merged.Count} merged, {removed.Count} removed, {corrected.Count} corrected, the rest kept",
            dropped > 0 ? $"{dropped} suggested change{(dropped == 1 ? " was" : "s were")} not applied because {(dropped == 1 ? "it" : "they")} named entries that do not exist or named one twice" : null,
        ]);
        await run.Journal.RecordAsync("memory.review.applied", new JsonObject { ["summary"] = summary }, cancellationToken);
        await Workforce.SayAsync(run, "runner", "Memory reviewed", summary, cancellationToken, "memory.reviewed");
        return WorkflowOutcome.Success(summary) with { Announced = true };
    }

    private static async Task<WorkflowOutcome> SecurityReviewAsync(RunContext run, CancellationToken cancellationToken)
    {
        if (run.LevelId("app") is not { } appId)
        {
            return WorkflowOutcome.Failure("A review is of an app, and this run's scope names none.");
        }

        var (workspace, _) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), cancellationToken);
        var reviewer = await Workforce.StandingReviewerAsync(run, cancellationToken);
        var agent = AgentFactory.As(run, run.Agents.SecurityReviewer(run, workspace.Root), reviewer, await Workforce.MemoryBlockAsync(run, reviewer, run.Run.Scope, cancellationToken), canRemember: true);
        var result = await WorkflowSupport.RunAgentAsync(run, agent, workspace, "Review the app now against your checklist, then reply with the JSON object.", cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is { } stopped)
        {
            return stopped;
        }

        var report = WorkflowSupport.JsonAnswer(result.FinalText);
        if (report is null)
        {
            return WorkflowOutcome.Failure("The review gave no report, so the app is not cleared.");
        }

        var findings = report["findings"] as JsonArray ?? [];
        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "security-reviewer", ["kind"] = "security.review", ["passed"] = findings.Count == 0, ["findings"] = findings.DeepClone() }, cancellationToken);
        return findings.Count == 0
            ? WorkflowOutcome.Success("The security review found nothing that blocks publishing.")
            : WorkflowOutcome.Failure($"The security review found {findings.Count} problem{(findings.Count == 1 ? "" : "s")} that block publishing.");
    }
}

/// <summary>A review's answer, checked against the memory it was given: unknown ids, ids used twice and unreadable items are dropped, never guessed.</summary>
public static class MemoryReview
{
    private static readonly string[] Kinds = ["fact", "practice", "preference", "lesson"];

    public static (JsonArray Merged, JsonArray Removed, JsonArray Corrected, int Dropped) Clean(JsonObject answer, IReadOnlyList<MemoryEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(answer);
        ArgumentNullException.ThrowIfNull(entries);
        var live = entries.ToDictionary(e => e.Id);
        var used = new HashSet<Guid>();
        var dropped = 0;
        bool Claim(IEnumerable<Guid?> ids)
        {
            var list = ids.ToList();
            if (list.Any(i => i is null || !live.ContainsKey(i.Value) || used.Contains(i.Value)) || list.Distinct().Count() != list.Count)
            {
                dropped++;
                return false;
            }

            foreach (var i in list)
            {
                used.Add(i!.Value);
            }

            return true;
        }

        static Guid? Id(JsonNode? node) => Guid.TryParse(node?.ToString(), out var g) ? g : null;
        string Kind(JsonObject o, Guid? fallbackFrom) => Json.Str(o, "kind") is { } k && Kinds.Contains(k) ? k : fallbackFrom is { } f && live.TryGetValue(f, out var e) ? e.Kind : "fact";

        var merged = new JsonArray();
        foreach (var m in (answer["merged"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var from = (m["from"] as JsonArray ?? []).Select(Id).ToList();
            if (from.Count < 2 || string.IsNullOrWhiteSpace(Json.Str(m, "title")) || string.IsNullOrWhiteSpace(Json.Str(m, "body")) || !Claim(from))
            {
                dropped += from.Count < 2 || string.IsNullOrWhiteSpace(Json.Str(m, "title")) || string.IsNullOrWhiteSpace(Json.Str(m, "body")) ? 1 : 0;
                continue;
            }

            merged.Add(new JsonObject { ["from"] = new JsonArray(from.Select(f => (JsonNode)f!.Value.ToString()).ToArray()), ["title"] = OutputText.Truncate(Json.Str(m, "title")!, 120), ["body"] = OutputText.Truncate(Json.Str(m, "body")!, 1000), ["kind"] = Kind(m, from[0]) });
        }

        var removed = new JsonArray();
        foreach (var r in (answer["removed"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var id = Id(r["id"]);
            if (!Claim([id]))
            {
                continue;
            }

            removed.Add(new JsonObject { ["id"] = id!.Value.ToString(), ["why"] = OutputText.Truncate(Json.Str(r, "why") ?? "Stale.", 500) });
        }

        var corrected = new JsonArray();
        foreach (var c in (answer["corrected"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var id = Id(c["id"]);
            if (string.IsNullOrWhiteSpace(Json.Str(c, "why")) || !Claim([id]))
            {
                dropped += string.IsNullOrWhiteSpace(Json.Str(c, "why")) ? 1 : 0;
                continue;
            }

            var fix = new JsonObject { ["id"] = id!.Value.ToString(), ["why"] = OutputText.Truncate(Json.Str(c, "why")!, 500) };
            foreach (var key in new[] { "title", "body" })
            {
                if (Json.Str(c, key) is { Length: > 0 } value)
                {
                    fix[key] = OutputText.Truncate(value, key == "title" ? 120 : 1000);
                }
            }

            if (Json.Str(c, "kind") is { } kind && Kinds.Contains(kind))
            {
                fix["kind"] = kind;
            }

            corrected.Add(fix);
        }

        return (merged, removed, corrected, dropped);
    }
}
