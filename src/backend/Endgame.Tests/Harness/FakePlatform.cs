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

    /// <summary>Each approval as it was raised: title, detail and what a decline does.</summary>
    public List<JsonObject> ApprovalsAsked { get; } = [];

    /// <summary>The note the person sends with every answer.</summary>
    public string? ApprovalNote { get; set; }

    /// <summary>The logs of earlier runs, read by id (a retry carries on from one).</summary>
    public Dictionary<Guid, List<(long Seq, string Type, JsonObject Payload)>> EarlierRuns { get; } = [];

    /// <summary>What <c>GET /internal/employees/{id}</c> answers, by id.</summary>
    public Dictionary<Guid, JsonObject> EmployeeDetails { get; } = [];

    public JsonObject? Verdict { get; private set; }

    public List<JsonObject> Nodes { get; } = [];

    public List<string> Requests { get; } = [];

    /// <summary>Every request with its query string, for asserting what was sent.</summary>
    public List<string> Addresses { get; } = [];

    /// <summary>Hires raised, by need key; accepted at once unless <see cref="HiresWait"/>.</summary>
    public Dictionary<string, JsonObject> Hires { get; } = [];

    public bool HiresWait { get; set; }

    /// <summary>The standing security reviewer every organisation has.</summary>
    public Guid Reviewer { get; } = Guid.NewGuid();

    /// <summary>Memory per employee: what a run reads, and what it wrote.</summary>
    public Dictionary<Guid, List<JsonObject>> Memory { get; } = [];

    public List<JsonObject> MemoryReviews { get; } = [];

    public List<JsonObject> Contractors { get; } = [];

    public List<JsonObject> ContractorsFinished { get; } = [];

    /// <summary>Auto-mode's answer: null builds (200), or a problem code it is refused with.</summary>
    public string? DecisionRefusal { get; set; }

    public List<string> Decisions { get; } = [];

    /// <summary>Faults the control plane names when refusing the first verdict(s); each refusal takes one.</summary>
    public Queue<string[]> VerdictRefusals { get; } = new();

    /// <summary>What a suggest run reads (null: this is not a suggest run, 409).</summary>
    public JsonObject? SuggestionContext { get; set; }

    /// <summary>What a suggest run recorded, once.</summary>
    public JsonArray? Suggestions { get; private set; }

    /// <summary>The task graph: every task created, as the control plane would hold it.</summary>
    public List<JsonObject> Tasks { get; } = [];

    /// <summary>Schedules the app declares, as the ontology shows them.</summary>
    public List<string> Schedules { get; } = [];

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
            Addresses.Add($"{request.Method} {request.RequestUri.PathAndQuery}");
            var run = $"/internal/runs/{RunId:D}";
            return (request.Method.Method, path) switch
            {
                ("GET", var p) when p == run => Json(Run),
                ("POST", var p) when p == run + "/lease" => Json(Lease(body!.AsObject())),
                ("GET", var p) when p == run + "/events" => Json(new JsonArray(Events.Where(e => e.Seq > long.Parse(query["after"] ?? "0")).Take(int.Parse(query["limit"] ?? "500"))
                    .Select(e => (JsonNode)new JsonObject { ["seq"] = e.Seq, ["type"] = e.Type, ["payload"] = e.Payload.DeepClone() }).ToArray())),
                ("POST", var p) when p == run + "/events" => AppendAll(body!.AsObject()),
                ("GET", var p) when p.StartsWith("/internal/runs/", StringComparison.Ordinal) && p.EndsWith("/events", StringComparison.Ordinal) && EarlierRuns.TryGetValue(Guid.Parse(p[15..^7]), out var earlier) =>
                    Json(new JsonArray(earlier.Where(e => e.Seq > long.Parse(query["after"] ?? "0")).Take(int.Parse(query["limit"] ?? "500"))
                        .Select(e => (JsonNode)new JsonObject { ["seq"] = e.Seq, ["type"] = e.Type, ["payload"] = e.Payload.DeepClone() }).ToArray())),
                ("GET", var p) when p.StartsWith("/internal/employees/", StringComparison.Ordinal) && Guid.TryParse(p[20..], out var who) && EmployeeDetails.TryGetValue(who, out var detail) => Json(detail),
                ("GET", "/internal/context") => Json(Context),
                ("POST", "/internal/approvals") => Approve(body!.AsObject()),
                ("POST", "/internal/tasks") => CreateTask(body!.AsObject()),
                ("POST", "/internal/tasks/checkout") => Checkout(body!.AsObject()),
                ("PATCH", var p) when p.StartsWith("/internal/tasks/", StringComparison.Ordinal) => FinishTask(Guid.Parse(p[16..]), body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/ideas/", StringComparison.Ordinal) && p.EndsWith("/verdict", StringComparison.Ordinal) => RecordVerdict(body!.AsObject()),
                ("POST", "/internal/tree/nodes") => Node(body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/apps/", StringComparison.Ordinal) && p.EndsWith("/token", StringComparison.Ordinal) => Json(new JsonObject { ["token"] = "app-token-for-test" }),
                ("GET", "/internal/credits/headroom") => Headroom is { } h ? Json(new JsonObject { ["headroomCredits"] = h }) : Problem(HttpStatusCode.NotFound, "not_found", "No such endpoint."),
                ("GET", "/internal/estimates/history") => Json(new JsonArray(History.Select(c => (JsonNode)new JsonObject { ["credits"] = c }).ToArray())),
                ("GET", "/internal/employees") => Json(Staff()),
                ("POST", "/internal/hires") => Hire(body!.AsObject()),
                ("GET", var p) when p.StartsWith("/internal/employees/", StringComparison.Ordinal) && p.EndsWith("/memory", StringComparison.Ordinal) => Json(new JsonArray(MemoryOf(p).Select(m => (JsonNode)m.DeepClone()).ToArray())),
                ("POST", var p) when p.StartsWith("/internal/employees/", StringComparison.Ordinal) && p.EndsWith("/memory", StringComparison.Ordinal) => Remember(p, body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/employees/", StringComparison.Ordinal) && p.EndsWith("/memory/review", StringComparison.Ordinal) => Reviewed(body!.AsObject()),
                ("POST", "/internal/contractors") => Contractor(body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/contractors/", StringComparison.Ordinal) && p.EndsWith("/finish", StringComparison.Ordinal) => Finished(p, body!.AsObject()),
                ("POST", var p) when p.StartsWith("/internal/ideas/", StringComparison.Ordinal) && p.EndsWith("/decision", StringComparison.Ordinal) => Decide(body!.AsObject()),
                ("GET", var p) when p == run + "/suggestion-context" => SuggestionContext is { } sc ? Json(sc) : Problem(HttpStatusCode.Conflict, "conflict", "That run does not suggest ideas."),
                ("POST", var p) when p == run + "/suggestions" => RecordSuggestions(body!.AsObject()),
                ("GET", "/internal/ontology") => Json(new JsonObject { ["nodes"] = new JsonArray(Schedules.Select(n => (JsonNode)new JsonObject { ["id"] = $"schedule:{n}", ["type"] = "schedule", ["name"] = n }).ToArray()), ["edges"] = new JsonArray() }),
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
        // The control plane's own limit (RunService.MaxPayloadBytes): a fake that accepted anything hid the defect a live build found.
        if (body["events"]!.AsArray().OfType<JsonObject>().Any(e => System.Text.Encoding.UTF8.GetByteCount((e["payload"] ?? new JsonObject()).ToJsonString()) > 64 * 1024))
        {
            return Problem(HttpStatusCode.BadRequest, "invalid_request", "An event's payload is at most 65536 bytes; truncate tool results before logging them.");
        }

        foreach (var e in body["events"]!.AsArray().OfType<JsonObject>())
        {
            Append(e["type"]!.GetValue<string>(), e["payload"]?.DeepClone().AsObject() ?? []);
            appended.Add(new JsonObject { ["seq"] = Events.Count, ["type"] = e["type"]!.GetValue<string>(), ["payload"] = Events[^1].Payload.DeepClone() });
        }

        return Json(appended);
    }

    // The task graph, with the control plane's rules that matter here: checkout is conditional on the expected status and
    // holder, who claimed a task is kept when it finishes, and each change is logged on the run as TaskService logs it.
    private HttpResponseMessage CreateTask(JsonObject body)
    {
        var id = Guid.NewGuid();
        var task = new JsonObject
        {
            ["id"] = id.ToString(),
            ["scope"] = body["scope"]?.ToString(),
            ["runId"] = body["runId"]?.ToString(),
            ["title"] = body["title"]?.ToString(),
            ["description"] = body["description"]?.ToString() ?? "",
            ["status"] = "todo",
            ["holderRunId"] = null,
            ["holderEmployeeId"] = null,
            ["employeeId"] = null,
        };
        Tasks.Add(task);
        Append("task.created", new JsonObject { ["taskId"] = id.ToString(), ["summary"] = task["title"]?.ToString() });
        return Json(task.DeepClone(), HttpStatusCode.Created);
    }

    private HttpResponseMessage Checkout(JsonObject body)
    {
        var task = Tasks.Single(t => t["id"]!.GetValue<string>() == body["taskId"]!.GetValue<string>());
        var expected = body["expectedStatus"]?.ToString();
        var holder = body["expectedHolderRunId"]?.ToString();
        if (task["status"]!.GetValue<string>() != expected || task["holderRunId"]?.ToString() != holder)
        {
            return Json(new JsonObject { ["status"] = 409, ["code"] = "conflict", ["detail"] = "conflict: the task's status or holder was not what you expected.", ["task"] = task.DeepClone() }, HttpStatusCode.Conflict);
        }

        task["status"] = "in_progress";
        task["holderRunId"] = body["runId"]?.ToString();
        task["holderEmployeeId"] = body["employeeId"]?.ToString();
        task["employeeId"] = body["employeeId"]?.ToString();
        Append("task.claimed", new JsonObject { ["taskId"] = task["id"]!.ToString(), ["employeeId"] = task["employeeId"]?.ToString(), ["previousHolder"] = holder });
        return Json(task.DeepClone());
    }

    private HttpResponseMessage FinishTask(Guid id, JsonObject body)
    {
        var task = Tasks.Single(t => t["id"]!.GetValue<string>() == id.ToString());
        var status = body["status"]!.GetValue<string>();
        task["status"] = status;
        task["holderRunId"] = null;
        task["holderEmployeeId"] = null;
        if (status is "done" or "failed")
        {
            Append($"task.{status}", new JsonObject { ["taskId"] = id.ToString(), ["summary"] = body["summary"]?.ToString() ?? task["title"]?.ToString(), ["employeeId"] = task["employeeId"]?.ToString() });
        }

        return Json(task.DeepClone());
    }

    private HttpResponseMessage Approve(JsonObject body)
    {
        var id = Guid.NewGuid().ToString();
        var title = body["title"]!.GetValue<string>();
        Approvals.Add(title);
        ApprovalsAsked.Add(body.DeepClone().AsObject());
        Append("approval.requested", new JsonObject { ["approvalId"] = id, ["title"] = title, ["detail"] = body["detail"]?.DeepClone(), ["onDecline"] = body["onDecline"]?.DeepClone() });
        if (AnswerApproval(title) is { } answer)
        {
            Append("approval.answered", new JsonObject { ["approvalId"] = id, ["answer"] = answer ? "approved" : "rejected", ["comment"] = ApprovalNote });
        }

        return Json(new JsonObject { ["id"] = id, ["title"] = title, ["status"] = "pending" }, HttpStatusCode.Created);
    }

    private JsonArray Staff()
    {
        var staff = new JsonArray(
            new JsonObject { ["id"] = Reviewer.ToString(), ["kind"] = "employee", ["name"] = "Vigil", ["role"] = "Security reviewer", ["status"] = "idle", ["standing"] = "security-reviewer", ["scope"] = "frostaura" },
            new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["kind"] = "employee", ["name"] = "Ada", ["role"] = "Builder", ["status"] = "idle", ["scope"] = "frostaura" });
        foreach (var hire in Hires.Values.Where(h => h["employeeId"] is not null))
        {
            staff.Add(new JsonObject { ["id"] = hire["employeeId"]!.ToString(), ["kind"] = "employee", ["name"] = hire["name"]?.ToString(), ["role"] = hire["role"]?.ToString(), ["status"] = "idle", ["scope"] = hire["scope"]?.ToString() });
        }

        return staff;
    }

    private HttpResponseMessage Hire(JsonObject body)
    {
        var key = body["needKey"]!.GetValue<string>();
        var created = !Hires.ContainsKey(key);
        if (created)
        {
            Hires[key] = new JsonObject
            {
                ["id"] = Guid.NewGuid().ToString(),
                ["status"] = HiresWait ? "proposed" : "accepted",
                ["trigger"] = body["trigger"]?.ToString(),
                ["needKey"] = key,
                ["scope"] = body["scope"]?.ToString(),
                ["name"] = body["name"]?.ToString(),
                ["role"] = body["role"]?.ToString(),
                ["reportsTo"] = body["reportsTo"]?.ToString(),
                ["modelTier"] = body["jobDescription"]?["modelTier"]?.ToString(),
                ["expectedMonthlyCredits"] = body["expectedMonthlyCredits"]?.DeepClone(),
                ["withinBudget"] = !HiresWait,
                ["employeeId"] = HiresWait ? null : Guid.NewGuid().ToString(),
            };
        }

        return Json(new JsonObject { ["hire"] = Hires[key].DeepClone(), ["created"] = created }, created ? HttpStatusCode.Created : HttpStatusCode.OK);
    }

    private List<JsonObject> MemoryOf(string path)
    {
        var id = Guid.Parse(path.Split('/')[3]);
        if (!Memory.TryGetValue(id, out var entries))
        {
            Memory[id] = entries = [];
        }

        return entries;
    }

    private HttpResponseMessage Remember(string path, JsonObject body)
    {
        var entries = MemoryOf(path);
        var added = new JsonArray();
        foreach (var e in (body["entries"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var entry = new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["title"] = e["title"]?.ToString(), ["body"] = e["body"]?.ToString(), ["kind"] = e["kind"]?.ToString(), ["scope"] = e["scope"]?.ToString() ?? "frostaura", ["sourceRunId"] = body["runId"]?.ToString() };
            entries.Add(entry);
            added.Add(entry.DeepClone());
        }

        return Json(added, HttpStatusCode.Created);
    }

    private HttpResponseMessage Reviewed(JsonObject body)
    {
        MemoryReviews.Add(body.DeepClone().AsObject());
        return Json(new JsonObject { ["merged"] = 0 });
    }

    private HttpResponseMessage Contractor(JsonObject body)
    {
        var contractor = new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["kind"] = "contractor", ["name"] = body["name"]?.ToString(), ["role"] = body["role"]?.ToString(), ["briefedBy"] = body["briefedBy"]?.ToString() };
        Contractors.Add(contractor);
        return Json(contractor.DeepClone(), HttpStatusCode.Created);
    }

    private HttpResponseMessage Finished(string path, JsonObject body)
    {
        body["contractorId"] = path.Split('/')[3];
        ContractorsFinished.Add(body.DeepClone().AsObject());
        return Json(new JsonObject { ["contractor"] = new JsonObject(), ["learned"] = new JsonArray(), ["promotion"] = null });
    }

    private HttpResponseMessage Decide(JsonObject body)
    {
        Decisions.Add($"{body["decision"]}:{body["by"]}");
        return DecisionRefusal switch
        {
            null => Json(new JsonObject { ["idea"] = new JsonObject(), ["run"] = new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["kind"] = "build" } }),
            "red_line" => Problem(HttpStatusCode.Forbidden, "red_line", "It crosses a red line."),
            var code => Problem(HttpStatusCode.Conflict, code, "Checkpoints are on here, so the owner decides."),
        };
    }

    private HttpResponseMessage RecordSuggestions(JsonObject body)
    {
        var list = body["suggestions"] as JsonArray ?? [];
        if (list.Count is 0 or > 5)
        {
            return Problem(HttpStatusCode.BadRequest, "invalid_request", "Send 1 to 5 suggestions.");
        }

        if (Suggestions is not null)
        {
            return Problem(HttpStatusCode.Conflict, "conflict", "This run's suggestions are already recorded.");
        }

        Suggestions = list.DeepClone().AsArray();
        return Json(new JsonArray(list.Select(s => (JsonNode)new JsonObject { ["id"] = Guid.NewGuid().ToString(), ["title"] = s!["title"]?.ToString(), ["status"] = "open" }).ToArray()), HttpStatusCode.Created);
    }

    private HttpResponseMessage RecordVerdict(JsonObject verdict)
    {
        if (VerdictRefusals.TryDequeue(out var faults))
        {
            return Json(new JsonObject { ["status"] = 400, ["code"] = "verdict_invalid", ["detail"] = "Not in the agreed shape.", ["errors"] = new JsonArray(faults.Select(f => (JsonNode)f).ToArray()) }, HttpStatusCode.BadRequest);
        }

        // The control plane's own check, exactly (ARCH-004): a fake that accepted anything would hide the defect the first real run found.
        var faultsFound = Endgame.Domain.Runs.VerdictDocument.Validate(verdict);
        if (faultsFound.Count > 0)
        {
            return Json(new JsonObject { ["status"] = 400, ["code"] = "verdict_invalid", ["detail"] = "Not in the agreed shape.", ["errors"] = new JsonArray(faultsFound.Select(f => (JsonNode)f).ToArray()) }, HttpStatusCode.BadRequest);
        }

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

    /// <summary>The evaluator's previews started (<c>POST /internal/apps/{id}/preview</c>).</summary>
    public List<JsonObject> Previews { get; } = [];

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

        if (path.EndsWith("/preview", StringComparison.Ordinal) && request.Method == HttpMethod.Post)
        {
            Previews.Add(body!.AsObject());
            return Json(Status(appId));
        }

        if (path.EndsWith("/preview", StringComparison.Ordinal) && request.Method == HttpMethod.Delete)
        {
            return new HttpResponseMessage(HttpStatusCode.NoContent);
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
