using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;

namespace Endgame.ControlPlane.Endpoints;

/// <summary><c>POST /internal/runs/{id}/suggestions</c>.</summary>
public sealed record RecordSuggestionsRequest(IReadOnlyList<SuggestionInput>? Suggestions);

public sealed record CreateRunRequest(string? Scope, string? Kind, string? Title, Guid? EmployeeId, Guid? IdeaId, Guid? ConversationId, Guid? ParentRunId);

public sealed record ClaimRunRequest(string? Holder, int LeaseSeconds, IReadOnlyList<string>? Kinds);

public sealed record LeaseRequest(string? Holder, int Seconds);

public sealed record EventInput(string? Type, JsonObject? Payload);

public sealed record AppendEventsRequest(string? LeaseHolder, IReadOnlyList<EventInput>? Events);

public sealed record CheckoutRequest(Guid TaskId, Guid RunId, Guid? EmployeeId, string? ExpectedStatus, Guid? ExpectedHolderRunId);

public sealed record CreateTaskRequest(string? Scope, Guid? RunId, Guid? ParentTaskId, string? Title, string? Description, decimal? EstimateCredits, IReadOnlyList<Guid>? DependsOn);

public sealed record RaiseApprovalRequest(Guid RunId, string? Title, string? Detail);

public sealed record PublishedRequest(string? Version);

public sealed record AppStateRequest(string? Status);

public sealed record AppTokenResult(string Token);

public sealed record HandoffRedeemRequest(Guid AppId, string? Code);

public sealed record ScopeLevelView(string Level, Guid Id, string Slug, string Name, string Status, string Path);

/// <summary><c>GET /internal/context</c>: the resolved cascade for a scope. Secrets are named, never valued.</summary>
public sealed record ContextView(
    string Scope,
    IReadOnlyList<ScopeLevelView> Levels,
    IReadOnlyList<EffectiveValue> Context,
    IReadOnlyList<EffectiveValue> RuleSets,
    IReadOnlyList<EffectiveValue> Budgets,
    IReadOnlyList<EffectiveValue> Settings,
    IReadOnlyList<EffectiveValue> Secrets,
    IReadOnlyList<EffectiveValue> Permissions);

/// <summary>The internal API (ARCH-004): for the Runner, Dock and the edge, behind the service token. Never routed by the edge.</summary>
internal static class InternalEndpoints
{
    public static void MapInternal(this RouteGroupBuilder group)
    {
        group.MapPost("/model/chat", async (ChatRequest request, HttpContext http, ModelGateway gateway, CancellationToken ct) =>
        {
            if (!request.Stream)
            {
                var result = await gateway.CompleteAsync(request, ct);
                http.Response.Headers["Endgame-Reservation-Id"] = result.Settlement.ReservationId.ToString();
                http.Response.Headers["Endgame-Reserved-Credits"] = result.Settlement.ReservedCredits.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);
                http.Response.Headers["Endgame-Settled-Credits"] = result.Settlement.SettledCredits.ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);
                return Results.Content(result.Body, "application/json");
            }

            await gateway.StreamAsync(request,
                async () =>
                {
                    http.Response.StatusCode = 200;
                    http.Response.ContentType = "text/event-stream";
                    http.Response.Headers.CacheControl = "no-cache";
                    await http.Response.Body.FlushAsync(ct);
                },
                async line =>
                {
                    await http.Response.WriteAsync(line + "\n", ct);
                    if (line.Length == 0)
                    {
                        await http.Response.Body.FlushAsync(ct);
                    }
                },
                ct);
            return Results.Empty;
        })
        .WithName("ModelChat")
        .WithSummary("A model call through the gateway: routed by task type, reserved before sending, settled from the reply's own cost. 402 budget_exhausted is terminal; 422 ceiling_unreachable is not.");

        group.MapPost("/runs", async (CreateRunRequest request, ScopeResolver scopes, RunService runs, CancellationToken ct) =>
        {
            var scope = await scopes.RequireAsync(request.Scope, ct);
            var run = await runs.CreateAsync(scope, request.Kind ?? "", request.Title ?? "", request.EmployeeId, request.IdeaId, request.ConversationId, request.ParentRunId, null, ct);
            return Results.Created($"/internal/runs/{run.Id}", run);
        })
        .WithName("CreateRun").WithSummary("Creates a queued run at a scope.").Produces<RunView>(201);

        group.MapPost("/runs/claim", async (ClaimRunRequest request, RunService runs, CancellationToken ct) =>
            await runs.ClaimNextAsync(request.Holder ?? "", TimeSpan.FromSeconds(request.LeaseSeconds), request.Kinds ?? [], ct) is { } run
                ? Results.Ok(run)
                : Results.NoContent())
        .WithName("ClaimRun").WithSummary("Claims the oldest queued run (or one whose lease lapsed), across organisations, with one conditional update. 204 when there is none.").Produces<RunView>();

        group.MapGet("/runs/{id:guid}", async (Guid id, RunService runs, CancellationToken ct) =>
        {
            var (run, scope) = await runs.RequireAsync(id, ct);
            return Results.Ok(RunService.View(run, scope.Path.ToString()));
        })
        .WithName("GetRunInternal").WithSummary("A run, with its lease.").Produces<RunView>();

        group.MapGet("/runs/{id:guid}/events", async (Guid id, long? after, int? limit, RunService runs, CancellationToken ct) =>
        {
            var (run, _) = await runs.RequireAsync(id, ct);
            return Results.Ok(await runs.ReadEventsAsync(run.OrganisationId, id, after ?? 0, limit ?? RunService.MaxEventsPerRead, ct));
        })
        .WithName("ReadRunEvents").WithSummary("A page of a run's log after a sequence number (at most 500), for replay.").Produces<IReadOnlyList<RunEventView>>();

        group.MapPost("/runs/{id:guid}/events", async (Guid id, AppendEventsRequest request, RunService runs, CancellationToken ct) =>
        {
            var (run, _) = await runs.RequireAsync(id, ct);
            var events = (request.Events ?? []).Select(e => new NewEvent(e.Type ?? "", e.Payload)).ToList();
            return Results.Ok(await runs.AppendAsync(run.OrganisationId, id, events, request.LeaseHolder, null, ct));
        })
        .WithName("AppendRunEvents").WithSummary("Appends events; the control plane assigns gapless sequence numbers. Lifecycle events move the run's status in the same transaction.").Produces<IReadOnlyList<RunEventView>>();

        group.MapPost("/runs/{id:guid}/lease", async (Guid id, LeaseRequest request, RunService runs, CancellationToken ct) =>
        {
            var (run, _) = await runs.RequireAsync(id, ct);
            return Results.Ok(await runs.LeaseAsync(run.OrganisationId, id, request.Holder ?? "", TimeSpan.FromSeconds(request.Seconds), ct));
        })
        .WithName("LeaseRun").WithSummary("Takes or renews a run's lease. The answer carries the run's status, so a holder learns it was paused or cancelled.").Produces<RunView>();

        group.MapPost("/tasks/checkout", async (CheckoutRequest request, TaskService tasks, CancellationToken ct) =>
        {
            var claimed = await tasks.CheckoutAsync(request.TaskId, request.RunId, request.EmployeeId, request.ExpectedStatus ?? "", request.ExpectedHolderRunId, ct);
            if (claimed is not null)
            {
                return Results.Ok(claimed);
            }

            var org = await tasks.OrganisationOfAsync(request.TaskId, ct);
            throw TaskService.Conflict(await tasks.GetAsync(org, request.TaskId, ct), "conflict: the task's status or holder was not what you expected, or its dependencies are not done.");
        })
        .WithName("CheckoutTask").WithSummary("Claims a task with one conditional update on its expected status and holder. 409 conflict carries the task as it is.").Produces<TaskView>();

        group.MapPost("/tasks", async (CreateTaskRequest request, ScopeResolver scopes, TaskService tasks, CancellationToken ct) =>
        {
            var scope = await scopes.RequireAsync(request.Scope, ct);
            var task = await tasks.CreateAsync(scope, request.RunId, request.ParentTaskId, request.Title ?? "", request.Description, request.EstimateCredits, request.DependsOn, ct);
            return Results.Created($"/internal/tasks/{task.Id}", task);
        })
        .WithName("CreateTask").WithSummary("Adds a task to the graph.").Produces<TaskView>(201);

        group.MapPatch("/tasks/{id:guid}", async (Guid id, TaskPatch patch, TaskService tasks, CancellationToken ct) =>
            Results.Ok(await tasks.UpdateAsync(id, patch, ct)))
        .WithName("UpdateTask").WithSummary("Changes a task; finishing one clears its holder and is logged on the holder's run. expectedStatus makes it conditional.").Produces<TaskView>();

        group.MapGet("/context", async (string? scope, ScopeResolver scopes, CascadeService cascade, CancellationToken ct) =>
        {
            var resolved = await scopes.RequireAsync(scope, ct);
            return Results.Ok(new ContextView(
                resolved.Path.ToString(),
                resolved.Nodes.Select(n => new ScopeLevelView(n.Level.ToWire(), n.Id, n.Slug, n.Name, n.Status, n.Path)).ToList(),
                await cascade.ResolveAsync(resolved, CascadeKind.Context, ct),
                await cascade.ResolveAsync(resolved, CascadeKind.RuleSet, ct),
                await cascade.ResolveAsync(resolved, CascadeKind.Budget, ct),
                await cascade.ResolveAsync(resolved, CascadeKind.Setting, ct),
                await cascade.ResolveAsync(resolved, CascadeKind.Secret, ct),
                await cascade.ResolveAsync(resolved, CascadeKind.Permission, ct)));
        })
        .WithName("GetContext").WithSummary("The resolved cascade for a scope: context, rule sets, budgets, settings, secret names and roles, each with the level that set it.").Produces<ContextView>();

        group.MapPost("/approvals", async (RaiseApprovalRequest request, ApprovalService approvals, CancellationToken ct) =>
            Results.Created("/internal/approvals", await approvals.RaiseAsync(request.RunId, request.Title ?? "", request.Detail, ct)))
        .WithName("RaiseApproval").WithSummary("Raises a checkpoint; the run waits until someone with rights answers it.").Produces<ApprovalView>(201);

        group.MapGet("/routes", async (TreeService tree, CancellationToken ct) => Results.Ok(await tree.RoutesAsync(ct)))
            .WithName("GetRoutes").WithSummary("The edge's routing table: every app's addresses, container target and sleep state.").Produces<RoutingTable>();

        group.MapPost("/apps/{id:guid}/published", async (Guid id, PublishedRequest request, ScopeResolver scopes, TreeService tree, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            return Results.Ok(await tree.PublishedAsync(scope, request.Version ?? "", ct));
        })
        .WithName("AppPublished").WithSummary("Dock reports a new running version of an app.").Produces<NodeView>();

        group.MapPost("/apps/{id:guid}/state", async (Guid id, AppStateRequest request, ScopeResolver scopes, TreeService tree, NotificationService notifications, TimeProvider clock, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            var node = await tree.AppStateAsync(scope, request.Status ?? "", ct);
            if (request.Status == NodeStatuses.Failed)
            {
                // A crash needs a person: once per app per minute of reports.
                await notifications.RaiseAsync(scope, NotificationKinds.AppCrashed, $"{scope.Node.Name} stopped working",
                    "It crashed and visitors see an unavailable page. Its last good version can be restored from its history.",
                    new NotificationSubject("app", id), $"crash:{id:N}:{clock.GetUtcNow():yyyyMMddHHmm}", ct);
            }

            return Results.Ok(node);
        })
        .WithName("AppState").WithSummary("Dock or the edge report that an app is building, running, sleeping, stopped or failed.").Produces<NodeView>();

        group.MapPost("/apps/{id:guid}/token", async (Guid id, ScopeResolver scopes, AppTokenService tokens, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            return Results.Ok(new AppTokenResult(await tokens.IssueAsync(scope, ct)));
        })
        .WithName("IssueAppToken").WithSummary("Dock, before it starts an app: a fresh platform token for it (stored only as a hash). The previous one keeps working for a short grace period.").Produces<AppTokenResult>();

        group.MapPost("/access/check", async (AccessCheckRequest request, AppIdentityService identity, CancellationToken ct) =>
            Results.Ok(await identity.CheckAsync(request, ct)))
        .WithName("CheckAppAccess").WithSummary("Edge, for a request into an app: allow (with an app-scoped session token), sign-in or deny, from the app's access setting, the visitor's role, its shares and its end users.").Produces<AccessCheckResult>();

        group.MapPost("/access/handoff", async (HandoffRedeemRequest request, AppIdentityService identity, CancellationToken ct) =>
            await identity.RedeemHandoffAsync(request.AppId, request.Code, ct) is { } redeemed
                ? Results.Ok(redeemed)
                : Problems.From(new EndgameProblem(410, "handoff_invalid", "The sign-in link has expired",
                    "That hand-off code is unknown, already used, or older than a minute. Sign in again.")))
        .WithName("RedeemHandoff").WithSummary("Edge, on the organisation subdomain: redeems a one-time hand-off code into that host's own app-session cookie (name, value, expiry) and where to send the visitor.").Produces<AppIdentityService.HandoffRedeemed>();

        group.MapPost("/usage/hosting", async (HostingUsageRequest request, HostingMeter meter, CancellationToken ct) =>
            Results.Ok(await meter.RecordAsync(request, ct)))
        .WithName("RecordHostingUsage").WithSummary("Dock reports per-app usage samples (awake seconds, memory, storage, requests); each becomes one hosting credit entry. A sampleId is charged once.").Produces<HostingUsageResult>();

        group.MapGet("/runs/{id:guid}/suggestion-context", async (Guid id, SuggestionService suggestions, CancellationToken ct) =>
            Results.Ok(await suggestions.ContextForRunAsync(id, ct)))
        .WithName("SuggestionContext")
        .WithSummary("A suggest run reads what the organisation holds at its scope: divisions, projects and apps, ideas and their verdicts, the context set on the cascade, and what was suggested before.")
        .Produces<SuggestionContext>();

        group.MapPost("/runs/{id:guid}/suggestions", async (Guid id, RecordSuggestionsRequest request, SuggestionService suggestions, CancellationToken ct) =>
            Results.Created($"/api/ideas/suggestions", await suggestions.RecordAsync(id, request.Suggestions, ct)))
        .WithName("RecordSuggestions")
        .WithSummary("The suggest run's result: one to five ideas, each { title, idea, gap, whyUs, reuses[] }. Recorded once per run.")
        .Produces<IReadOnlyList<SuggestionView>>(201);

        group.MapPost("/ideas/{id:guid}/verdict", async (Guid id, JsonObject verdict, IdeaService ideas, CancellationToken ct) =>
            Results.Ok(await ideas.RecordVerdictAsync(id, verdict, ct)))
        .WithName("RecordVerdict").WithSummary("The Runner reports research's verdict document (outcome build | change | do-not-build, headline, summary, existing, gap, demand, wouldChange, method).").Produces<IdeaView>();
    }
}
