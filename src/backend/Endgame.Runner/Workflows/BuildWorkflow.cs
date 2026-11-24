using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;
using Endgame.Hosting.Contracts;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// The factory after a build decision: placement → plan → build → evaluate → security review →
/// publish (privately). Code owns every loop, gate and stop condition; agents supply judgement inside
/// each stage. One feature per session, a clean commit each, a progress file in the app's repository, a
/// separate sceptical evaluator with its own context, a capped number of repair rounds — repairs not
/// billed — each escalating the model one tier.
/// </summary>
public sealed class BuildWorkflow(Estimator estimator, IPreviewProbe? preview = null) : IWorkflow
{
    public const string ProgressFile = "PROGRESS.md";

    public string Kind => RunKinds.Build;

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        var owner = run.OwnerMessage();
        var idea = Json.Str(owner, "text") ?? run.Run.Title;

        // Placement: a division, a project and an app, created in the tree.
        var placement = await run.Journal.OnceAsync("placement", () => PlaceAsync(run, idea, cancellationToken), cancellationToken);
        var appId = Guid.Parse(Json.Str(placement, "appId")!);
        var (workspace, recreated) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), cancellationToken);
        var root = workspace.Root;

        // The plan: a contract, proposed in plan mode, accepted only once it is valid.
        var plan = PlanContract.FromJson(run.Journal.Get("plan"));
        if (plan is null)
        {
            var planner = await WorkflowSupport.RunAgentAsync(run, run.Agents.Planner(run, root), workspace,
                $"Plan the app described below. It starts from the app kit's template (the Notes example), which it replaces.\n\nThe idea:\n{idea}\n\nConstraints: {Json.Str(owner, "constraints")}", cancellationToken);
            if (WorkflowOutcome.FromAgent(planner) is { } stopped)
            {
                return stopped;
            }

            plan = planner.State.Plan;
            if (plan is null || plan.Faults().Count > 0)
            {
                return WorkflowOutcome.Failure("Planning produced no valid contract, so nothing was built." + (plan is null ? "" : " " + string.Join(" ", plan.Faults())));
            }

            if (Checkpoint(run, "plan"))
            {
                var approved = await new Harness.Platform.ControlPlaneApprovals(run.ControlPlane, run.Run.Id).RequestAsync("Accept this plan?", plan.Render(), cancellationToken);
                if (!approved)
                {
                    return WorkflowOutcome.Failure("The owner rejected the plan.");
                }
            }

            await run.AppendAsync(HarnessEvents.PlanAccepted, new JsonObject { ["by"] = Checkpoint(run, "plan") ? "owner" : "auto-mode", ["plan"] = plan.ToJson() }, cancellationToken);
            await run.Journal.RecordAsync("plan", plan.ToJson(), cancellationToken);
        }

        // The estimate, refined by the plan's size: in auto-mode a build that would break the budget does not begin.
        if (!run.Journal.Done("estimate.plan"))
        {
            var estimate = await estimator.EstimateAsync(run, plan.Items.Count, cancellationToken);
            await run.AppendAsync(HarnessEvents.EstimateMade, Estimator.Made(estimate, "plan"), cancellationToken);
            var headroom = await HeadroomAsync(run, cancellationToken);
            if (headroom is { } room && estimate.Credits > room && Autonomy(run) == "auto")
            {
                await run.Sink.AppendAsync(
                [
                    new RunEvent(HarnessEvents.Message, new JsonObject { ["from"] = "runner", ["code"] = "estimate_over_budget", ["text"] = string.Create(CultureInfo.InvariantCulture, $"The plan is estimated at {estimate.Credits} credits, more than the {room} left, so building has not started. Raise the budget, then resume."), ["estimate"] = estimate.Credits, ["headroom"] = room }),
                    new RunEvent(RunEventTypes.RunPaused, new JsonObject { ["by"] = "runner", ["reason"] = "estimate_over_budget" }),
                ], cancellationToken);
                return WorkflowOutcome.Suspend("plan estimate over budget");
            }

            await run.Journal.RecordAsync("estimate.plan", new JsonObject { ["credits"] = estimate.Credits }, cancellationToken);
        }

        // Build, evaluate, repair: one feature per session.
        foreach (var item in plan.Items)
        {
            var built = await BuildItemAsync(run, plan, item, workspace, appId, recreated, cancellationToken);
            if (built is not null)
            {
                return built;
            }
        }

        // Security review: a finding blocks publishing.
        var review = await ReviewAsync(run, plan, workspace, cancellationToken);
        if (review is not null)
        {
            return review;
        }

        // Publish: built and started privately. Going public is the owner's act, in the console.
        var published = await run.Journal.OnceAsync("publish", () => PublishAsync(run, appId, cancellationToken), cancellationToken);
        var text = Json.Bool(published, "started") == true
            ? $"{Json.Str(placement, "name")} is built and running privately at {Json.Str(placement, "appPath")}. Only you can open it until you make it public."
            : $"{Json.Str(placement, "name")} is built and committed, but could not be started: {Json.Str(published, "detail")}";
        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "builder", ["text"] = text }, cancellationToken);
        return Json.Bool(published, "started") == true ? WorkflowOutcome.Success(text) : WorkflowOutcome.Failure(text);
    }

    private async Task<WorkflowOutcome?> BuildItemAsync(RunContext run, PlanContract plan, PlanItem item, IWorkspace workspace, Guid appId, bool recreated, CancellationToken cancellationToken)
    {
        if (Json.Bool(run.Journal.Get($"item:{item.Id}"), "passed") == true)
        {
            return null;
        }

        var tiers = run.Options.BuildTiers;
        JsonObject? lastEvaluation = null;
        for (var round = 0; round <= run.Options.MaxRepairRounds; round++)
        {
            var key = $"item:{item.Id}:round:{round}";
            if (run.Journal.Get(key) is { } recorded)
            {
                lastEvaluation = recorded;
                if (Json.Bool(recorded, "passed") == true)
                {
                    break;
                }

                continue;
            }

            // Escalate one tier per failed evaluation; repairs of the agent's own failure are not billed.
            var tier = tiers[Math.Min(round, tiers.Count - 1)];
            var repair = round > 0;
            var builder = run.Agents.Builder(run, $"builder-{item.Id}-{round}", tier, repair, workspace.Root);
            var task = repair
                ? RunnerResources.Prompt("repair", new Dictionary<string, string>
                {
                    ["round"] = round.ToString(CultureInfo.InvariantCulture),
                    ["rounds"] = run.Options.MaxRepairRounds.ToString(CultureInfo.InvariantCulture),
                    ["item"] = $"[{item.Id}] {item.Deliverable} — checked by: {item.Check}",
                    ["evidence"] = Json.Str(lastEvaluation, "evidence") ?? "",
                    ["faults"] = string.Join("\n", Json.Strings(lastEvaluation, "faults").Select(f => $"- {f}")),
                })
                : $"Build this one feature of the plan, completely, then commit it.\n\nThe feature: [{item.Id}] {item.Deliverable}\nIt will be checked by: {item.Check}\n\nThe whole plan, for context (build only this item now):\n{plan.Render()}"
                    + (recreated && round == 0 ? "\n\nThe workspace was recreated from the last commit; anything uncommitted from before was lost." : "");
            var result = await WorkflowSupport.RunAgentAsync(run, builder, workspace, task, cancellationToken);
            if (WorkflowOutcome.FromAgent(result) is { } stopped)
            {
                return stopped;
            }

            // A clean commit per session, made by code if the agent did not make it.
            if (result.State.Commits.Count == 0)
            {
                await workspace.CommitAsync($"{(repair ? "Repair" : "Build")} {item.Id}: {item.Deliverable}", builder.AuthorName, builder.AuthorEmail, cancellationToken);
            }

            var evaluation = await EvaluateAsync(run, item, round, tier, workspace, appId, cancellationToken);
            if (evaluation is null)
            {
                return WorkflowOutcome.Suspend("evaluation interrupted");
            }

            await run.AppendAsync(Json.Bool(evaluation, "passed") == true ? HarnessEvents.EvaluationPassed : HarnessEvents.EvaluationFailed, new JsonObject
            {
                ["item"] = item.Id,
                ["deliverable"] = item.Deliverable,
                ["round"] = round,
                ["tier"] = tier,
                ["evidence"] = OutputText.Truncate(Json.Str(evaluation, "evidence") ?? "", 4000),
                ["faults"] = evaluation["faults"]?.DeepClone(),
            }, cancellationToken);
            await run.Journal.RecordAsync(key, evaluation, cancellationToken);
            lastEvaluation = evaluation;
            if (Json.Bool(evaluation, "passed") == true)
            {
                break;
            }
        }

        if (Json.Bool(lastEvaluation, "passed") != true)
        {
            return WorkflowOutcome.Failure($"'{item.Deliverable}' still failed its check after {run.Options.MaxRepairRounds} repair rounds: {string.Join(" ", Json.Strings(lastEvaluation, "faults"))}");
        }

        await RecordProgressAsync(run, item, lastEvaluation!, workspace, cancellationToken);
        await run.Journal.RecordAsync($"item:{item.Id}", new JsonObject { ["passed"] = true }, cancellationToken);
        return null;
    }

    /// <summary>The preview, then a separate evaluator with its own context; a build that fails is a failed evaluation without one.</summary>
    private async Task<JsonObject?> EvaluateAsync(RunContext run, PlanItem item, int round, string tier, IWorkspace workspace, Guid appId, CancellationToken cancellationToken)
    {
        string? previewNote = null;
        ITool? probe = null;
        if (run.Dock is { } dock)
        {
            try
            {
                var image = await dock.BuildAsync(appId, null, cancellationToken);
                var token = await run.ControlPlane.MintAppTokenAsync(appId, cancellationToken);
                await dock.StartAsync(appId, new StartAppRequest(run.OrganisationId, image.Image, token, null, null), cancellationToken);
                probe = preview is null ? null : new CheckPreviewTool(preview, appId);
                previewNote = preview is null ? "The preview is running, but this Runner has no way to call it; judge by the build and tests." : null;
            }
            catch (WorkspaceException e) when (e.Code == DockProblemCodes.BuildFailed)
            {
                return new JsonObject { ["passed"] = false, ["evidence"] = "The app's image did not build.", ["faults"] = Json.Array([$"The build failed: {OutputText.Truncate(e.Message, 1500)}"]) };
            }
            catch (Exception e) when (e is WorkspaceException or Harness.Model.ServiceProblemException or HttpRequestException)
            {
                previewNote = $"The preview could not be started ({OutputText.Truncate(e.Message, 300)}); any check that needs it counts as failed.";
            }
        }

        var evaluator = run.Agents.Evaluator(run, $"evaluator-{item.Id}-{round}", item, workspace.Root, probe);
        var result = await WorkflowSupport.RunAgentAsync(run, evaluator, workspace,
            $"Evaluate the item now (round {round}, built on {tier}).{(previewNote is null ? "" : "\n\n" + previewNote)}", cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is not null)
        {
            return null;
        }

        var answer = WorkflowSupport.JsonAnswer(result.FinalText);
        if (answer is null || Json.Bool(answer, "passed") is null)
        {
            // An evaluator that gives no verdict has not passed anything.
            return new JsonObject { ["passed"] = false, ["evidence"] = OutputText.Truncate(result.FinalText ?? "", 2000), ["faults"] = Json.Array(["The evaluator gave no verdict; treat the item as unchecked and check it again."]) };
        }

        return answer;
    }

    private static async Task RecordProgressAsync(RunContext run, PlanItem item, JsonObject evaluation, IWorkspace workspace, CancellationToken cancellationToken)
    {
        var path = $"{workspace.Root}/{ProgressFile}";
        var existing = await workspace.ReadBytesAsync(path, cancellationToken);
        var text = existing is null ? "# Progress\n\nWhat is built and checked, feature by feature. Kept by the factory.\n\n" : Encoding.UTF8.GetString(existing);
        var evidence = (Json.Str(evaluation, "evidence") ?? "").Split('\n')[0];
        var line = $"- [x] **{item.Id}** — {item.Deliverable}. Checked: {OutputText.Truncate(evidence, 300)}\n";
        if (!text.Contains($"**{item.Id}**", StringComparison.Ordinal))
        {
            await workspace.WriteBytesAsync(path, Encoding.UTF8.GetBytes(text.TrimEnd('\n') + "\n" + line), cancellationToken);
            await workspace.CommitAsync($"Record progress: {item.Id} is built and checked", "Endgame factory", $"factory@{run.Options.AuthorDomain}", cancellationToken);
        }
    }

    private static async Task<WorkflowOutcome?> ReviewAsync(RunContext run, PlanContract plan, IWorkspace workspace, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var key = $"security:{attempt}";
            var findings = run.Journal.Get(key);
            if (findings is null)
            {
                var reviewer = await WorkflowSupport.RunAgentAsync(run, run.Agents.SecurityReviewer(run, workspace.Root) with { Id = $"security-reviewer-{attempt}" }, workspace,
                    "Review the app now against your checklist, then reply with the JSON object.", cancellationToken);
                if (WorkflowOutcome.FromAgent(reviewer) is { } stopped)
                {
                    return stopped;
                }

                findings = WorkflowSupport.JsonAnswer(reviewer.FinalText)
                    ?? new JsonObject { ["passed"] = false, ["findings"] = new JsonArray(new JsonObject { ["problem"] = "The review gave no report, so the app is not cleared." }) };
                await run.Journal.RecordAsync(key, findings, cancellationToken);
                await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "security-reviewer", ["kind"] = "security.review", ["passed"] = Passed(findings), ["findings"] = findings["findings"]?.DeepClone() }, cancellationToken);
            }

            if (Passed(findings))
            {
                return null;
            }

            if (attempt == 1)
            {
                break;
            }

            // One repair of the findings, on the agent's own work, not billed.
            var builder = run.Agents.Builder(run, "builder-security-repair", run.Options.BuildTiers[Math.Min(1, run.Options.BuildTiers.Count - 1)], repair: true, workspace.Root);
            var fix = await WorkflowSupport.RunAgentAsync(run, builder, workspace,
                $"The security review found problems that block publishing. Fix each one, verify with make lint and make test, and commit.\n\n{(findings["findings"] ?? new JsonArray()).ToJsonString(Json.Compact)}\n\nThe plan, for context:\n{plan.Render()}", cancellationToken);
            if (WorkflowOutcome.FromAgent(fix) is { } stopped2)
            {
                return stopped2;
            }

            if (fix.State.Commits.Count == 0)
            {
                await workspace.CommitAsync("Fix the security review's findings", builder.AuthorName, builder.AuthorEmail, cancellationToken);
            }
        }

        var list = (run.Journal.Get("security:1")?["findings"] as JsonArray ?? []).OfType<JsonObject>().Select(f => $"{Json.Str(f, "file")}: {Json.Str(f, "problem")}");
        return WorkflowOutcome.Failure($"Publishing is blocked by the security review: {string.Join("; ", list)}");
    }

    private static bool Passed(JsonObject findings) =>
        Json.Bool(findings, "passed") == true && (findings["findings"] as JsonArray ?? []).Count == 0;

    private static async Task<JsonObject> PublishAsync(RunContext run, Guid appId, CancellationToken cancellationToken)
    {
        if (run.Dock is not { } dock)
        {
            return new JsonObject { ["started"] = false, ["detail"] = "this Runner has no connection to Dock" };
        }

        try
        {
            var image = await dock.BuildAsync(appId, null, cancellationToken);
            var token = await run.ControlPlane.MintAppTokenAsync(appId, cancellationToken);
            var status = await dock.StartAsync(appId, new StartAppRequest(run.OrganisationId, image.Image, token, null, null), cancellationToken);
            return new JsonObject { ["started"] = status.State == AppRuntimeState.Running, ["image"] = image.Image, ["commit"] = image.Commit, ["state"] = status.State, ["visibility"] = "private" };
        }
        catch (Exception e) when (e is WorkspaceException or Harness.Model.ServiceProblemException or HttpRequestException)
        {
            return new JsonObject { ["started"] = false, ["detail"] = OutputText.Truncate(e.Message, 500) };
        }
    }

    /// <summary>Placement: from research's verdict when it proposed one, otherwise from the idea's own words.</summary>
    private static async Task<JsonObject> PlaceAsync(RunContext run, string idea, CancellationToken cancellationToken)
    {
        JsonObject? proposal = null;
        if (run.Run.ParentRunId is { } research)
        {
            var events = await run.ControlPlane.ReadEventsAsync(research, 0, 500, cancellationToken);
            proposal = events.LastOrDefault(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "kind") == MessageKinds.Workflow && Json.Str(e.Payload, "step") == "verdict")?.Payload["data"]?["placement"] as JsonObject;
        }

        var title = idea.Split('\n')[0];
        var name = Json.Str(proposal, "name") is { Length: > 0 } n ? n : OutputText.Truncate(title, 60).Trim();
        var levels = (run.Context["levels"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var organisation = Json.Str(levels.First(), "path")!;
        var division = levels.FirstOrDefault(l => Json.Str(l, "level") == "division") is { } d
            ? Json.Str(d, "path")!
            : (await run.ControlPlane.EnsureNodeAsync(organisation, "division", Json.Str(proposal, "division") ?? "Labs", WorkflowSupport.Slug(Json.Str(proposal, "division"), "labs"), cancellationToken)).Path;
        var projectSlug = WorkflowSupport.Slug(Json.Str(proposal, "project") ?? name, "project");
        var project = await run.ControlPlane.EnsureNodeAsync(division, "project", name, projectSlug, cancellationToken);
        var app = await run.ControlPlane.EnsureNodeAsync(project.Path, "app", name, WorkflowSupport.Slug(Json.Str(proposal, "app") ?? "web", "web"), cancellationToken);
        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "builder", ["text"] = $"{name} will live in {project.Path}." }, cancellationToken);
        return new JsonObject { ["name"] = name, ["division"] = division, ["projectPath"] = project.Path, ["appPath"] = app.Path, ["appId"] = app.Id.ToString() };
    }

    private static async Task<decimal?> HeadroomAsync(RunContext run, CancellationToken cancellationToken)
    {
        try
        {
            return await run.ControlPlane.HeadroomAsync(run.Run.Scope, cancellationToken);
        }
        catch (Harness.Model.ServiceProblemException)
        {
            return null;
        }
    }

    private static string Autonomy(RunContext run) => run.Setting("autonomy") is JsonValue v && v.TryGetValue<string>(out var s) ? s : "auto";

    private static bool Checkpoint(RunContext run, string stage) =>
        Autonomy(run) == "checkpoints" && run.Setting($"checkpoint.{stage}") is JsonValue v && v.TryGetValue<bool>(out var on) && on;
}
