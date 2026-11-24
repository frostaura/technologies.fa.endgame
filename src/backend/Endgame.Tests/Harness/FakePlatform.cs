using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Platform;
using Endgame.Harness.Workspaces;
using Endgame.Runner.Platform;

namespace Endgame.Tests.Harness;

/// <summary>
/// The control plane's internal API in memory, for deterministic workflow tests: one run and its
/// log, the cascade, approvals, tasks, verdicts, tree nodes, app tokens, headroom and cost history.
/// It keeps the real rules that matter here: gapless sequence numbers, a closed log once finished,
/// lifecycle events moving the run's status.
/// </summary>
public sealed class FakeControlPlane : HttpMessageHandler
{
    private readonly Lock gate = new();

    public FakeControlPlane(string scope, string kind, string? ownerText = null, Guid? ideaId = null)
    {
        Run = new JsonObject
        {
            ["id"] = RunId.ToString(),
            ["scope"] = scope,
            ["kind"] = kind,
            ["status"] = "running",
            ["title"] = "Test run",
            ["ideaId"] = ideaId?.ToString(),
            ["leaseHolder"] = "runner-test",
            ["leaseExpiresAt"] = DateTimeOffset.UtcNow.AddMinutes(5).ToString("O"),
            ["lastSeq"] = 0,
            ["budgetExhausted"] = false,
        };
        var parts = scope.Split('/');
        string[] levels = ["organisation", "division", "project", "app"];
        Context = new JsonObject
        {
            ["scope"] = scope,
            ["levels"] = new JsonArray(parts.Select((p, i) => (JsonNode)new JsonObject
            {
                ["level"] = levels[i],
                ["id"] = Guid.NewGuid().ToString(),
                ["slug"] = p,
                ["name"] = p,
                ["status"] = "active",
                ["path"] = string.Join('/', parts.Take(i + 1)),
            }).ToArray()),
            ["context"] = new JsonArray(),
            ["ruleSets"] = new JsonArray(),
            ["budgets"] = new JsonArray(),
            ["settings"] = new JsonArray(),
            ["secrets"] = new JsonArray(),
            ["permissions"] = new JsonArray(),
        };
        if (ownerText is not null)
        {
            Append("message", new JsonObject { ["from"] = "owner", ["text"] = ownerText, ["constraints"] = "" });
        }
    }

    public Guid RunId { get; } = Guid.NewGuid();

    public JsonObject Run { get; }

    public JsonObject Context { get; }

    public List<(long Seq, string Type, JsonObject Payload)> Events { get; } = [];

    public decimal? Headroom { get; set; }

    public List<decimal> History { get; } = [];

    /// <summary>How the owner answers each approval; null leaves it pending.</summary>
    public Func<string, bool?> AnswerApproval { get; set; } = _ => true;

    public List<string> Approvals { get; } = [];

    public JsonObject? Verdict { get; private set; }

    public List<JsonObject> Nodes { get; } = [];

    public List<string> Requests { get; } = [];

    public ControlPlaneClient Client() => new(new HttpClient(this) { BaseAddress = new Uri("http://control-plane") });

    public RunInfo Info() => System.Text.Json.JsonSerializer.Deserialize<RunInfo>(Run.ToJsonString(), Endgame.Harness.Kernel.Json.Web)!;

    public IReadOnlyList<string> Types => Events.Select(e => e.Type).ToList();

    public void Setting(string key, JsonNode value) =>
        Context["settings"]!.AsArray().Add(new JsonObject { ["kind"] = "setting", ["key"] = key, ["value"] = value, ["setAtLevel"] = "organisation", ["setAtPath"] = "frostaura" });

    public void RuleSet(string key, JsonNode value) =>
        Context["ruleSets"]!.AsArray().Add(new JsonObject { ["kind"] = "rule_set", ["key"] = key, ["value"] = value, ["setAtLevel"] = "organisation", ["setAtPath"] = "frostaura" });

    public JsonObject? Payload(string type) => Events.LastOrDefault(e => e.Type == type).Payload;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri.Query);
        var body = request.Content is null ? null : JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken) is { Length: > 0 } t ? t : "null");
        lock (gate)
        {
            Requests.Add($"{request.Method} {path}");
            var run = $"/internal/runs/{RunId:D}";
            return (request.Method.Method, path) switch
            {
                ("GET", var p) when p == run => Json(Run),
                ("POST", var p) when p == run + "/lease" => Json(Lease(body!.AsObject())),
                ("GET", var p) when p == run + "/events" => Json(new JsonArray(Events.Where(e => e.Seq > long.Parse(query["after"] ?? "0")).Take(int.Parse(query["limit"] ?? "500"))
                    .Select(e => (JsonNode)new JsonObject { ["seq"] = e.Seq, ["type"] = e.Type, ["payload"] = e.Payload.DeepClone() }).ToArray())),
                ("POST", var p) when p == run + "/events" => AppendAll(body!.AsObject()),
                ("GET", "/internal/context") => Json(Context),
                ("POST", "/internal/approvals") => Approve(body!.AsObject()),
                ("POST", "/internal/tasks") => Json(new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["title"] = body!["title"]?.ToString(), ["status"] = "todo" }, HttpStatusCode.Created),
                ("POST", "/internal/tasks/checkout") => Json(new JsonObject { ["id"] = body!["taskId"]?.ToString(), ["title"] = "t", ["status"] = "in_progress", ["holderRunId"] = RunId.ToString() }),
                ("PATCH", var p) when p.StartsWith("/internal/tasks/", StringComparison.Ordinal) => Json(new JsonObject { ["id"] = p[16..], ["title"] = "t", ["status"] = body!["status"]?.ToString() }),
                ("POST", var p) when p.StartsWith("/internal/ideas/", StringComparison.Ordinal) && p.EndsWith("/verdict", StringComparison.Ordinal) => RecordVerdict(body!.AsObject()),
                ("POST", "/internal/tree/nodes") => Node(body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/apps/", StringComparison.Ordinal) && p.EndsWith("/token", StringComparison.Ordinal) => Json(new JsonObject { ["token"] = "app-token-for-test" }),
                ("GET", "/internal/credits/headroom") => Headroom is { } h ? Json(new JsonObject { ["headroomCredits"] = h }) : Problem(HttpStatusCode.NotFound, "not_found", "No such endpoint."),
                ("GET", "/internal/estimates/history") => Json(new JsonArray(History.Select(c => (JsonNode)new JsonObject { ["credits"] = c }).ToArray())),
                ("GET", "/internal/employees") => Json(new JsonArray(new JsonObject { ["name"] = "Ada", ["role"] = "Builder" })),
                _ => Problem(HttpStatusCode.NotFound, "not_found", $"{request.Method} {path} is not served by the fake."),
            };
        }
    }

    public void Append(string type, JsonObject payload)
    {
        lock (gate)
        {
            if (Events.Count > 0 && Events[^1].Type == "run.finished")
            {
                throw new InvalidOperationException("closed");
            }

            Events.Add((Events.Count + 1, type, payload));
            Run["lastSeq"] = Events.Count;
            switch (type)
            {
                case "run.paused":
                    Run["status"] = "paused";
                    break;
                case "run.finished":
                    Run["status"] = payload["outcome"]!.GetValue<string>();
                    Run["summary"] = payload["summary"]?.ToString();
                    break;
            }
        }
    }

    private JsonObject Lease(JsonObject body)
    {
        Run["leaseExpiresAt"] = DateTimeOffset.UtcNow.AddSeconds(body["seconds"]!.GetValue<int>()).ToString("O");
        return Run;
    }

    private HttpResponseMessage AppendAll(JsonObject body)
    {
        if (Run["status"]!.GetValue<string>() is "succeeded" or "failed" or "cancelled")
        {
            return Problem(HttpStatusCode.Conflict, "conflict", "The run has finished; its log is closed.");
        }

        var appended = new JsonArray();
        foreach (var e in body["events"]!.AsArray().OfType<JsonObject>())
        {
            Append(e["type"]!.GetValue<string>(), e["payload"]?.DeepClone().AsObject() ?? []);
            appended.Add(new JsonObject { ["seq"] = Events.Count, ["type"] = e["type"]!.GetValue<string>(), ["payload"] = Events[^1].Payload.DeepClone() });
        }

        return Json(appended);
    }

    private HttpResponseMessage Approve(JsonObject body)
    {
        var id = Guid.NewGuid().ToString();
        var title = body["title"]!.GetValue<string>();
        Approvals.Add(title);
        Append("approval.requested", new JsonObject { ["approvalId"] = id, ["title"] = title });
        if (AnswerApproval(title) is { } answer)
        {
            Append("approval.answered", new JsonObject { ["approvalId"] = id, ["answer"] = answer ? "approved" : "rejected" });
        }

        return Json(new JsonObject { ["id"] = id, ["title"] = title, ["status"] = "pending" }, HttpStatusCode.Created);
    }

    private HttpResponseMessage RecordVerdict(JsonObject verdict)
    {
        Verdict = verdict.DeepClone().AsObject();
        return Json(new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["status"] = "awaiting_decision", ["verdict"] = verdict["outcome"]?.ToString() });
    }

    private HttpResponseMessage Node(JsonObject body)
    {
        var node = new JsonObject
        {
            ["id"] = Guid.NewGuid().ToString(),
            ["level"] = body["level"]?.ToString(),
            ["name"] = body["name"]?.ToString(),
            ["slug"] = body["slug"]?.ToString(),
            ["path"] = $"{body["parent"]}/{body["slug"]}",
        };
        Nodes.Add(node);
        return Json(node, HttpStatusCode.Created);
    }

    private static HttpResponseMessage Json(JsonNode body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Problem(HttpStatusCode status, string code, string detail) =>
        Json(new JsonObject { ["status"] = (int)status, ["code"] = code, ["detail"] = detail }, status);
}

/// <summary>Dock's app lifecycle in memory: builds and private starts, recorded.</summary>
public sealed class FakeDock : HttpMessageHandler
{
    public List<string> Calls { get; } = [];

    public List<JsonObject> Starts { get; } = [];

    public bool FailBuild { get; set; }

    public DockClient Client() => new(new HttpClient(this) { BaseAddress = new Uri("http://dock") });

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var path = request.RequestUri!.AbsolutePath;
        Calls.Add($"{request.Method} {path}");
        var body = request.Content is null ? null : JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken) is { Length: > 0 } t ? t : "null");
        var appId = path.Split('/').Length > 3 ? path.Split('/')[3] : "";
        if (path.EndsWith("/build", StringComparison.Ordinal))
        {
            return FailBuild
                ? Json(new JsonObject { ["code"] = "build_failed", ["detail"] = "error CS1002: ; expected" }, HttpStatusCode.UnprocessableEntity)
                : Json(new JsonObject { ["appId"] = appId, ["commit"] = "c0010000", ["image"] = $"app-{appId}:c001", ["durationMs"] = 6000, ["logTail"] = "Build succeeded." });
        }

        if (path.EndsWith("/start", StringComparison.Ordinal))
        {
            Starts.Add(body!.AsObject());
            return Json(Status(appId));
        }

        if (path.StartsWith("/internal/repos", StringComparison.Ordinal))
        {
            return Json(new JsonObject { ["appId"] = appId, ["branch"] = "main", ["head"] = "c0000000" }, HttpStatusCode.Created);
        }

        return Json(Status(appId));
    }

    private static JsonObject Status(string appId) => new()
    {
        ["appId"] = appId,
        ["state"] = "running",
        ["image"] = $"app-{appId}:c001",
        ["commit"] = "c0010000",
        ["target"] = $"app-{appId}:8080",
        ["outOfMemory"] = false,
    };

    private static HttpResponseMessage Json(JsonNode body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
}

/// <summary>A workspace provider over one in-memory workspace.</summary>
public sealed class FakeWorkspaces(FakeWorkspace workspace) : IWorkspaceProvider
{
    public int Released { get; private set; }

    public Task<(IWorkspace Workspace, bool Recreated)> EnsureAsync(Guid runId, Guid appId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken) =>
        Task.FromResult<(IWorkspace, bool)>((workspace, false));

    public Task RenewAsync(Guid runId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task ReleaseAsync(Guid runId, CancellationToken cancellationToken)
    {
        Released++;
        return Task.CompletedTask;
    }
}
