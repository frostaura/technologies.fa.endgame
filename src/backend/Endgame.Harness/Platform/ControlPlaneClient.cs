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

/// <summary>A tree node the factory created or found.</summary>
public sealed record NodeInfo(Guid Id, string Path, string Name, string Slug);

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

    public async Task<Guid> RaiseApprovalAsync(Guid runId, string title, string detail, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/approvals", new { runId, title, detail }, Json.Web, cancellationToken);
        var approval = await ReadAsync<JsonObject>(response, cancellationToken);
        return Guid.Parse(Json.Str(approval, "id")!);
    }

    public async Task<TaskInfo> CreateTaskAsync(string scope, Guid? runId, string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tasks", new { scope, runId, title, description, estimateCredits, dependsOn }, Json.Web, cancellationToken);
        return Task(await ReadAsync<JsonObject>(response, cancellationToken));
    }

    public async Task<TaskInfo> CheckoutTaskAsync(Guid taskId, Guid runId, Guid? employeeId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tasks/checkout", new { taskId, runId, employeeId, expectedStatus, expectedHolderRunId }, Json.Web, cancellationToken);
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

    /// <summary>Research's verdict document (outcome, headline, summary, existing, gap, demand, wouldChange, method).</summary>
    public async Task RecordVerdictAsync(Guid ideaId, JsonObject verdict, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsync($"/internal/ideas/{ideaId:D}/verdict", JsonContent.Create(verdict, options: Json.Web), cancellationToken);
        await ReadAsync<JsonObject>(response, cancellationToken);
    }

    /// <summary>Proposed: <c>POST /internal/tree/nodes</c> {parent, level, name, slug} → the node (201), or the existing one (200).</summary>
    public async Task<NodeInfo> EnsureNodeAsync(string parent, string level, string name, string slug, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/tree/nodes", new { parent, level, name, slug }, Json.Web, cancellationToken);
        var node = await ReadAsync<JsonObject>(response, cancellationToken);
        return new NodeInfo(Guid.Parse(Json.Str(node, "id")!), Json.Str(node, "path") ?? $"{parent}/{slug}", Json.Str(node, "name") ?? name, Json.Str(node, "slug") ?? slug);
    }

    /// <summary>Proposed: <c>POST /internal/apps/{id}/token</c> → {token}: the app token Dock injects at start.</summary>
    public async Task<string> MintAppTokenAsync(Guid appId, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsync($"/internal/apps/{appId:D}/token", null, cancellationToken);
        return Json.Str(await ReadAsync<JsonObject>(response, cancellationToken), "token") ?? throw new InvalidOperationException("The control plane minted no token.");
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

    /// <summary>Proposed: <c>GET /internal/estimates/history?taskType=&amp;limit=</c> → [{credits, steps}] of finished runs' actuals.</summary>
    public async Task<IReadOnlyList<decimal>> CostHistoryAsync(string taskType, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/estimates/history?taskType={Uri.EscapeDataString(taskType)}&limit=50", cancellationToken);
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

    public async Task<bool> RequestAsync(string title, string detail, CancellationToken cancellationToken)
    {
        var approvalId = await client.RaiseApprovalAsync(runId, title, detail, cancellationToken);
        long after = 0;
        while (true)
        {
            var page = await client.ReadEventsAsync(runId, after, 500, cancellationToken);
            foreach (var e in page)
            {
                after = e.Seq;
                if (e.Type == RunEventTypes.ApprovalAnswered && Json.Str(e.Payload, "approvalId") == approvalId.ToString())
                {
                    return Json.Str(e.Payload, "answer") == ApprovalStatuses.Approved;
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
