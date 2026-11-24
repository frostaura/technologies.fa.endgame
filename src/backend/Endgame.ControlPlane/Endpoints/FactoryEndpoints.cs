using System.Security.Claims;
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
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;
using Microsoft.AspNetCore.Identity;

namespace Endgame.ControlPlane.Endpoints;

/// <summary><c>POST /internal/tree/nodes</c>: the factory's placement.</summary>
public sealed record EnsureNodeRequest(string? Parent, string? Level, string? Name, string? Slug);

/// <summary>
/// <c>GET /internal/credits/headroom</c>: the most new work at a scope may still spend.
/// <paramref name="Binding"/> is <c>budget</c> (a monthly cap on the chain, or the employee's) or <c>overdraft</c>.
/// </summary>
public sealed record HeadroomView(string Scope, decimal HeadroomCredits, string BindingScope, string Binding, decimal Balance, decimal OverdraftLimit);

/// <summary><c>POST /internal/ideas</c>: the conversation starts research on the owner's confirmed word.</summary>
public sealed record InternalIdeaRequest(string? Scope, string? Text, IReadOnlyList<string>? Constraints);

/// <summary><c>PUT /internal/cascade</c>: an agent changes one setting from the allow-list.</summary>
public sealed record InternalCascadeRequest(string? Scope, string? Kind, string? Key, JsonNode? Value);

/// <summary><c>POST /internal/ideas/{id}/decision</c>: auto-mode proceeds after a build verdict.</summary>
public sealed record AutoDecisionRequest(string? Decision, string? By);

/// <summary><c>GET /internal/estimates/accuracy</c>, and the same numbers in an employee's track record.</summary>
public sealed record EstimateAccuracyView(string Scope, Guid? EmployeeId, EstimatesView? Estimates);

/// <summary>One checkpoint's effective value at a scope, and where it was set (null: not set anywhere, so off).</summary>
public sealed record CheckpointView(bool On, string? SetAtPath);

/// <summary>One stage's effective rule set.</summary>
public sealed record RuleSetView(string Stage, IReadOnlyList<string> Deny, IReadOnlyList<string> Ask, IReadOnlyList<string> Allow, IReadOnlyList<string> Checkpoints, string SetAtPath, IReadOnlyList<string> Overrides);

/// <summary>
/// <c>GET /api/autonomy?scope=</c>: how much the workforce does on its own here. <c>autonomy</c> is
/// <c>auto</c> or <c>checkpoints</c>; checkpoints only stop work when autonomy is <c>checkpoints</c>.
/// </summary>
public sealed record AutonomyView(
    string Scope,
    string Autonomy,
    string? AutonomySetAtPath,
    IReadOnlyDictionary<string, CheckpointView> Checkpoints,
    IReadOnlyList<RuleSetView> RuleSets,
    IReadOnlyList<string> Stages);

/// <summary><c>PUT /api/autonomy</c>. Any field left out is unchanged.</summary>
public sealed record AutonomyRequest(string? Scope, string? Autonomy, CheckpointsRequest? Checkpoints);

public sealed record CheckpointsRequest(bool? Start, bool? Plan, bool? Hire);

/// <summary><c>PUT /api/autonomy/rule-sets</c>: the rule set for one stage (or <c>all</c>) at a scope.</summary>
public sealed record RuleSetRequest(string? Scope, string? Stage, IReadOnlyList<string>? Deny, IReadOnlyList<string>? Ask, IReadOnlyList<string>? Allow, IReadOnlyList<string>? Checkpoints);

/// <summary>
/// What the Runner needs to run the factory for real (placement, headroom, cost history, the
/// conversation's reads and actions, auto-mode's decision), and the console's autonomy settings.
/// </summary>
internal static class FactoryEndpoints
{
    public static void MapFactoryInternal(this RouteGroupBuilder group)
    {
        group.MapPost("/tree/nodes", async (EnsureNodeRequest request, ScopeResolver scopes, TreeService tree, CancellationToken ct) =>
        {
            var level = request.Level switch
            {
                "division" => NodeLevel.Division,
                "project" => NodeLevel.Project,
                "app" => NodeLevel.App,
                _ => throw EndgameProblem.Invalid("level is division, project or app."),
            };
            var parent = await scopes.RequireAsync(request.Parent, ct);
            var (node, created) = await tree.EnsureChildAsync(parent, level, request.Name ?? "", request.Slug ?? "", ct);
            return created ? Results.Created($"/internal/tree/nodes/{node.Id}", node) : Results.Ok(node);
        })
        .WithName("EnsureTreeNode")
        .WithSummary("Placement: the division, project or app with this slug under its parent — 201 when created, 200 with the node when it already existed.")
        .Produces<NodeView>(201).Produces<NodeView>();

        group.MapGet("/credits/headroom", async (string? scope, Guid? employeeId, ScopeResolver scopes, CreditLedger ledger, TimeProvider clock, CancellationToken ct) =>
        {
            var resolved = await scopes.RequireAsync(scope, ct);
            var position = await ledger.PositionAsync(resolved, employeeId, clock.GetUtcNow(), ct);
            var (headroom, binding, kind) = position.Headroom();
            return Results.Ok(new HeadroomView(resolved.Path.ToString(), headroom, binding, kind, position.Balance, position.OverdraftLimit));
        })
        .WithName("CreditHeadroom")
        .WithSummary("The most new work at a scope may still spend: the tightest monthly cap on the chain (and the employee's), or the balance down to the overdraft limit.")
        .Produces<HeadroomView>();

        group.MapGet("/estimates/history", async (string? taskType, string? kind, string? scope, int? limit, ScopeResolver scopes, ReadModels reads, CancellationToken ct) =>
        {
            var runKind = kind ?? taskType;
            if (runKind is null || !RunKinds.All.Contains(runKind))
            {
                throw EndgameProblem.Invalid($"taskType is the kind of run: {string.Join(", ", RunKinds.All)}.");
            }

            if (string.IsNullOrWhiteSpace(scope))
            {
                // Tenant data is never used across organisations (CLAUDE.md rule 2): history is one organisation's.
                throw new EndgameProblem(400, "scope_required", "Name the scope",
                    "Cost history is read within one organisation: send scope=<the run's scope>.");
            }

            var resolved = await scopes.RequireAsync(scope, ct);
            return Results.Ok(await reads.CostHistoryAsync(resolved.OrganisationId, runKind, limit ?? 50, ct));
        })
        .WithName("EstimateHistory")
        .WithSummary("What finished (succeeded) runs of a kind actually cost in the scope's organisation, newest first: [{runId, finishedAt, credits, steps}]. Billable settlements only.")
        .Produces<IReadOnlyList<CostHistoryView>>();

        group.MapGet("/estimates/accuracy", async (string? scope, Guid? employeeId, ScopeResolver scopes, ReadModels reads, CancellationToken ct) =>
        {
            var resolved = await scopes.RequireAsync(scope, ct);
            return Results.Ok(new EstimateAccuracyView(resolved.Path.ToString(), employeeId, await reads.EstimatesAsync(resolved, ct, employeeId)));
        })
        .WithName("EstimateAccuracy")
        .WithSummary("How estimates scored against actuals at a scope, optionally for one employee. estimates is null before any was scored.")
        .Produces<EstimateAccuracyView>();

        group.MapGet("/tasks", async (string? scope, string? status, int? limit, ScopeResolver scopes, TaskService tasks, CancellationToken ct) =>
            Results.Ok(await tasks.ListAsync(await scopes.RequireAsync(scope, ct), status, limit ?? 100, ct)))
        .WithName("ListTasksInternal").WithSummary("Tasks at the scope and beneath it, most recently changed first.").Produces<IReadOnlyList<TaskView>>();

        group.MapGet("/runs", async (string? scope, string? kind, string? status, int? limit, ScopeResolver scopes, RunService runs, CancellationToken ct) =>
            Results.Ok(await runs.ListAsync(await scopes.RequireAsync(scope, ct), kind, status, limit ?? 20, ct)))
        .WithName("ListRunsInternal").WithSummary("Runs at the scope and beneath it, newest first (at most 200).").Produces<IReadOnlyList<RunView>>();

        group.MapGet("/credits", async (string? scope, ScopeResolver scopes, ReadModels reads, CancellationToken ct) =>
            Results.Ok(await reads.CreditsAsync(await scopes.RequireAsync(scope, ct), ct)))
        .WithName("GetCreditsInternal").WithSummary("The scope's credits, as the console reads them: balance, month, budgets, estimates, overdraft.").Produces<CreditsView>();

        group.MapPost("/ideas", async (InternalIdeaRequest request, ScopeResolver scopes, IdeaService ideas, ResearchEstimator estimator, CancellationToken ct) =>
        {
            var resolved = await scopes.RequireAsync(request.Scope, ct);
            // An idea is proposed to the organisation or a division: from deeper, to the division it sits in.
            if (resolved.Level > NodeLevel.Division)
            {
                resolved = await scopes.RequireAsync(ScopePath.Of(resolved.Path.Organisation, resolved.Path.Division!).ToString(), ct);
            }

            var estimate = estimator.EstimateResearch(request.Text, request.Constraints);
            var started = await ideas.CreateAsync(resolved, request.Text ?? "", request.Constraints, estimate.Credits, null, ct, via: "conversation");
            return Results.Created($"/api/ideas/{started.Idea.Id}", new { idea = started.Idea, run = started.Run, estimate = new IdeaEstimateView(estimate.Credits, estimate.Basis) });
        })
        .WithName("StartIdeaInternal")
        .WithSummary("The conversation starts research on an idea the owner confirmed: the idea, its research run and the estimate shown first.");

        group.MapPut("/cascade", async (InternalCascadeRequest request, ScopeResolver scopes, CascadeService cascade, EdgeNotifier edge, CancellationToken ct) =>
        {
            var key = request.Key ?? "";
            if (request.Kind != "setting" || !AgentSettings.Allowed.Contains(key))
            {
                var refused = new EndgameProblem(403, "setting_not_allowed", "An agent may not change that",
                    $"Agents may change only these settings, each confirmed by the owner first: {string.Join(", ", AgentSettings.Allowed)}. Everything else, including who may open an app, is done by a person in the console.");
                refused.Extensions["allowed"] = AgentSettings.Allowed;
                throw refused;
            }

            var resolved = await scopes.RequireAsync(request.Scope, ct);
            var result = await cascade.SetAsync(resolved, CascadeKind.Setting, key, request.Value, null, Actor.Agent, ct);
            if (key.StartsWith("sleep.", StringComparison.Ordinal))
            {
                edge.RoutesChanged();
            }

            return Results.Ok(result);
        })
        .WithName("SetSettingInternal")
        .WithSummary("An agent changes one allow-listed setting (autonomy, checkpoints, sleep, idle days) at a scope. Never access: making an app public is a person's act.")
        .Produces<EffectiveValue>();

        group.MapPost("/ideas/{id:guid}/decision", async (Guid id, AutoDecisionRequest request, IdeaService ideas, ReadModels reads, CancellationToken ct) =>
        {
            if (request.By != IdeaDecisions.ByAutoMode)
            {
                throw EndgameProblem.Invalid("This endpoint is auto-mode's: send by: \"auto-mode\". People decide in the console.");
            }

            var org = await ideas.OrganisationOfAsync(id, ct);
            var (_, run) = await ideas.DecideAutomaticallyAsync(org, id, request.Decision ?? "", ct);
            return Results.Ok(new { idea = await reads.IdeaAsync(org, id, ct), run });
        })
        .WithName("DecideIdeaAutomatically")
        .WithSummary("Auto-mode builds after a build or change verdict where autonomy is auto. A do-not-build (409 owner_decision_required) waits for the owner; a breached red line is 403 red_line.");
    }

    public static void MapAutonomy(this RouteGroupBuilder api)
    {
        var autonomy = api.MapGroup("/autonomy").WithTags("Autonomy");
        autonomy.MapGet("", async (string? scope, ClaimsPrincipal principal, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await ViewAsync(resolved, cascade, ct));
        })
        .WithName("GetAutonomy").WithSummary("Autonomy, checkpoints and stage rule sets in effect at a scope, each with where it was set.").Produces<AutonomyView>();

        autonomy.MapPut("", async (AutonomyRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Admin, ct);
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            var actor = access.IsOperator(me) ? Actor.Operator : Actor.Member;
            if (request.Autonomy is null && request.Checkpoints is null)
            {
                throw EndgameProblem.Invalid("Send autonomy ('auto' or 'checkpoints'), checkpoints { start, plan, hire }, or both.");
            }

            if (request.Autonomy is { } mode)
            {
                await cascade.SetAsync(resolved, CascadeKind.Setting, Autonomy.Key, JsonValue.Create(mode), me.Id, actor, ct);
            }

            foreach (var (key, on) in new[] { (Autonomy.CheckpointStart, request.Checkpoints?.Start), (Autonomy.CheckpointPlan, request.Checkpoints?.Plan), (Autonomy.CheckpointHire, request.Checkpoints?.Hire) })
            {
                if (on is { } value)
                {
                    await cascade.SetAsync(resolved, CascadeKind.Setting, key, JsonValue.Create(value), me.Id, actor, ct);
                }
            }

            return Results.Ok(await ViewAsync(resolved, cascade, ct));
        })
        .WithName("SetAutonomy").WithSummary("Sets autonomy and checkpoints at a scope (Admin and above); they apply beneath unless narrowed.").Produces<AutonomyView>();

        autonomy.MapDelete("", async (string? scope, string? key, ClaimsPrincipal principal, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            if (key is null || (key != Autonomy.Key && !Autonomy.CheckpointKeys.Contains(key)))
            {
                throw EndgameProblem.Invalid($"key is one of {Autonomy.Key}, {string.Join(", ", Autonomy.CheckpointKeys)}.");
            }

            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
            await cascade.RemoveAsync(resolved, CascadeKind.Setting, key, ct);
            return Results.Ok(await ViewAsync(resolved, cascade, ct));
        })
        .WithName("RemoveAutonomySetting").WithSummary("Removes autonomy or a checkpoint set at this scope; the inherited value applies again.").Produces<AutonomyView>();

        autonomy.MapPut("/rule-sets", async (RuleSetRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Admin, ct);
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            var value = new JsonObject
            {
                ["deny"] = Strings(request.Deny),
                ["ask"] = Strings(request.Ask),
                ["allow"] = Strings(request.Allow),
                ["checkpoints"] = Strings(request.Checkpoints),
            };
            await cascade.SetAsync(resolved, CascadeKind.RuleSet, request.Stage ?? "", value, me.Id, access.IsOperator(me) ? Actor.Operator : Actor.Member, ct);
            return Results.Ok(await ViewAsync(resolved, cascade, ct));
        })
        .WithName("SetRuleSet").WithSummary("Sets the rule set for one stage (or all) at a scope: what the agents may not do (deny), what needs sign-off (ask, checkpoints), and what they may do (allow).").Produces<AutonomyView>();

        autonomy.MapDelete("/rule-sets", async (string? scope, string? stage, ClaimsPrincipal principal, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
            return await cascade.RemoveAsync(resolved, CascadeKind.RuleSet, stage ?? "", ct)
                ? Results.Ok(await ViewAsync(resolved, cascade, ct))
                : Problems.From(EndgameProblem.NotFound($"A rule set for '{stage}' set at '{scope}'"));
        })
        .WithName("RemoveRuleSet").WithSummary("Removes the rule set for a stage set at this scope; the inherited one applies again.").Produces<AutonomyView>();
    }

    private static JsonArray Strings(IReadOnlyList<string>? values) => new((values ?? []).Select(v => (JsonNode)JsonValue.Create(v.Trim())!).ToArray());

    private static async Task<AutonomyView> ViewAsync(ResolvedScope scope, CascadeService cascade, CancellationToken ct)
    {
        var settings = await cascade.ResolveAsync(scope, CascadeKind.Setting, ct);
        var mode = settings.FirstOrDefault(s => s.Key == Autonomy.Key);
        var checkpoints = Autonomy.CheckpointKeys.ToDictionary(
            k => k["checkpoint.".Length..],
            k => settings.FirstOrDefault(s => s.Key == k) is { } set
                ? new CheckpointView(set.Value?.GetValueKind() == JsonValueKind.True, set.SetAtPath)
                : new CheckpointView(false, null));
        var rules = (await cascade.ResolveAsync(scope, CascadeKind.RuleSet, ct))
            .Select(r => new RuleSetView(r.Key, List(r.Value, "deny"), List(r.Value, "ask"), List(r.Value, "allow"), List(r.Value, "checkpoints"), r.SetAtPath, r.Overrides))
            .ToList();
        return new AutonomyView(scope.Path.ToString(), Autonomy.ModeOf(mode?.Value), mode?.SetAtPath, checkpoints, rules, Autonomy.Stages);

        static IReadOnlyList<string> List(JsonNode? value, string field) =>
            (value?[field] as JsonArray ?? []).OfType<JsonValue>().Where(v => v.GetValueKind() == JsonValueKind.String).Select(v => v.GetValue<string>()).ToList();
    }
}
