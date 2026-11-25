using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.ControlPlane.Endpoints;
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

namespace Endgame.ControlPlane.Mcp;

/// <summary>
/// The control plane's MCP tools. Each one calls the same service the public endpoint calls, behind
/// the same role check at the same scope (and the token's ceiling, which <see cref="AccessService"/>
/// applies to every check). The actor is <see cref="Actor.Mcp"/>, never a person, so what only a
/// person may do — make an app public, set the organisation's overdraft, top up — stays impossible
/// here; and a red line refuses a build for everyone, so it refuses it here too.
/// </summary>
internal static class ControlPlaneTools
{
    public static readonly IReadOnlyList<McpTool> All = Build();

    /// <summary>The role each tool needs, as the authorisation matrix test reads it.</summary>
    public static readonly IReadOnlyDictionary<string, MemberRole> Roles = new Dictionary<string, MemberRole>(StringComparer.Ordinal)
    {
        ["tree_get"] = MemberRole.Viewer,
        ["node_create"] = MemberRole.Builder,
        ["node_update"] = MemberRole.Builder,
        ["cascade_get"] = MemberRole.Viewer,
        ["cascade_set"] = MemberRole.Admin,
        ["cascade_remove"] = MemberRole.Admin,
        ["idea_estimate"] = MemberRole.Viewer,
        ["idea_submit"] = MemberRole.Builder,
        ["idea_get"] = MemberRole.Viewer,
        ["idea_decide"] = MemberRole.Builder,
        ["ideas_suggest"] = MemberRole.Builder,
        ["ideas_suggestions"] = MemberRole.Viewer,
        ["suggestion_take"] = MemberRole.Builder,
        ["runs_list"] = MemberRole.Viewer,
        ["run_get"] = MemberRole.Viewer,
        ["run_events"] = MemberRole.Viewer,
        ["run_control"] = MemberRole.Builder,
        ["approval_answer"] = MemberRole.Builder,
        ["tasks_list"] = MemberRole.Viewer,
        ["credits_get"] = MemberRole.Viewer,
        ["budget_set"] = MemberRole.Admin,
        ["employees_list"] = MemberRole.Viewer,
        ["employee_get"] = MemberRole.Viewer,
        ["employee_update"] = MemberRole.Admin,
        ["employee_release"] = MemberRole.Admin,
        ["hires_list"] = MemberRole.Viewer,
        ["hire_raise"] = MemberRole.Admin,
        ["hire_decide"] = MemberRole.Admin,
        ["autonomy_get"] = MemberRole.Viewer,
        ["autonomy_set"] = MemberRole.Admin,
        ["rule_set_set"] = MemberRole.Admin,
        ["members_list"] = MemberRole.Admin,
        ["member_invite"] = MemberRole.Admin,
        ["member_revoke"] = MemberRole.Admin,
        ["secrets_list"] = MemberRole.Admin,
        ["secret_set"] = MemberRole.Admin,
        ["secret_remove"] = MemberRole.Admin,
        ["app_get"] = MemberRole.Viewer,
        ["app_settings"] = MemberRole.Builder,
        ["app_ask"] = MemberRole.Builder,
        ["app_versions"] = MemberRole.Viewer,
        ["app_restore"] = MemberRole.Builder,
        ["conversation_post"] = MemberRole.Builder,
        ["ontology_get"] = MemberRole.Viewer,
        ["notifications_list"] = MemberRole.Admin,
    };

    private static List<McpTool> Build() =>
    [
        // ------------------------------------------------------------------ the tree and the cascade
        Read("tree_get", "The whole organisation as one document: every division, project and app with its status, this month's spend and who works on it, plus what needs a person.",
            Schema(), async c =>
            {
                var access = c.S<AccessService>();
                var membership = (await access.MembershipsOfAsync(c.UserId, c.Ct)).FirstOrDefault() ?? throw EndgameProblem.NotFound("An organisation for this token");
                return await c.S<ReadModels>().TreeAsync(membership.OrganisationId, await access.GrantsInOrganisationAsync(c.UserId, membership.OrganisationId, c.Ct), c.Ct);
            }),
        Write("node_create", "Creates a division (Admin), project or app (Builder) under its parent scope.",
            Schema(("level", Enum("What to create.", "division", "project", "app"), true), ("parent", Str("The parent's scope path, e.g. 'acme' or 'acme/products'."), true),
                ("name", Str("Its name."), true), ("slug", Str("Its address segment: 2-40 lower-case letters, digits and hyphens."), true)), async c =>
            {
                var level = Level(c.Req("level"));
                var (parent, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("parent"), level == NodeLevel.Division ? MemberRole.Admin : MemberRole.Builder, c.Ct);
                if (parent.Level != level - 1)
                {
                    throw EndgameProblem.Invalid($"A {level.ToWire()} is created under a {(level - 1).ToWire()}; '{parent.Path}' is a {parent.Level.ToWire()}.");
                }

                return await c.S<TreeService>().CreateChildAsync(parent, c.Req("name"), c.Req("slug"), c.Ct);
            }),
        Write("node_update", "Renames a division, project or app, or changes its status (active or archived; an app's is reported by hosting).",
            Schema(("scope", Str("The node's scope path."), true), ("name", Str("A new name."), false), ("status", Str("A new status."), false)), async c =>
            {
                var access = c.S<AccessService>();
                var scope = await c.S<ScopeResolver>().RequireAsync(c.Req("scope"), c.Ct);
                if (scope.Level == NodeLevel.Organisation)
                {
                    throw EndgameProblem.Forbidden("An organisation is renamed by its Owner, through PATCH /api/organisations/{id} with a signed-in session; not with an assistant's key.");
                }

                await access.RequireAsync(c.UserId, scope, scope.Level == NodeLevel.Division ? MemberRole.Admin : MemberRole.Builder, c.Ct);
                return await c.S<TreeService>().UpdateAsync(scope, c.Str("name"), c.Str("status"), c.Ct);
            }),
        Read("cascade_get", "The effective values of one kind at a scope (budget, rule_set, context, setting; secret and permission need Admin), each with the level that set it.",
            Schema(("scope", Str("A scope path."), true), ("kind", Enum("The kind.", CascadeKinds.All.ToArray()), true)), async c =>
            {
                var kind = TreeEndpoints.Kind(c.Req("kind"));
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), kind is CascadeKind.Permission or CascadeKind.Secret ? MemberRole.Admin : MemberRole.Viewer, c.Ct);
                return await c.S<CascadeService>().ResolveAsync(scope, kind, c.Ct);
            }),
        Write("cascade_set", "Sets a budget, rule set, context or setting at a scope; it applies beneath unless narrowed. Never 'access: public' (a person's act) and never an organisation's deepest overdraft (FrostAura's).",
            Schema(("scope", Str("A scope path."), true), ("kind", Enum("The kind.", "budget", "rule_set", "context", "setting"), true), ("key", Str("The key, e.g. monthly_credits or sleep.mode."), true),
                ("value", Any("The value (JSON)."), true)), async c =>
            {
                var kind = TreeEndpoints.Kind(c.Req("kind"));
                if (kind is CascadeKind.Secret or CascadeKind.Permission)
                {
                    throw EndgameProblem.Invalid("Secrets are set with secret_set and roles with member_invite.");
                }

                var key = c.Req("key");
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), CascadeService.RoleToSet(kind, key), c.Ct);
                var result = await c.S<CascadeService>().SetAsync(scope, kind, key, c.Node("value"), c.UserId, Actor.Mcp, c.Ct);
                if (kind is CascadeKind.Setting or CascadeKind.Budget)
                {
                    c.S<EdgeNotifier>().RoutesChanged();
                }

                return result;
            }),
        Write("cascade_remove", "Removes a value set at a scope; what is inherited applies again.",
            Schema(("scope", Str("A scope path."), true), ("kind", Enum("The kind.", "budget", "rule_set", "context", "setting"), true), ("key", Str("The key."), true)), async c =>
            {
                var kind = TreeEndpoints.Kind(c.Req("kind"));
                var key = c.Req("key");
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), CascadeService.RoleToSet(kind, key), c.Ct);
                return new { removed = await c.S<CascadeService>().RemoveAsync(scope, kind, key, c.Ct) };
            }),

        // ------------------------------------------------------------------ ideas and verdicts
        Read("idea_estimate", "What researching an idea will cost at most, before anything is charged.",
            Schema(("text", Str("The idea."), true), ("constraints", Strings("Constraints, in plain language."), false), ("scope", Str("The organisation it is for, so its own history is used; defaults to the token's."), false)), async c =>
            {
                var access = c.S<AccessService>();
                var scopeText = c.Str("scope") ?? (await access.MembershipsOfAsync(c.UserId, c.Ct)).FirstOrDefault()?.OrganisationSlug;
                Guid? organisation = scopeText is null ? null : (await access.RequireAsync(c.UserId, scopeText, MemberRole.Viewer, c.Ct)).Scope.OrganisationId;
                var estimate = await c.S<ResearchEstimator>().ResearchAsync(organisation, c.Req("text"), c.Strings("constraints"), c.Ct);
                return new IdeaEstimateView(estimate.Credits, estimate.Basis);
            }),
        Write("idea_submit", "Records an idea and queues its research (the estimate is shown in the run's log first). Research ends in a verdict a person decides on.",
            Schema(("text", Str("The idea."), true), ("constraints", Strings("Constraints, in plain language."), false), ("scope", Str("The organisation or division to propose it to; defaults to the organisation."), false)), async c =>
            {
                var access = c.S<AccessService>();
                var scopeText = c.Str("scope") ?? (await access.MembershipsOfAsync(c.UserId, c.Ct)).FirstOrDefault()?.OrganisationSlug;
                var (scope, _) = await access.RequireAsync(c.UserId, scopeText, MemberRole.Builder, c.Ct);
                var estimate = await c.S<ResearchEstimator>().ResearchAsync(scope.OrganisationId, c.Req("text"), c.Strings("constraints"), c.Ct);
                var started = await c.S<IdeaService>().CreateAsync(scope, c.Req("text"), c.Strings("constraints"), estimate.Credits, c.UserId, c.Ct, via: "mcp", estimate.Basis, estimate.Ceiling);
                return await c.S<ReadModels>().IdeaAsync(scope.OrganisationId, started.Idea.Id, c.Ct);
            }),
        Read("idea_get", "An idea: its research, its verdict (with the evidence), the decision taken and the organisation's verdict record.",
            Schema(("id", Uuid("The idea's id."), true)), async c =>
            {
                var ideas = c.S<IdeaService>();
                var id = c.Id("id");
                var org = await ideas.OrganisationOfAsync(id, c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, await ideas.ScopeOfAsync(org, id, c.Ct), MemberRole.Viewer, c.Ct);
                return await c.S<ReadModels>().IdeaAsync(org, id, c.Ct);
            }),
        Write("idea_decide", "Decides on a verdict: build, change (research again), overrule (build over a do-not-build, recorded) or drop. A breached red line refuses build and overrule for everyone.",
            Schema(("id", Uuid("The idea's id."), true), ("choice", Enum("The decision.", IdeaDecisions.All.ToArray()), true), ("note", Str("Why, for the record."), false)), async c =>
            {
                var ideas = c.S<IdeaService>();
                var id = c.Id("id");
                var org = await ideas.OrganisationOfAsync(id, c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, await ideas.ScopeOfAsync(org, id, c.Ct), MemberRole.Builder, c.Ct);
                await ideas.DecideAsync(org, id, c.Req("choice"), c.Str("note"), c.UserId, c.Ct);
                return await c.S<ReadModels>().IdeaAsync(org, id, c.Ct);
            }),
        Write("ideas_suggest", "Queues a run that proposes up to five new ideas from what the organisation already holds (estimate first, in the run's log).",
            Schema(("scope", Str("The organisation or a division."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Builder, c.Ct);
                var service = c.S<SuggestionService>();
                var estimate = await c.S<ResearchEstimator>().SuggestionsAsync(scope.OrganisationId, await service.ContextSizeAsync(scope, c.Ct), c.Ct);
                var started = await service.StartAsync(scope, estimate, c.UserId, c.Ct);
                return new SuggestionsStartedView(await c.S<ReadModels>().RunAsync(scope.OrganisationId, started.Run.Id, c.Ct), new IdeaEstimateView(estimate.Credits, estimate.Basis));
            }),
        Read("ideas_suggestions", "Suggested ideas at a scope and beneath it, newest first.",
            Schema(("scope", Str("A scope path."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<SuggestionService>().ListAsync(scope, c.Ct);
            }),
        Write("suggestion_take", "Turns a suggestion into an idea; its research is queued with its estimate.",
            Schema(("id", Uuid("The suggestion's id."), true), ("constraints", Strings("Constraints for the idea."), false)), async c =>
            {
                var service = c.S<SuggestionService>();
                var id = c.Id("id");
                var (suggestion, scope) = await service.RequireAsync(id, c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, MemberRole.Builder, c.Ct);
                var estimate = await c.S<ResearchEstimator>().ResearchAsync(scope.OrganisationId, SuggestionService.IdeaText(suggestion), c.Strings("constraints"), c.Ct);
                var started = await service.TakeAsync(id, c.Strings("constraints"), estimate, c.UserId, c.Ct);
                return await c.S<ReadModels>().IdeaAsync(scope.OrganisationId, started.Idea.Id, c.Ct);
            }),

        // ------------------------------------------------------------------ runs, tasks, approvals
        Read("runs_list", "Runs at a scope and beneath it, newest first; one employee's with employeeId.",
            Schema(("scope", Str("A scope path."), true), ("employeeId", Uuid("Only this employee's runs."), false), ("limit", Int("At most this many (1-100)."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                var list = await c.S<RunService>().ListAsync(scope, null, null, Math.Clamp(c.Int("limit") ?? 20, 1, 100), c.Ct, c.OptionalId("employeeId"));
                var reads = c.S<ReadModels>();
                var views = new List<PublicRunView>();
                foreach (var run in list)
                {
                    views.Add(await reads.RunAsync(scope.OrganisationId, run.Id, c.Ct));
                }

                return views;
            }),
        Read("run_get", "A run's status, estimate and spend.",
            Schema(("id", Uuid("The run's id."), true)), async c =>
            {
                var (run, scope) = await c.S<RunService>().RequireAsync(c.Id("id"), c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, MemberRole.Viewer, c.Ct);
                return await c.S<ReadModels>().RunAsync(run.OrganisationId, run.Id, c.Ct);
            }),
        Read("run_events", "A page of a run's log, after a sequence number (at most 200 events).",
            Schema(("id", Uuid("The run's id."), true), ("after", Int("Events after this sequence number."), false), ("limit", Int("At most this many (1-200)."), false)), async c =>
            {
                var service = c.S<RunService>();
                var (run, scope) = await service.RequireAsync(c.Id("id"), c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, MemberRole.Viewer, c.Ct);
                return await service.ReadEventsAsync(run.OrganisationId, run.Id, c.Int("after") ?? 0, Math.Clamp(c.Int("limit") ?? 100, 1, 200), c.Ct);
            }),
        Write("run_control", "Pauses, resumes or cancels a run (cancelling releases what it had reserved).",
            Schema(("id", Uuid("The run's id."), true), ("action", Enum("What to do.", "pause", "resume", "cancel"), true), ("reason", Str("Why."), false)), async c =>
            {
                var service = c.S<RunService>();
                var (run, scope) = await service.RequireAsync(c.Id("id"), c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, MemberRole.Builder, c.Ct);
                _ = c.Req("action") switch
                {
                    "pause" => await service.PauseAsync(run.OrganisationId, run.Id, c.UserId, c.Str("reason"), c.Ct),
                    "resume" => await service.ResumeAsync(run.OrganisationId, run.Id, c.UserId, c.Ct),
                    "cancel" => await service.CancelAsync(run.OrganisationId, run.Id, c.UserId, c.Str("reason"), c.Ct),
                    _ => throw EndgameProblem.Invalid("action is pause, resume or cancel."),
                };
                return await c.S<ReadModels>().RunAsync(run.OrganisationId, run.Id, c.Ct);
            }),
        Write("approval_answer", "Approves or rejects a checkpoint a run is waiting on.",
            Schema(("runId", Uuid("The run."), true), ("approvalId", Uuid("The approval."), true), ("decision", Enum("The answer.", "approve", "reject"), true), ("note", Str("Why."), false)), async c =>
            {
                var approve = c.Req("decision") switch
                {
                    "approve" => true,
                    "reject" => false,
                    _ => throw EndgameProblem.Invalid("decision is 'approve' or 'reject'."),
                };
                var (run, scope) = await c.S<RunService>().RequireAsync(c.Id("runId"), c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, MemberRole.Builder, c.Ct);
                return await c.S<ApprovalService>().AnswerAsync(run.OrganisationId, run.Id, c.Id("approvalId"), approve, c.Str("note"), c.UserId, c.Ct);
            }),
        Read("tasks_list", "Tasks at a scope and beneath it, most recently changed first.",
            Schema(("scope", Str("A scope path."), true), ("status", Str("Only this status."), false), ("limit", Int("At most this many."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<TaskService>().ListAsync(scope, c.Str("status"), c.Int("limit") ?? 100, c.Ct);
            }),

        // ------------------------------------------------------------------ credits and budgets
        Read("credits_get", "Balance, this month's spend, budgets down the cascade, estimate accuracy, what was not charged, overdraft and top-ups.",
            Schema(("scope", Str("A scope path."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<ReadModels>().CreditsAsync(scope, c.Ct);
            }),
        Write("budget_set", "Sets the monthly credit cap at a scope (Admin). Work that would break it does not start.",
            Schema(("scope", Str("A scope path."), true), ("monthlyCredits", Num("The cap, in credits per calendar month."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                var value = c.Dec("monthlyCredits") ?? throw EndgameProblem.Invalid("monthlyCredits is a number.");
                var result = await c.S<CascadeService>().SetAsync(scope, CascadeKind.Budget, CascadeKeys.MonthlyCredits, JsonValue.Create(value), c.UserId, Actor.Mcp, c.Ct);
                c.S<EdgeNotifier>().RoutesChanged();
                return result;
            }),

        // ------------------------------------------------------------------ the workforce
        Read("employees_list", "Employees at a scope and beneath it, with contractors while they work.",
            Schema(("scope", Str("A scope path."), true), ("includeReleased", Bool("Released ones too."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<EmployeeService>().ListAsync(scope, c.Bool("includeReleased") ?? false, c.Ct);
            }),
        Read("employee_get", "An employee: job description, place on the chart, status, track record, contractors and reports.",
            Schema(("id", Uuid("The employee's id."), true)), async c =>
            {
                var employee = await Employee(c, MemberRole.Viewer);
                return await c.S<EmployeeService>().DetailAsync(employee.OrganisationId, employee.Id, c.Ct);
            }),
        Write("employee_update", "Changes an employee's name, role, job description or manager, or pauses (paused) and resumes (idle) them.",
            Schema(("id", Uuid("The employee's id."), true), ("name", Str("A new name."), false), ("role", Str("A new role."), false),
                ("mandate", Str("A new mandate for the job description."), false), ("status", Enum("paused or idle (resume).", "paused", "idle"), false)), async c =>
            {
                var employee = await Employee(c, MemberRole.Admin);
                var job = c.Str("mandate") is { } mandate ? new JobDescriptionInput(mandate, null, null, null, null) : null;
                return await c.S<EmployeeService>().UpdateAsync(employee.OrganisationId, employee.Id, c.Str("name"), c.Str("role"), job, null, false, false, c.Str("status"), c.Ct);
            }),
        Write("employee_release", "Lets an employee go: off the chart and the bill, memory archived so a rehire starts warm.",
            Schema(("id", Uuid("The employee's id."), true)), async c =>
            {
                var employee = await Employee(c, MemberRole.Admin);
                return await c.S<EmployeeService>().ReleaseAsync(employee.OrganisationId, employee.Id, c.Ct);
            }),
        Read("hires_list", "Hire proposals at a scope and beneath it (proposed, accepted, declined).",
            Schema(("scope", Str("A scope path."), true), ("status", Enum("Only this status.", "proposed", "accepted", "declined"), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<HireService>().ListAsync(scope, c.Str("status"), c.Ct);
            }),
        Write("hire_raise", "Raises a need for a hire with its job description and expected monthly cost. In auto-mode one within budget is accepted at once.",
            Schema(("scope", Str("Where they would work."), true), ("name", Str("Their name."), true), ("role", Str("Their role."), true), ("mandate", Str("What they are for."), true),
                ("reason", Str("Why the hire is needed."), true), ("expectedMonthlyCredits", Num("What they are expected to cost a month."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                var input = new HireInput(Domain.Workforce.HireTriggers.Owner, null, c.Req("reason"), c.Req("name"), c.Req("role"),
                    new JobDescriptionInput(c.Req("mandate"), null, null, null, null), null, c.Dec("expectedMonthlyCredits"), null);
                return (await c.S<HireService>().RaiseAsync(scope, input, c.UserId, null, c.Ct)).Hire;
            }),
        Write("hire_decide", "Accepts or declines a hire proposal.",
            Schema(("id", Uuid("The proposal's id."), true), ("decision", Enum("The answer.", "accept", "decline"), true), ("note", Str("Why."), false)), async c =>
            {
                var hires = c.S<HireService>();
                var id = c.Id("id");
                var org = await hires.OrganisationOfAsync(id, c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, await hires.ScopeOfAsync(org, id, c.Ct), MemberRole.Admin, c.Ct);
                return c.Req("decision") switch
                {
                    "accept" => await hires.AcceptAsync(org, id, c.UserId, IdeaDecisions.ByPerson, null, c.Str("note"), c.Ct),
                    "decline" => await hires.DeclineAsync(org, id, c.UserId, c.Str("note"), c.Ct),
                    _ => throw EndgameProblem.Invalid("decision is accept or decline."),
                };
            }),

        // ------------------------------------------------------------------ autonomy
        Read("autonomy_get", "Autonomy, checkpoints and stage rule sets in effect at a scope, each with where it was set.",
            Schema(("scope", Str("A scope path."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<CascadeService>().ResolveAsync(scope, CascadeKind.Setting, c.Ct);
            }),
        Write("autonomy_set", "Sets autonomy (auto or checkpoints) and the start, plan and hire checkpoints at a scope.",
            Schema(("scope", Str("A scope path."), true), ("autonomy", Enum("The mode.", Autonomy.Modes.ToArray()), false), ("start", Bool("Checkpoint before work starts."), false),
                ("plan", Bool("Checkpoint on the plan."), false), ("hire", Bool("Checkpoint on hires."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                var cascade = c.S<CascadeService>();
                if (c.Str("autonomy") is { } mode)
                {
                    await cascade.SetAsync(scope, CascadeKind.Setting, Autonomy.Key, JsonValue.Create(mode), c.UserId, Actor.Mcp, c.Ct);
                }

                foreach (var (key, arg) in new[] { (Autonomy.CheckpointStart, "start"), (Autonomy.CheckpointPlan, "plan"), (Autonomy.CheckpointHire, "hire") })
                {
                    if (c.Bool(arg) is { } on)
                    {
                        await cascade.SetAsync(scope, CascadeKind.Setting, key, JsonValue.Create(on), c.UserId, Actor.Mcp, c.Ct);
                    }
                }

                return await cascade.ResolveAsync(scope, CascadeKind.Setting, c.Ct);
            }),
        Write("rule_set_set", "Sets one stage's rule set at a scope: what agents may not do (deny), what needs sign-off (ask, checkpoints) and what they may do (allow).",
            Schema(("scope", Str("A scope path."), true), ("stage", Str("The stage, or 'all'."), true), ("deny", Strings("Denied."), false), ("ask", Strings("Needs sign-off."), false),
                ("allow", Strings("Allowed."), false), ("checkpoints", Strings("Checkpoints."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                JsonArray List(string name) => new((c.Strings(name) ?? []).Select(v => (JsonNode)JsonValue.Create(v.Trim())!).ToArray());
                var value = new JsonObject { ["deny"] = List("deny"), ["ask"] = List("ask"), ["allow"] = List("allow"), ["checkpoints"] = List("checkpoints") };
                return await c.S<CascadeService>().SetAsync(scope, CascadeKind.RuleSet, c.Req("stage"), value, c.UserId, Actor.Mcp, c.Ct);
            }),

        // ------------------------------------------------------------------ people
        Read("members_list", "Everyone holding a role at a scope or beneath it, with where each grant was set.",
            Schema(("scope", Str("A scope path."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                return await c.S<AccountService>().MembersAsync(scope, c.Ct);
            }),
        Write("member_invite", "Grants a role (builder or viewer; admin is the Owner's to grant) at a scope. A new person gets a one-time invitation code to register a passkey with.",
            Schema(("scope", Str("A scope path."), true), ("email", Str("Their e-mail address."), true), ("role", Enum("The role.", "admin", "builder", "viewer"), true),
                ("displayName", Str("Their name."), false)), async c =>
            {
                MemberRole role;
                try
                {
                    role = MemberRoles.FromWire(c.Req("role"));
                }
                catch (Domain.DomainException ex)
                {
                    throw EndgameProblem.Invalid(ex.Message);
                }

                var (scope, mine) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                var invitation = await c.S<AccountService>().GrantAsync(scope, mine, c.Req("email"), c.Str("displayName"), role, c.UserId, c.Ct);
                // As at the console: a new person's code is e-mailed to them too, when a mail server is configured.
                if (invitation.InvitationCode is { } code && invitation.ExpiresAt is { } until)
                {
                    var inviter = await c.S<UserManager<EndgameUser>>().FindByIdAsync(c.UserId.ToString());
                    invitation = invitation with
                    {
                        Emailed = await c.S<InvitationMailer>().SendAsync(scope, invitation.Member.Email, code, until, role.ToWire(), inviter?.DisplayName ?? "Someone", c.Ct),
                    };
                }

                return invitation;
            }),
        Write("member_revoke", "Revokes one role grant (an Admin's, only the Owner).",
            Schema(("membershipId", Uuid("The grant's id."), true)), async c =>
            {
                var accounts = c.S<AccountService>();
                var (_, membership) = await accounts.MembershipAsync(c.Id("membershipId"), c.Ct);
                var scope = await c.S<ScopeResolver>().ForRowAsync(membership.OrganisationId, membership.DivisionId, membership.ProjectId, membership.AppId, c.Ct);
                await c.S<AccessService>().RequireAsync(c.UserId, scope, membership.Role == MemberRole.Admin.ToWire() ? MemberRole.Owner : MemberRole.Admin, c.Ct);
                await accounts.RevokeAsync(membership, c.Ct);
                return new { revoked = membership.Id };
            }),

        // ------------------------------------------------------------------ secrets (names only)
        Read("secrets_list", "The names of the secrets that apply at a scope, with the level that set each. Values are never returned, here or anywhere.",
            Schema(("scope", Str("A scope path."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                return (await c.S<CascadeService>().ResolveAsync(scope, CascadeKind.Secret, c.Ct)).Select(v => new { name = v.Key, setAtPath = v.SetAtPath, setAt = v.SetAt });
            }),
        Write("secret_set", "Sets or replaces a secret at a scope (UPPER_SNAKE_CASE name). Sealed at rest; it can be used by apps and agents but never read back.",
            Schema(("scope", Str("A scope path."), true), ("name", Str("The secret's name."), true), ("value", Str("Its value."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                var set = await c.S<CascadeService>().SetAsync(scope, CascadeKind.Secret, c.Req("name"), JsonValue.Create(c.Req("value")), c.UserId, Actor.Mcp, c.Ct);
                return new { name = set.Key, setAtPath = set.SetAtPath, setAt = set.SetAt };
            }),
        Write("secret_remove", "Removes a secret set at a scope; an inherited one applies again.",
            Schema(("scope", Str("A scope path."), true), ("name", Str("The secret's name."), true)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Admin, c.Ct);
                return new { removed = await c.S<CascadeService>().RemoveAsync(scope, CascadeKind.Secret, c.Req("name"), c.Ct) };
            }),

        // ------------------------------------------------------------------ apps
        Read("app_get", "An app's health, running state, both addresses, telemetry today, cost against its cap and settings.",
            Schema(("id", Uuid("The app's id."), true)), async c =>
            {
                var app = await App(c, MemberRole.Viewer);
                return await c.S<ReadModels>().AppAsync(app, c.Ct);
            }),
        Write("app_settings", "Changes how an app runs (sleep or always-on, idle minutes; Builder) and who may open it (private or shared; Admin). Making it public is a person's act at the console.",
            Schema(("id", Uuid("The app's id."), true), ("running", Enum("How it runs.", "sleep", "always-on"), false), ("idleMinutes", Int("Minutes idle before it sleeps (1-1440)."), false),
                ("access", Enum("Who may open it.", AppAccess.All.ToArray()), false)), async c =>
            {
                var access = c.Str("access");
                var app = await App(c, access is null ? MemberRole.Builder : MemberRole.Admin);
                var cascade = c.S<CascadeService>();
                if (c.Str("running") is { } running)
                {
                    var mode = running switch
                    {
                        "sleep" => "auto",
                        "always-on" => "always_on",
                        _ => throw EndgameProblem.Invalid("running is 'sleep' or 'always-on'."),
                    };
                    await cascade.SetAsync(app, CascadeKind.Setting, CascadeKeys.SleepMode, JsonValue.Create(mode), c.UserId, Actor.Mcp, c.Ct);
                }

                if (c.Int("idleMinutes") is { } minutes)
                {
                    await cascade.SetAsync(app, CascadeKind.Setting, CascadeKeys.SleepIdleMinutes, JsonValue.Create(minutes), c.UserId, Actor.Mcp, c.Ct);
                }

                if (access is not null)
                {
                    await cascade.SetAsync(app, CascadeKind.Setting, CascadeKeys.Access, JsonValue.Create(access), c.UserId, Actor.Mcp, c.Ct);
                }

                c.S<EdgeNotifier>().RoutesChanged();
                return await c.S<ReadModels>().AppAsync(app, c.Ct);
            }),
        Write("app_ask", "Answers a plain-language question from an app's own telemetry: an answer, a chart and the query behind it. Charged to the app (estimate in the answer).",
            Schema(("id", Uuid("The app's id."), true), ("question", Str("The question."), true)), async c =>
            {
                var app = await App(c, MemberRole.Builder);
                return await c.S<AskService>().AskAsync(app, c.Req("question"), c.Ct);
            }),
        Read("app_versions", "An app's version history: each change with who made it, its message and time, and which is live.",
            Schema(("id", Uuid("The app's id."), true), ("limit", Int("At most this many (1-200)."), false)), async c =>
            {
                var app = await App(c, MemberRole.Viewer);
                return await c.S<AppVersionService>().ListAsync(app, 0, c.Int("limit") ?? 50, c.Ct);
            }),
        Write("app_restore", "Makes an earlier version of an app the newest (a new change; history is never rewritten) and republishes it; a public app becomes private.",
            Schema(("id", Uuid("The app's id."), true), ("commit", Str("The version's commit id."), true)), async c =>
            {
                var app = await App(c, MemberRole.Builder);
                var me = await c.S<UserManager<EndgameUser>>().GetUserAsync(c.User) ?? throw EndgameProblem.Unauthenticated();
                return await c.S<AppVersionService>().RestoreAsync(app, c.Req("commit"), me, Actor.Mcp, c.Ct);
            }),

        // ------------------------------------------------------------------ conversation, ontology, notifications
        Write("conversation_post", "Sends a message in the conversation docked at a scope (or with one employee); returns the run whose events carry the reply.",
            Schema(("scope", Str("A scope path."), true), ("message", Str("The message."), true), ("employeeId", Uuid("Talk to this employee."), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Builder, c.Ct);
                var turn = await c.S<ConversationService>().PostAsync(scope, c.Req("message"), null, c.OptionalId("employeeId"), c.UserId, c.Ct);
                return await c.S<ReadModels>().RunAsync(scope.OrganisationId, turn.Run.Id, c.Ct);
            }),
        Read("ontology_get", "The organisation at and beneath a scope as a graph: nodes and typed edges (owns, works-on, reports-to, depends-on, data-flows-to).",
            Schema(("scope", Str("A scope path."), true), ("view", Enum("Which view.", "all", "org-chart", "data-flow"), false)), async c =>
            {
                var (scope, _) = await c.S<AccessService>().RequireAsync(c.UserId, c.Req("scope"), MemberRole.Viewer, c.Ct);
                return await c.S<OntologyService>().BuildAsync(scope, c.Str("view"), c.Ct);
            }),
        Read("notifications_list", "What needs a person in the organisation, newest first (Admin and above).",
            Schema(("unread", Bool("Only unread ones."), false)), async c =>
            {
                var access = c.S<AccessService>();
                var membership = (await access.MembershipsOfAsync(c.UserId, c.Ct)).FirstOrDefault() ?? throw EndgameProblem.NotFound("An organisation for this token");
                await access.RequireAsync(c.UserId, membership.OrganisationSlug, MemberRole.Admin, c.Ct);
                return await c.S<NotificationService>().FeedAsync(c.UserId, membership.OrganisationSlug, c.Bool("unread") ?? false, 50, c.Ct);
            }),
    ];

    private static McpTool Read<T>(string name, string description, JsonObject schema, Func<ToolCall, Task<T>> run) => new(name, description, schema, true, async c => await run(c));

    private static McpTool Write<T>(string name, string description, JsonObject schema, Func<ToolCall, Task<T>> run) => new(name, description, schema, false, async c => await run(c));

    private static async Task<Infrastructure.Persistence.Records.EmployeeRecord> Employee(ToolCall c, MemberRole role)
    {
        var employees = c.S<EmployeeService>();
        var employee = await employees.RequireAsync(c.Id("id"), c.Ct);
        await c.S<AccessService>().RequireAsync(c.UserId, await employees.ScopeOfAsync(employee, c.Ct), role, c.Ct);
        return employee;
    }

    private static async Task<ResolvedScope> App(ToolCall c, MemberRole role)
    {
        var app = await c.S<ScopeResolver>().FindNodeAsync(NodeLevel.App, c.Id("id"), c.Ct) ?? throw EndgameProblem.NotFound("The app");
        await c.S<AccessService>().RequireAsync(c.UserId, app, role, c.Ct);
        return app;
    }

    private static NodeLevel Level(string level) => level switch
    {
        "division" => NodeLevel.Division,
        "project" => NodeLevel.Project,
        "app" => NodeLevel.App,
        _ => throw EndgameProblem.Invalid("level is division, project or app."),
    };

    // ------------------------------------------------------------------ JSON Schema

    internal static JsonObject Schema(params (string Name, JsonObject Schema, bool Required)[] properties)
    {
        var props = new JsonObject();
        foreach (var (name, schema, _) in properties)
        {
            props[name] = schema;
        }

        var schemaObject = new JsonObject { ["type"] = "object", ["properties"] = props };
        var required = properties.Where(p => p.Required).Select(p => (JsonNode)JsonValue.Create(p.Name)!).ToArray();
        if (required.Length > 0)
        {
            schemaObject["required"] = new JsonArray(required);
        }

        return schemaObject;
    }

    private static JsonObject Str(string description) => new() { ["type"] = "string", ["description"] = description };

    private static JsonObject Uuid(string description) => new() { ["type"] = "string", ["format"] = "uuid", ["description"] = description };

    private static JsonObject Int(string description) => new() { ["type"] = "integer", ["description"] = description };

    private static JsonObject Num(string description) => new() { ["type"] = "number", ["description"] = description };

    private static JsonObject Bool(string description) => new() { ["type"] = "boolean", ["description"] = description };

    private static JsonObject Any(string description) => new() { ["description"] = description };

    private static JsonObject Strings(string description) => new() { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "string" }, ["description"] = description };

    private static JsonObject Enum(string description, params string[] values) =>
        new() { ["type"] = "string", ["enum"] = new JsonArray(values.Select(v => (JsonNode)JsonValue.Create(v)!).ToArray()), ["description"] = description };
}
