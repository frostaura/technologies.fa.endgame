using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Endgame.ControlPlane.Endpoints;

/// <param name="Scope">Optional: the organisation or division to propose to. Defaults to the caller's organisation.</param>
public sealed record IdeaRequest(string? Text, IReadOnlyList<string>? Constraints, string? Scope);

/// <param name="Scope">Optional: the organisation (or a scope in it) the idea is for, so the estimate uses its own history.</param>
public sealed record EstimateRequest(string? Text, IReadOnlyList<string>? Constraints, string? Scope = null);

/// <param name="ApplyChange">On a "change" verdict with choice <c>build</c>: build with research's suggested change as part of what is built.</param>
public sealed record DecisionRequest(string? Choice, string? Note, bool? ApplyChange = null);

/// <param name="Request">The change, in the person's own words.</param>
public sealed record ChangeRequest(string? Request);

public sealed record ConversationEstimateRequest(string? Scope, Guid? EmployeeId);

/// <summary>What one conversation turn is expected to cost, and the most it can (every call reserved at its worst case).</summary>
public sealed record ConversationEstimateView(decimal Credits, decimal? Ceiling, string Basis);

public sealed record ControlRequest(string? Reason);

public sealed record AnswerRequest(string? Decision, string? Note);

/// <param name="Running">'sleep' or 'always-on'.</param>
/// <param name="Access">'private', 'shared' or 'public'. Setting it needs the Admin role; 'public' only ever from a person.</param>
/// <param name="IdleMinutes">Optional: minutes idle before the app sleeps (1-1440).</param>
public sealed record AppSettingsRequest(string? Running, string? Access, int? IdleMinutes);

public sealed record ConversationRequest(string? Scope, string? Message, Guid? EmployeeId, Guid? ConversationId);

public sealed class RunStreamOptions
{
    public const string SectionName = "Runs";

    /// <summary>How often a live event stream looks for new events.</summary>
    public int EventPollMilliseconds { get; set; } = 500;

    /// <summary>How often a quiet stream sends a comment so proxies keep it open.</summary>
    public int HeartbeatSeconds { get; set; } = 15;
}

/// <summary>Ideas, runs and their live log, tasks, approvals, apps and the docked conversation (ARCH-004).</summary>
internal static class WorkEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static void MapWork(this RouteGroupBuilder api)
    {
        var ideas = api.MapGroup("/ideas").WithTags("Ideas");
        ideas.MapPost("/estimate", async (EstimateRequest request, ClaimsPrincipal principal, AccessService access, ResearchEstimator estimator, CancellationToken ct) =>
        {
            // History is read only for an organisation the caller belongs to; otherwise the measured starting figure.
            Guid? organisation = null;
            if (request.Scope is { Length: > 0 } named && principal.Identity?.IsAuthenticated == true)
            {
                organisation = (await access.RequireAsync(principal.Id(), named, MemberRole.Viewer, ct)).Scope.OrganisationId;
            }

            var estimate = await estimator.ResearchAsync(organisation, request.Text, request.Constraints, ct);
            return Results.Ok(new IdeaEstimateView(estimate.Credits, estimate.Basis));
        })
        .WithName("EstimateIdea").WithSummary("What researching an idea will cost at most, before anything is charged. Free; works before an organisation exists.").Produces<IdeaEstimateView>();
        ideas.MapPost("", async (IdeaRequest request, ClaimsPrincipal principal, AccessService access, IdeaService service, ResearchEstimator estimator, ReadModels reads, CancellationToken ct) =>
        {
            var scopeText = request.Scope ?? (await access.MembershipsOfAsync(principal.Id(), ct)).FirstOrDefault()?.OrganisationSlug
                ?? throw new EndgameProblem(409, "no_organisation", "Name your organisation first", "An idea belongs to an organisation; create it, then describe the idea.");
            var (scope, _) = await access.RequireAsync(principal.Id(), scopeText, MemberRole.Builder, ct);
            var estimate = await estimator.ResearchAsync(scope.OrganisationId, request.Text, request.Constraints, ct);
            var started = await service.CreateAsync(scope, request.Text ?? "", request.Constraints, estimate.Credits, principal.Id(), ct, estimateReason: estimate.Basis, estimateCeiling: estimate.Ceiling);
            return Results.Created($"/api/ideas/{started.Idea.Id}", await reads.IdeaAsync(scope.OrganisationId, started.Idea.Id, ct));
        })
        .WithName("CreateIdea").WithSummary("Records an idea and its constraints, shows its estimate in the research run's log, and queues the research. Returns the idea with its runId.").Produces<PublicIdeaView>(201);
        ideas.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, IdeaService service, ReadModels reads, CancellationToken ct) =>
        {
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Viewer, ct);
            return Results.Ok(await reads.IdeaAsync(org, id, ct));
        })
        .WithName("GetIdea").WithSummary("An idea, its research, its verdict, the decision taken and the organisation's verdict record.").Produces<PublicIdeaView>();
        ideas.MapPost("/{id:guid}/decision", async (Guid id, DecisionRequest request, ClaimsPrincipal principal, AccessService access, IdeaService service, ReadModels reads, CancellationToken ct) =>
        {
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Builder, ct);
            await service.DecideAsync(org, id, request.Choice ?? "", request.Note, principal.Id(), ct, applyChange: request.ApplyChange == true);
            return Results.Ok(await reads.IdeaAsync(org, id, ct));
        })
        .WithName("DecideIdea").WithSummary("build, change, overrule or drop, after the verdict; returns the idea, whose decision.runId is the run that follows. Building over 'do-not-build' needs an overrule. On a 'change' verdict, build with applyChange: true builds research's change in.").Produces<PublicIdeaView>();

        var runs = api.MapGroup("/runs").WithTags("Runs");
        runs.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, RunService service, ReadModels reads, CancellationToken ct) =>
        {
            var (run, scope) = await service.RequireAsync(id, ct);
            await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await reads.RunAsync(run.OrganisationId, id, ct));
        })
        .WithName("GetRun").WithSummary("A run's status, estimate and spend; lastSeq is where its event stream resumes.").Produces<PublicRunView>();

        runs.MapGet("/{id:guid}/events", async (Guid id, long? after, HttpContext http, ClaimsPrincipal principal, AccessService access, RunService service,
            IOptions<RunStreamOptions> options, CancellationToken ct) =>
        {
            var (run, scope) = await service.RequireAsync(id, ct);
            await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            var last = after ?? (long.TryParse(http.Request.Headers["Last-Event-ID"], out var resumed) ? resumed : 0);
            await StreamEventsAsync(http, service, run.OrganisationId, id, last, options.Value, ct);
        })
        .WithName("StreamRunEvents")
        .WithSummary("The run's log as server-sent events (id: seq, event: type, data: {seq,type,at,payload}), from after ?after= or Last-Event-ID; ends with an 'end' event once the run has finished.")
        .Produces(200, contentType: "text/event-stream");

        foreach (var (action, summary) in new[] { ("pause", "Pauses a run."), ("resume", "Resumes a paused run."), ("cancel", "Cancels a run and releases what it had reserved.") })
        {
            runs.MapPost($"/{{id:guid}}/{action}", async (Guid id, HttpRequest http, ClaimsPrincipal principal, AccessService access, RunService service, ReadModels reads, CancellationToken ct) =>
            {
                // The body is optional ({ reason }); the console sends none.
                var reason = http.ContentLength is > 0 ? (await http.ReadFromJsonAsync<ControlRequest>(ct))?.Reason : null;
                var (run, scope) = await service.RequireAsync(id, ct);
                await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
                var me = principal.Id();
                _ = action switch
                {
                    "pause" => await service.PauseAsync(run.OrganisationId, id, me, reason, ct),
                    "resume" => await service.ResumeAsync(run.OrganisationId, id, me, ct),
                    _ => await service.CancelAsync(run.OrganisationId, id, me, reason, ct),
                };
                return Results.Ok(await reads.RunAsync(run.OrganisationId, id, ct));
            })
            .WithName($"{char.ToUpperInvariant(action[0])}{action[1..]}Run").WithSummary(summary).Accepts<ControlRequest>("application/json").Produces<PublicRunView>();
        }

        runs.MapPost("/{id:guid}/retry/estimate", async (Guid id, ClaimsPrincipal principal, AccessService access, RunService service, RetryService retries, CancellationToken ct) =>
        {
            var (_, scope) = await service.RequireAsync(id, ct);
            await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
            return Results.Ok(await retries.EstimateAsync(id, ct));
        })
        .WithName("EstimateRetry").WithSummary("What trying a stopped research, build or change again would cost, and how many of its parts are already built and kept. Free.").Produces<RetryEstimateView>();
        runs.MapPost("/{id:guid}/retry", async (Guid id, ClaimsPrincipal principal, AccessService access, RunService service, RetryService retries, ReadModels reads, CancellationToken ct) =>
        {
            var (run, scope) = await service.RequireAsync(id, ct);
            await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
            var again = await retries.RetryAsync(id, principal.Id(), ct);
            return Results.Created($"/api/runs/{again.Id}", await reads.RunAsync(run.OrganisationId, again.Id, ct));
        })
        .WithName("RetryRun")
        .WithSummary("Tries a failed, cancelled or budget-stopped research, build or change again as a new run, keeping what was placed, agreed and finished. 409 not_retryable for anything else, or for an attempt that is not the latest.")
        .Produces<PublicRunView>(201);

        runs.MapPost("/{id:guid}/approvals/{approvalId:guid}", async (Guid id, Guid approvalId, AnswerRequest request, ClaimsPrincipal principal, AccessService access,
            RunService service, ApprovalService approvals, CancellationToken ct) =>
        {
            var approve = request.Decision switch
            {
                "approve" => true,
                "reject" => false,
                _ => throw EndgameProblem.Invalid("decision is 'approve' or 'reject'."),
            };
            var (run, scope) = await service.RequireAsync(id, ct);
            await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
            await approvals.AnswerAsync(run.OrganisationId, id, approvalId, approve, request.Note, principal.Id(), ct);
            return Results.NoContent();
        })
        .WithName("AnswerApproval").WithSummary("Approves or rejects a checkpoint a run is waiting on.").Produces(204);

        api.MapGet("/tasks", async (string? scope, string? status, int? limit, Guid? employeeId, ClaimsPrincipal principal, AccessService access, TaskService tasks, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await tasks.ListAsync(resolved, status, limit ?? 100, ct, employeeId));
        })
        .WithTags("Tasks").WithName("ListTasks").WithSummary("Tasks at the scope and beneath it, most recently changed first (at most 500); with employeeId, only the ones that employee claimed.").Produces<IReadOnlyList<TaskView>>();

        var apps = api.MapGroup("/apps").WithTags("Apps");
        apps.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, ReadModels reads, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await reads.AppAsync(scope, ct));
        })
        .WithName("GetApp").WithSummary("An app's health, running state, both addresses, cost against its cap and settings.").Produces<PublicAppView>();
        apps.MapPost("/{id:guid}/changes/estimate", async (Guid id, ChangeRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, ChangeService changes, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
            var estimate = await changes.EstimateAsync(scope, request.Request, ct);
            return Results.Ok(new ChangeEstimateView(estimate.Credits, estimate.Basis));
        })
        .WithName("EstimateChange").WithSummary("What changing an app as described is expected to cost, before anything starts. Free.").Produces<ChangeEstimateView>();
        apps.MapPost("/{id:guid}/changes", async (Guid id, ChangeRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, ChangeService changes, ReadModels reads, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
            var run = await changes.CreateAsync(scope, request.Request, principal.Id(), "console", ct);
            return Results.Created($"/api/runs/{run.Id}", await reads.RunAsync(scope.OrganisationId, run.Id, ct));
        })
        .WithName("ChangeApp")
        .WithSummary("Asks the factory to change a built app: screened against the red lines, planned, built and checked part by part, what worked before checked again, reviewed, and the new version published. 409 app_not_built or app_busy.")
        .Produces<PublicRunView>(201);
        apps.MapPost("/{id:guid}/settings", async (Guid id, AppSettingsRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access,
            ScopeResolver scopes, CascadeService cascade, ReadModels reads, EdgeNotifier edge, CancellationToken ct) =>
        {
            if (request.Running is null && request.Access is null && request.IdleMinutes is null)
            {
                throw EndgameProblem.Invalid("Send running ('sleep' or 'always-on'), access, idleMinutes, or a combination.");
            }

            var mode = request.Running switch
            {
                null => null,
                "sleep" => "auto",
                "always-on" => "always_on",
                _ => throw EndgameProblem.Invalid("running is 'sleep' or 'always-on'."),
            };
            if (request.Access is not (null or AppAccess.Private or AppAccess.Shared or AppAccess.Public))
            {
                throw EndgameProblem.Invalid("access is 'private', 'shared' or 'public'.");
            }

            var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
            // Running is a Builder's call; who may open the app is an Admin's (spec, roles).
            await access.RequireAsync(principal.Id(), scope, request.Access is null ? MemberRole.Builder : MemberRole.Admin, ct);
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            // A person, signed in to the console: the only kind of actor that may make an app public.
            var actor = access.IsOperator(me) ? Actor.Operator : Actor.Member;
            if (mode is not null)
            {
                await cascade.SetAsync(scope, CascadeKind.Setting, CascadeKeys.SleepMode, JsonValue.Create(mode), me.Id, actor, ct);
            }

            if (request.IdleMinutes is { } minutes)
            {
                await cascade.SetAsync(scope, CascadeKind.Setting, CascadeKeys.SleepIdleMinutes, JsonValue.Create(minutes), me.Id, actor, ct);
            }

            if (request.Access is { } accessSetting)
            {
                await cascade.SetAsync(scope, CascadeKind.Setting, CascadeKeys.Access, JsonValue.Create(accessSetting), me.Id, actor, ct);
            }

            edge.RoutesChanged();
            return Results.Ok(await reads.AppAsync(scope, ct));
        })
        .WithName("UpdateAppSettings").WithSummary("Changes how the app runs (sleeps when idle, or always on) and who may open it (private, shared, public) on the app itself; both otherwise inherit down the cascade.").Produces<PublicAppView>();

        var conversations = api.MapGroup("/conversations").WithTags("Conversation");
        conversations.MapPost("/estimate", async (ConversationEstimateRequest request, ClaimsPrincipal principal, AccessService access, FactoryEstimates estimates, EmployeeService employees, CancellationToken ct) =>
        {
            var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Viewer, ct);
            var estimate = await estimates.ConversationAsync(scope.OrganisationId, await TierAsync(employees, scope.OrganisationId, request.EmployeeId, ct), ct);
            return Results.Ok(new ConversationEstimateView(estimate.Credits, estimate.Ceiling, estimate.Basis));
        })
        .WithName("EstimateMessage").WithSummary("What one message in the conversation at a scope (or with one employee) is expected to cost, and the most it can. Free.").Produces<ConversationEstimateView>();
        conversations.MapPost("", async (ConversationRequest request, ClaimsPrincipal principal, AccessService access, ConversationService service, FactoryEstimates estimates, EmployeeService employees, ReadModels reads, CancellationToken ct) =>
        {
            var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Builder, ct);
            var estimate = await estimates.ConversationAsync(scope.OrganisationId, await TierAsync(employees, scope.OrganisationId, request.EmployeeId, ct), ct);
            var turn = await service.PostAsync(scope, request.Message ?? "", request.ConversationId, request.EmployeeId, principal.Id(), ct, estimate);
            return Results.Created($"/api/runs/{turn.Run.Id}", await reads.RunAsync(scope.OrganisationId, turn.Run.Id, ct));
        })
        .WithName("PostMessage")
        .WithSummary("Sends a message in the conversation docked at a scope (or with one employee); returns the run whose events carry the reply.").Produces<PublicRunView>(201);
        conversations.MapGet("", async (string? scope, Guid? employeeId, ClaimsPrincipal principal, AccessService access, ReadModels reads, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await reads.ConversationAsync(resolved, employeeId, ct));
        })
        .WithName("GetConversation").WithSummary("The conversation docked at a scope (or with one employee): its messages, oldest first, at most the last 200.").Produces<ConversationHistoryView>();
    }

    /// <summary>The thinking power an employee answers with (its model tier), or null for Endgame's own assistant.</summary>
    internal static async Task<string?> TierAsync(EmployeeService employees, Guid organisationId, Guid? employeeId, CancellationToken ct) =>
        employeeId is { } id ? (await employees.DetailAsync(organisationId, id, ct)).Employee.JobDescription.ModelTier : null;

    /// <summary>Writes the log as server-sent events, each with its sequence number as the event id, until the run has finished and been drained.</summary>
    private static async Task StreamEventsAsync(HttpContext http, RunService service, Guid organisationId, Guid runId, long after, RunStreamOptions options, CancellationToken ct)
    {
        http.Response.StatusCode = 200;
        http.Response.ContentType = "text/event-stream";
        http.Response.Headers.CacheControl = "no-cache";
        http.Response.Headers["X-Accel-Buffering"] = "no";
        await http.Response.Body.FlushAsync(ct);
        var last = after;
        var quietSince = DateTimeOffset.UtcNow;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var events = await service.ReadEventsAsync(organisationId, runId, last, 200, ct);
                foreach (var e in events)
                {
                    var data = JsonSerializer.Serialize(e, Json);
                    await http.Response.WriteAsync($"id: {e.Seq}\nevent: {e.Type}\ndata: {data}\n\n", Encoding.UTF8, ct);
                    last = e.Seq;
                }

                if (events.Count > 0)
                {
                    await http.Response.Body.FlushAsync(ct);
                    quietSince = DateTimeOffset.UtcNow;
                    continue;
                }

                var run = await service.GetAsync(organisationId, runId, ct);
                if (RunStatuses.IsTerminal(run.Status) && run.LastSeq <= last)
                {
                    await http.Response.WriteAsync($"event: end\ndata: {JsonSerializer.Serialize(new { run.Status, run.LastSeq }, Json)}\n\n", Encoding.UTF8, ct);
                    await http.Response.Body.FlushAsync(ct);
                    return;
                }

                if (DateTimeOffset.UtcNow - quietSince > TimeSpan.FromSeconds(options.HeartbeatSeconds))
                {
                    await http.Response.WriteAsync(": keep-alive\n\n", Encoding.UTF8, ct);
                    await http.Response.Body.FlushAsync(ct);
                    quietSince = DateTimeOffset.UtcNow;
                }

                await Task.Delay(options.EventPollMilliseconds, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The reader went away; it resumes from its last event id.
        }
    }
}
