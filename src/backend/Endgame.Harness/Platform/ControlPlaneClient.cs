using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Tasks;

namespace Endgame.Harness.Platform;

/// <summary>A run as the control plane reports it (its <c>RunView</c>).</summary>
public sealed record RunInfo(
    Guid Id,
    string Scope,
    string Kind,
    string Status,
    string Title,
    Guid? EmployeeId,
    Guid? IdeaId,
    Guid? ConversationId,
    Guid? ParentRunId,
    string? LeaseHolder,
    DateTimeOffset? LeaseExpiresAt,
    long LastSeq,
    bool BudgetExhausted,
    string? Outcome,
    string? Summary);

/// <summary>A tree node the factory created or found; <paramref name="Created"/> when this call made it.</summary>
public sealed record NodeInfo(Guid Id, string Path, string Name, string Slug, bool Created = false);

/// <summary>An employee or a working contractor, as the Runner needs it.</summary>
public sealed record EmployeeInfo(Guid Id, string Kind, string Name, string Role, string Status, string? Standing, string Scope);

/// <summary>A hire the Runner raised: accepted at once (auto-mode, within budget) with its employee, or waiting for the owner.</summary>
public sealed record HireOutcome(Guid HireId, string Status, Guid? EmployeeId, bool Created, bool WithinBudget, decimal ExpectedMonthlyCredits);

/// <summary>One entry of an employee's curated memory.</summary>
public sealed record MemoryEntry(Guid Id, string Title, string Body, string Kind, string Scope);

/// <summary>A memory entry an employee proposes after a task.</summary>
public sealed record MemoryNote(string Title, string Body, string Kind, string? Scope = null);

/// <summary>What auto-mode's decision after a verdict came to.</summary>
public enum AutoDecision
{
    /// <summary>The build has been queued.</summary>
    Building,

    /// <summary>A do-not-build, or checkpoints are on: the owner decides.</summary>
    WaitingForOwner,

    /// <summary>A breached red line: nobody builds it.</summary>
    RedLine,
}

/// <summary>The control plane refused a verdict document, naming each fault (<c>400 verdict_invalid</c>).</summary>
public sealed class VerdictRefusedException(IReadOnlyList<string> errors) : Exception($"The verdict was refused: {string.Join("; ", errors.Take(5))}")
{
    public IReadOnlyList<string> Errors { get; } = errors;
}

/// <summary>
/// The control plane's internal API (ARCH-004) for the Runner: runs and their log, leases, the
/// cascade, approvals, tasks and verdicts. Every call carries the service token (set on the client).
/// Methods marked "proposed" call endpoints this lane needs and has asked the control plane for.
/// </summary>
public sealed class ControlPlaneClient(HttpClient http)
{
    public HttpClient Http { get; } = http;

    /// <summary>Claims the oldest queued run, or one whose lease lapsed. Null when there is none.</summary>
    public async Task<RunInfo?> ClaimAsync(string holder, int leaseSeconds, IReadOnlyList<string> kinds, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/runs/claim", new { holder, leaseSeconds, kinds }, Json.Web, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NoContent)
        {
            return null;
        }

        return await ReadAsync<RunInfo>(response, cancellationToken);
    }

    /// <summary>Renews the lease. The answer carries the run's status, so a holder learns it was paused or cancelled.</summary>
    public async Task<RunInfo> LeaseAsync(Guid runId, string holder, int seconds, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/runs/{runId:D}/lease", new { holder, seconds }, Json.Web, cancellationToken);
        return await ReadAsync<RunInfo>(response, cancellationToken);
    }

    public async Task<RunInfo> GetRunAsync(Guid runId, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/runs/{runId:D}", cancellationToken);
        return await ReadAsync<RunInfo>(response, cancellationToken);
    }

    public async Task<IReadOnlyList<RunEvent>> AppendAsync(Guid runId, string? holder, IReadOnlyList<RunEvent> events, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(events);
        var body = new JsonObject
        {
            ["leaseHolder"] = holder,
            ["events"] = new JsonArray(events.Select(e => (JsonNode)new JsonObject { ["type"] = e.Type, ["payload"] = e.Payload.DeepClone() }).ToArray()),
        };
        using var response = await Http.PostAsync($"/internal/runs/{runId:D}/events", JsonContent.Create(body, options: Json.Web), cancellationToken);
        return Events(await ReadAsync<JsonArray>(response, cancellationToken));
    }

    public async Task<IReadOnlyList<RunEvent>> ReadEventsAsync(Guid runId, long after, int limit, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/runs/{runId:D}/events?after={after}&limit={limit}", cancellationToken);
        return Events(await ReadAsync<JsonArray>(response, cancellationToken));
    }

    /// <summary>The resolved cascade for a scope: context, rule sets, budgets, settings.</summary>
    public async Task<JsonObject> ContextAsync(string scope, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/context?scope={Uri.EscapeDataString(scope)}", cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary>
    /// Raises an approval. <paramref name="detail"/> is the plain sentence the owner reads; <paramref name="technical"/> (the
    /// tool, its arguments, the rule that asked) travels beside it for technical mode, never in its place (D71).
    /// </summary>
    public async Task<Guid> RaiseApprovalAsync(Guid runId, string title, string detail, CancellationToken cancellationToken, string? onDecline = null, string? technical = null)
    {
        using var response = await Http.PostAsJsonAsync("/internal/approvals", new { runId, title, detail, onDecline, technical }, Json.Web, cancellationToken);
        var approval = await ReadAsync<JsonObject>(response, cancellationToken);
        return Guid.Parse(Json.Str(approval, "id")!);
    }

    public async Task<TaskInfo> CreateTaskAsync(string scope, Guid? runId, string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tasks", new { scope, runId, title, description, estimateCredits, dependsOn }, Json.Web, cancellationToken);
        return Task(await ReadAsync<JsonObject>(response, cancellationToken));
    }

    /// <param name="holderTitle">Who does the work when no employee does (a hire still waiting for the owner), so the claim names someone.</param>
    public async Task<TaskInfo> CheckoutTaskAsync(Guid taskId, Guid runId, Guid? employeeId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken, string? holderTitle = null)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tasks/checkout", new { taskId, runId, employeeId, expectedStatus, expectedHolderRunId, holderTitle }, Json.Web, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            var problem = await response.Content.ReadFromJsonAsync<JsonObject>(Json.Web, cancellationToken);
            var current = problem?["task"] as JsonObject;
            throw new TaskConflictException(Json.Str(problem, "detail") ?? "The task could not be claimed.", current is null ? null : Task(current));
        }

        return Task(await ReadAsync<JsonObject>(response, cancellationToken));
    }

    public async Task<TaskInfo> PatchTaskAsync(Guid taskId, object patch, CancellationToken cancellationToken)
    {
        using var response = await Http.PatchAsJsonAsync($"/internal/tasks/{taskId:D}", patch, Json.Web, cancellationToken);
        return Task(await ReadAsync<JsonObject>(response, cancellationToken));
    }

    /// <summary>Research's verdict document (ARCH-004, <i>The verdict document</i>). A refused one throws <see cref="VerdictRefusedException"/> with every fault.</summary>
    public async Task RecordVerdictAsync(Guid ideaId, JsonObject verdict, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsync($"/internal/ideas/{ideaId:D}/verdict", JsonContent.Create(verdict, options: Json.Web), cancellationToken);
        if (response.StatusCode == HttpStatusCode.BadRequest)
        {
            var problem = GatewayModelClient.TryParse(await response.Content.ReadAsStringAsync(cancellationToken)) as JsonObject;
            if (Json.Str(problem, "code") == "verdict_invalid")
            {
                throw new VerdictRefusedException(Json.Strings(problem, "errors"));
            }

            throw new ServiceProblemException(response.StatusCode, Json.Str(problem, "code") ?? "bad_request", Json.Str(problem, "detail") ?? "The verdict was refused.");
        }

        await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary><c>POST /internal/ideas/{id}/decision</c> {decision: build, by: auto-mode}: auto-mode builds after a build or change verdict.</summary>
    public async Task<(AutoDecision Decision, Guid? RunId, string Detail)> BuildOnVerdictAsync(Guid ideaId, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/ideas/{ideaId:D}/decision", new { decision = "build", by = "auto-mode" }, Json.Web, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadFromJsonAsync<JsonObject>(Json.Web, cancellationToken);
            return (AutoDecision.Building, Guid.TryParse(Json.Str(body?["run"] as JsonObject, "id"), out var run) ? run : null, "");
        }

        var problem = await ServiceProblemException.FromAsync(response, cancellationToken);
        return problem.Code switch
        {
            "owner_decision_required" => (AutoDecision.WaitingForOwner, null, problem.Detail),
            "red_line" => (AutoDecision.RedLine, null, problem.Detail),
            _ => throw problem,
        };
    }

    /// <summary>The workforce at and beneath a scope (employees, and contractors while they work).</summary>
    /// <summary>One employee with its job description and track record (<c>GET /internal/employees/{id}</c>), as the control plane wrote it.</summary>
    /// <summary>
    /// The files sent with a conversation turn (<c>GET /internal/runs/{id}/attachments</c>): <c>{ runId, imagesAccepted,
    /// attachments: [{ id, name, kind, contentType, bytes, pages, characters, truncated, text, data }] }</c>, where
    /// <c>imagesAccepted</c> says whether <paramref name="taskType"/>'s route takes images and <c>data</c> is an image's base64.
    /// </summary>
    public async Task<JsonObject> RunAttachmentsAsync(Guid runId, string taskType, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/runs/{runId:D}/attachments?taskType={Uri.EscapeDataString(taskType)}", cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    public async Task<JsonObject> EmployeeAsync(Guid employeeId, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/employees/{employeeId:D}", cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    public async Task<IReadOnlyList<EmployeeInfo>> EmployeesAsync(string scope, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/employees?scope={Uri.EscapeDataString(scope)}", cancellationToken);
        return (await ReadAsync<JsonArray>(response, cancellationToken)).OfType<JsonObject>().Select(Employee).ToList();
    }

    /// <summary>Raises a need from the ontology (<c>POST /internal/hires</c>); the same <paramref name="needKey"/> again answers the live proposal.</summary>
    public async Task<HireOutcome> RaiseHireAsync(string scope, string trigger, string needKey, string reason, string name, string role, string mandate,
        IReadOnlyList<string> tools, IReadOnlyList<string> services, decimal monthlyCredits, string modelTier, Guid? reportsTo, Guid? runId, CancellationToken cancellationToken)
    {
        var body = new
        {
            scope,
            trigger,
            needKey,
            reason,
            name,
            role,
            jobDescription = new { mandate, tools, services, monthlyCreditLimit = monthlyCredits, modelTier },
            reportsTo,
            expectedMonthlyCredits = monthlyCredits,
            runId,
        };
        using var response = await Http.PostAsJsonAsync("/internal/hires", body, Json.Web, cancellationToken);
        var raised = await ReadAsync<JsonObject>(response, cancellationToken);
        var hire = raised["hire"] as JsonObject ?? [];
        return new HireOutcome(Guid.Parse(Json.Str(hire, "id")!), Json.Str(hire, "status") ?? "proposed", Guid.TryParse(Json.Str(hire, "employeeId"), out var e) ? e : null,
            Json.Bool(raised, "created") == true, Json.Bool(hire, "withinBudget") == true, Json.Dec(hire, "expectedMonthlyCredits") ?? monthlyCredits);
    }

    /// <summary>What an employee remembers that bears on a scope (at it, above it or beneath it); all of it when <paramref name="scope"/> is null.</summary>
    public async Task<IReadOnlyList<MemoryEntry>> MemoryAsync(Guid employeeId, string? scope, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/employees/{employeeId:D}/memory{(scope is null ? "" : $"?scope={Uri.EscapeDataString(scope)}")}", cancellationToken);
        return (await ReadAsync<JsonArray>(response, cancellationToken)).OfType<JsonObject>()
            .Select(m => new MemoryEntry(Guid.Parse(Json.Str(m, "id")!), Json.Str(m, "title") ?? "", Json.Str(m, "body") ?? "", Json.Str(m, "kind") ?? "fact", Json.Str(m, "scope") ?? ""))
            .ToList();
    }

    /// <summary>After a task, what the employee learned (1 to 20 entries).</summary>
    public async Task RememberAsync(Guid employeeId, Guid? runId, IReadOnlyList<MemoryNote> entries, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entries);
        if (entries.Count == 0)
        {
            return;
        }

        using var response = await Http.PostAsJsonAsync($"/internal/employees/{employeeId:D}/memory", new { runId, entries = entries.Take(20).Select(Note) }, Json.Web, cancellationToken);
        await ReadAsync<JsonArray>(response, cancellationToken);
    }

    /// <summary>A memory review's result: <c>{ merged, removed, corrected }</c>, applied in one transaction.</summary>
    public async Task<JsonObject> ApplyMemoryReviewAsync(Guid employeeId, Guid? runId, JsonArray merged, JsonArray removed, JsonArray corrected, CancellationToken cancellationToken)
    {
        var body = new JsonObject { ["runId"] = runId?.ToString(), ["merged"] = merged.DeepClone(), ["removed"] = removed.DeepClone(), ["corrected"] = corrected.DeepClone() };
        using var response = await Http.PostAsync($"/internal/employees/{employeeId:D}/memory/review", JsonContent.Create(body, options: Json.Web), cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary>A contractor briefed by an employee, on the chart while it works; its model calls carry its id.</summary>
    public async Task<Guid> StartContractorAsync(string scope, Guid briefedBy, string role, string? name, string brief, Guid? runId, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/contractors", new { scope, briefedBy, role, name, brief, runId }, Json.Web, cancellationToken);
        return Guid.Parse(Json.Str(await ReadAsync<JsonObject>(response, cancellationToken), "id")!);
    }

    /// <summary>The contractor is done: what it learned goes to its briefer's memory. Returns the promotion raised, if its role kept recurring.</summary>
    public async Task<JsonObject?> FinishContractorAsync(Guid contractorId, Guid? runId, IReadOnlyList<MemoryNote> learned, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/contractors/{contractorId:D}/finish", new { runId, learned = learned.Take(20).Select(Note) }, Json.Web, cancellationToken);
        return (await ReadAsync<JsonObject>(response, cancellationToken))["promotion"] as JsonObject;
    }

    /// <summary>The organisation graph at a scope (<c>view</c>: all, org-chart, data-flow).</summary>
    public async Task<JsonObject> OntologyAsync(string scope, string view, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/ontology?scope={Uri.EscapeDataString(scope)}&view={Uri.EscapeDataString(view)}", cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    private static object Note(MemoryNote n) => new { title = n.Title, body = n.Body, kind = n.Kind, scope = n.Scope };

    private static EmployeeInfo Employee(JsonObject o) =>
        new(Guid.Parse(Json.Str(o, "id")!), Json.Str(o, "kind") ?? "employee", Json.Str(o, "name") ?? "", Json.Str(o, "role") ?? "", Json.Str(o, "status") ?? "", Json.Str(o, "standing"), Json.Str(o, "scope") ?? "");

    /// <summary>Proposed: <c>POST /internal/tree/nodes</c> {parent, level, name, slug} → the node (201), or the existing one (200).</summary>
    public async Task<NodeInfo> EnsureNodeAsync(string parent, string level, string name, string slug, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tree/nodes", new { parent, level, name, slug }, Json.Web, cancellationToken);
        var created = response.StatusCode == HttpStatusCode.Created;
        var node = await ReadAsync<JsonObject>(response, cancellationToken);
        return new NodeInfo(Guid.Parse(Json.Str(node, "id")!), Json.Str(node, "path") ?? $"{parent}/{slug}", Json.Str(node, "name") ?? name, Json.Str(node, "slug") ?? slug, created);
    }

    /// <summary><c>POST /internal/apps/{id}/token</c> → {token}: the app token Dock injects at start; <paramref name="preview"/> mints the preview's own, whose e-mail is held.</summary>
    public async Task<string> MintAppTokenAsync(Guid appId, CancellationToken cancellationToken, bool preview = false)
    {
        using var response = await Http.PostAsync($"/internal/apps/{appId:D}/token{(preview ? "?preview=true" : "")}", null, cancellationToken);
        return Json.Str(await ReadAsync<JsonObject>(response, cancellationToken), "token") ?? throw new InvalidOperationException("The control plane minted no token.");
    }

    /// <summary><c>POST /internal/apps/{id}/test-session</c>: an app-scoped session for a named test member, for the evaluator's signed-in calls.</summary>
    public async Task<string> TestSessionAsync(Guid appId, string persona, string role, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/apps/{appId:D}/test-session", new { persona, role }, Json.Web, cancellationToken);
        return Json.Str(await ReadAsync<JsonObject>(response, cancellationToken), "sessionToken") ?? throw new InvalidOperationException("The control plane minted no session.");
    }

    /// <summary><c>GET /internal/apps/{id}/emails</c>: what the app asked the platform to send, newest first.</summary>
    public async Task<JsonArray> SentEmailsAsync(Guid appId, int limit, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/apps/{appId:D}/emails?limit={limit}", cancellationToken);
        return await ReadAsync<JsonArray>(response, cancellationToken);
    }

    /// <summary><c>POST /internal/apps/{id}/webhook-test</c>: a declared webhook called as its device would, signed by the control plane.</summary>
    public async Task<JsonObject> TestWebhookAsync(Guid appId, JsonObject request, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/apps/{appId:D}/webhook-test", request, Json.Web, cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary><c>GET /internal/runs/{id}/suggestion-context</c>: what a <c>suggest</c> run reads (ARCH-004).</summary>
    public async Task<JsonObject> SuggestionContextAsync(Guid runId, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/runs/{runId:D}/suggestion-context", cancellationToken);
        return await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary><c>POST /internal/runs/{id}/suggestions</c>: the run's one to five suggestions, once.</summary>
    public async Task<JsonArray> RecordSuggestionsAsync(Guid runId, JsonArray suggestions, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/runs/{runId:D}/suggestions", new JsonObject { ["suggestions"] = suggestions.DeepClone() }, Json.Web, cancellationToken);
        return await ReadAsync<JsonArray>(response, cancellationToken);
    }

    /// <summary>Proposed: <c>GET /internal/credits/headroom?scope=</c> → {headroomCredits, bindingScope}.</summary>
    public async Task<decimal?> HeadroomAsync(string scope, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/credits/headroom?scope={Uri.EscapeDataString(scope)}", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        return Json.Dec(await ReadAsync<JsonObject>(response, cancellationToken), "headroomCredits");
    }

    /// <summary><c>GET /internal/estimates/history?taskType=&amp;scope=&amp;limit=</c> → the billable actuals of finished runs of that kind in the scope's organisation, newest first.</summary>
    public async Task<IReadOnlyList<decimal>> CostHistoryAsync(string taskType, string scope, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/estimates/history?taskType={Uri.EscapeDataString(taskType)}&scope={Uri.EscapeDataString(scope)}&limit=50", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return [];
        }

        var rows = await ReadAsync<JsonArray>(response, cancellationToken);
        return rows.OfType<JsonObject>().Select(r => Json.Dec(r, "credits")).OfType<decimal>().ToList();
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
        where T : class
    {
        if (!response.IsSuccessStatusCode)
        {
            throw await ServiceProblemException.FromAsync(response, cancellationToken);
        }

        return await response.Content.ReadFromJsonAsync<T>(Json.Web, cancellationToken)
            ?? throw new InvalidOperationException($"The control plane answered {(int)response.StatusCode} with no body.");
    }

    private static List<RunEvent> Events(JsonArray rows) =>
        rows.OfType<JsonObject>().Select(r => new RunEvent(Json.Str(r, "type") ?? "", r["payload"] as JsonObject ?? []) { Seq = Json.Int(r, "seq") ?? 0 }).ToList();

    private static TaskInfo Task(JsonObject o) =>
        new(Guid.Parse(Json.Str(o, "id")!), Json.Str(o, "title") ?? "", Json.Str(o, "status") ?? "", Guid.TryParse(Json.Str(o, "holderRunId"), out var h) ? h : null, Json.Dec(o, "estimateCredits"));
}

/// <summary>The run log through the control plane, under the run's lease: every step of every agent lands here.</summary>
public sealed class ControlPlaneRunLog(ControlPlaneClient client, Guid runId, string holder) : IEventSink, IRunLogReader
{
    public Task<IReadOnlyList<RunEvent>> AppendAsync(IReadOnlyList<RunEvent> events, CancellationToken cancellationToken) =>
        client.AppendAsync(runId, holder, events, cancellationToken);

    public Task<IReadOnlyList<RunEvent>> ReadAsync(long afterSeq, int limit, CancellationToken cancellationToken) =>
        client.ReadEventsAsync(runId, afterSeq, limit, cancellationToken);
}

/// <summary>
/// A checkpoint: raises an approval through the control plane, then waits for
/// <c>approval.answered</c> in the run's own log. The lease keeps being renewed meanwhile.
/// </summary>
public sealed class ControlPlaneApprovals(ControlPlaneClient client, Guid runId, TimeSpan? pollInterval = null) : IApprovalGate
{
    private readonly TimeSpan poll = pollInterval ?? TimeSpan.FromSeconds(2);

    public async Task<bool> RequestAsync(string title, string detail, CancellationToken cancellationToken) =>
        (await AskAsync(title, detail, ApprovalConsequence.Continues, cancellationToken)).Approved;

    /// <summary>Raises the approval, saying what a decline does, and waits for the answer and the note that came with it.</summary>
    public Task<ApprovalAnswer> AskAsync(string title, string detail, string onDecline, CancellationToken cancellationToken) =>
        AskAsync(title, detail, onDecline, null, cancellationToken);

    /// <summary>The same, with the technical detail kept apart from the plain one.</summary>
    public async Task<ApprovalAnswer> AskAsync(string title, string detail, string onDecline, string? technical, CancellationToken cancellationToken)
    {
        var approvalId = await client.RaiseApprovalAsync(runId, title, detail, cancellationToken, onDecline, technical);
        long after = 0;
        while (true)
        {
            var page = await client.ReadEventsAsync(runId, after, 500, cancellationToken);
            foreach (var e in page)
            {
                after = e.Seq;
                if (e.Type == RunEventTypes.ApprovalAnswered && Json.Str(e.Payload, "approvalId") == approvalId.ToString())
                {
                    return new ApprovalAnswer(Json.Str(e.Payload, "answer") == ApprovalStatuses.Approved, Json.Str(e.Payload, "comment"));
                }

                if (e.Type == RunEventTypes.RunFinished)
                {
                    throw new OperationCanceledException("The run finished while it waited for an approval.");
                }
            }

            if (page.Count < 500)
            {
                await Task.Delay(poll, cancellationToken);
            }
        }
    }
}

/// <summary>The task graph through the control plane, claimed for this run.</summary>
public sealed class ControlPlaneTaskBoard(ControlPlaneClient client, string scope, Guid runId, Guid? employeeId) : ITaskBoard
{
    public Task<TaskInfo> CreateAsync(string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken) =>
        client.CreateTaskAsync(scope, runId, title, description, estimateCredits, dependsOn, cancellationToken);

    public Task<TaskInfo> CheckoutAsync(Guid taskId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken) =>
        client.CheckoutTaskAsync(taskId, runId, employeeId, expectedStatus, expectedHolderRunId, cancellationToken);

    public Task<TaskInfo> FinishAsync(Guid taskId, string status, string summary, decimal? actualCredits, CancellationToken cancellationToken) =>
        client.PatchTaskAsync(taskId, new { status, summary, actualCredits }, cancellationToken);
}
