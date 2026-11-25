using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Planning;
using Endgame.Harness.Platform;
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
public sealed class BuildWorkflow(Estimator estimator, IPreviewProbe? preview = null, IAppCaller? caller = null) : IWorkflow
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
        var crew = await StaffAsync(run, placement, cancellationToken);
        var (workspace, recreated) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), cancellationToken);
        var root = workspace.Root;

        // The plan: a contract, proposed in plan mode, accepted only once it is valid.
        var plan = PlanContract.FromJson(run.Journal.Get("plan"));
        if (plan is null)
        {
            var planner = await WorkflowSupport.RunAgentAsync(run, AgentFactory.As(run, run.Agents.Planner(run, root, idea), crew.Engineer, crew.EngineerMemory, canRemember: false), workspace,
                $"Plan the app described below. It starts from the app kit's template (the Notes example), which it replaces.\n\nThe idea, word for word:\n{idea}\n\nConstraints: {Json.Str(owner, "constraints")}", cancellationToken);
            if (WorkflowOutcome.FromAgent(planner) is { } stopped)
            {
                return stopped;
            }

            plan = planner.State.Plan;
            if (plan is null || plan.Faults(idea).Count > 0)
            {
                return WorkflowOutcome.Failure("Planning produced no valid contract, so nothing was built." + (plan is null ? "" : " " + string.Join(" ", plan.Faults(idea))))
                    with
                { ForOwner = "Planning did not produce a plan that covers everything the idea asks for, so nothing was built. Starting the build again plans it afresh." };
            }

            if (Checkpoint(run, "plan"))
            {
                var approved = await new Harness.Platform.ControlPlaneApprovals(run.ControlPlane, run.Run.Id).RequestAsync("Accept this plan?", Sentences.Flatten(plan.ForOwner(), 2000), cancellationToken);
                if (!approved)
                {
                    return WorkflowOutcome.Failure("The owner rejected the plan.");
                }
            }

            var accepted = plan.ToEvent();
            accepted["by"] = Checkpoint(run, "plan") ? "owner" : "auto-mode";
            await run.AppendAsync(HarnessEvents.PlanAccepted, accepted, cancellationToken);
            await run.Journal.RecordAsync("plan", plan.ToJson(), cancellationToken);
            await Workforce.SayAsync(run, "builder", "The plan", PlanAnnouncement(plan), cancellationToken, "planned");
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
                    new RunEvent(HarnessEvents.Message, new JsonObject { ["from"] = "runner", ["title"] = "Waiting for budget", ["code"] = "estimate_over_budget", ["text"] = string.Create(CultureInfo.InvariantCulture, $"The plan is estimated at {estimate.Credits} credits, more than the {room} left, so building has not started. Raise the budget, then resume."), ["estimate"] = estimate.Credits, ["headroom"] = room }),
                    new RunEvent(RunEventTypes.RunPaused, new JsonObject { ["by"] = "runner", ["reason"] = "estimate_over_budget" }),
                ], cancellationToken);
                return WorkflowOutcome.Suspend("plan estimate over budget");
            }

            await run.Journal.RecordAsync("estimate.plan", new JsonObject { ["credits"] = estimate.Credits }, cancellationToken);
        }

        // Build, evaluate, repair: one feature per session.
        foreach (var item in plan.Items)
        {
            var built = await BuildItemAsync(run, plan, item, workspace, appId, recreated, crew, cancellationToken);
            if (built is not null)
            {
                return built;
            }
        }

        // Security review: a finding blocks publishing.
        var review = await ReviewAsync(run, plan, workspace, crew, cancellationToken);
        if (review is not null)
        {
            return review;
        }

        // Publish: built and started privately. Going public is the owner's act, in the console.
        var published = await run.Journal.OnceAsync("publish", () => PublishAsync(run, appId, cancellationToken), cancellationToken);
        if (Json.Bool(published, "started") != true)
        {
            return WorkflowOutcome.Failure($"{Json.Str(placement, "name")} is built and its work is saved, but it could not be started: {Json.Str(published, "detail")}");
        }

        var text = $"{Json.Str(placement, "name")} is built and running privately. Only you and the people you choose can open it until you make it public.";
        await Workforce.SayAsync(run, "builder", "Running privately", text, cancellationToken, "published");
        await RecurringJobsAsync(run, placement, crew, cancellationToken);
        return WorkflowOutcome.Success($"{Json.Str(placement, "name")} is built and running privately.") with { Announced = true };
    }

    /// <summary>The people this build needs, hired from the ontology as the project enters its stages, with what each remembers.</summary>
    private static async Task<Crew> StaffAsync(RunContext run, JsonObject placement, CancellationToken cancellationToken)
    {
        var project = Json.Str(placement, "projectPath")!;
        var division = Json.Str(placement, "division")!;
        var name = Json.Str(placement, "name")!;
        var credits = run.Options.MonthlyCredits;
        Guid? lead = null;
        if (Json.Bool(placement, "divisionCreated") == true)
        {
            lead = await Workforce.HireAsync(run, new Need("division", $"division:{division}", division, "Sol", "Division lead",
                "Lead this division: keep its projects coherent and its employees working on what matters, within budget.",
                run.Options.PlanTaskType, ["read_file", "list_files", "search", "notes", "remember"], credits.GetValueOrDefault("lead", 100m),
                "A new division was created for this work, and every division has someone answerable for it."), cancellationToken);
        }

        var engineer = await Workforce.HireAsync(run, new Need("stage", $"stage:build:{project}", project, "Theo", "Software engineer",
            $"Plan and build {name} feature by feature on the app kit, each one verified and committed; repair what the evaluator sends back.",
            run.Options.BuildTiers[0], Workforce.BuilderTools, credits.GetValueOrDefault("engineer", 1500m),
            $"{name} is entering its build, and somebody must build and maintain it.", lead), cancellationToken);
        var qa = await Workforce.HireAsync(run, new Need("stage", $"stage:evaluate:{project}", project, "Nadia", "QA engineer",
            $"Check every feature of {name} against its contract, independently of the person who built it: tests, the running app, the details.",
            run.Options.EvaluateTaskType, Workforce.ReaderTools, credits.GetValueOrDefault("qa", 600m),
            $"{name} is entering evaluation, and the person who checks the work must not be the one who did it.", lead), cancellationToken);
        var reviewer = await Workforce.StandingReviewerAsync(run, cancellationToken);
        return new Crew(
            engineer, await Workforce.MemoryBlockAsync(run, engineer, project, cancellationToken),
            qa, await Workforce.MemoryBlockAsync(run, qa, project, cancellationToken),
            reviewer, await Workforce.MemoryBlockAsync(run, reviewer, project, cancellationToken),
            project);
    }

    /// <summary>A recurring job (a schedule the app now declares) is a reason to have someone watch it: raised once, from the ontology.</summary>
    private static async Task RecurringJobsAsync(RunContext run, JsonObject placement, Crew crew, CancellationToken cancellationToken)
    {
        var appPath = Json.Str(placement, "appPath")!;
        JsonObject graph;
        try
        {
            graph = await run.ControlPlane.OntologyAsync(appPath, "data-flow", cancellationToken);
        }
        catch (Harness.Model.ServiceProblemException)
        {
            return;
        }

        var schedules = (graph["nodes"] as JsonArray ?? []).OfType<JsonObject>().Where(n => Json.Str(n, "type") == "schedule").Select(n => Json.Str(n, "name")).OfType<string>().ToList();
        if (schedules.Count == 0)
        {
            return;
        }

        await Workforce.HireAsync(run, new Need("recurring", $"recurring:{appPath}", appPath, "Ravi", "Operations engineer",
            $"Watch {Json.Str(placement, "name")}'s recurring jobs ({string.Join(", ", schedules)}): that they run, what they cost, and what fails.",
            run.Options.SummaryTaskType, ["read_file", "list_files", "search", "notes", "remember"], run.Options.MonthlyCredits.GetValueOrDefault("operations", 100m),
            $"The app now runs recurring jobs ({string.Join(", ", schedules)}), and recurring work needs someone to watch it.", crew.Engineer), cancellationToken);
    }

    /// <summary>Who does what in this build, and what each of them remembers about it.</summary>
    private sealed record Crew(Guid? Engineer, string EngineerMemory, Guid? Qa, string QaMemory, Guid? Reviewer, string ReviewerMemory, string ProjectPath);

    private async Task<WorkflowOutcome?> BuildItemAsync(RunContext run, PlanContract plan, PlanItem item, IWorkspace workspace, Guid appId, bool recreated, Crew crew, CancellationToken cancellationToken)
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
            var builder = AgentFactory.As(run, run.Agents.Builder(run, $"builder-{item.Id}-{round}", tier, repair, workspace.Root), crew.Engineer, crew.EngineerMemory, canRemember: true, crew.ProjectPath);
            var task = repair
                ? RunnerResources.Prompt("repair", new Dictionary<string, string>
                {
                    ["round"] = round.ToString(CultureInfo.InvariantCulture),
                    ["rounds"] = run.Options.MaxRepairRounds.ToString(CultureInfo.InvariantCulture),
                    ["item"] = $"[{item.Id}] {item.Deliverable} — checked by: {item.Check}\n{Requirements(plan, item)}",
                    ["evidence"] = Json.Str(lastEvaluation, "evidence") ?? "",
                    ["faults"] = string.Join("\n", Json.Strings(lastEvaluation, "faults").Select(f => $"- {f}")),
                })
                : $"Build this one feature of the plan, completely, then commit it.\n\nThe feature: [{item.Id}] {item.Deliverable}\nIt will be checked by: {item.Check}\n{Requirements(plan, item)}\nThe whole plan, for context (build only this item now):\n{plan.Render()}"
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

            var evaluation = await EvaluateAsync(run, plan, item, round, tier, workspace, appId, crew, cancellationToken);
            if (evaluation is null)
            {
                return WorkflowOutcome.Suspend("evaluation interrupted");
            }

            var passedNow = Json.Bool(evaluation, "passed") == true;
            var shown = (evaluation["requirements"] as JsonArray ?? []).OfType<JsonObject>().ToList();
            await run.AppendAsync(passedNow ? HarnessEvents.EvaluationPassed : HarnessEvents.EvaluationFailed, new JsonObject
            {
                ["item"] = item.Id,
                ["text"] = item.Text,
                ["summary"] = EvaluationSummary(item, passedNow, shown, round),
                ["round"] = round,
                ["tier"] = tier,
                ["requirements"] = new JsonArray(shown.Select(r => (JsonNode)r.DeepClone()).ToArray()),
                ["evidence"] = OutputText.Truncate(Json.Str(evaluation, "evidence") ?? "", 4000),
                ["faults"] = evaluation["faults"]?.DeepClone(),
            }, cancellationToken);
            await run.Journal.RecordAsync(key, evaluation, cancellationToken);
            lastEvaluation = evaluation;
            if (Json.Bool(evaluation, "passed") == true)
            {
                break;
            }

            // Work sent back is a lesson for the one who did it, kept for the next task.
            if (Json.Strings(evaluation, "faults").FirstOrDefault() is { } fault)
            {
                await Workforce.RememberAsync(run, crew.Engineer, [new MemoryNote(OutputText.Truncate($"Sent back: {item.Deliverable}", 120), OutputText.Truncate(fault, 1000), "lesson", crew.ProjectPath)], cancellationToken);
            }
        }

        if (Json.Bool(lastEvaluation, "passed") != true)
        {
            return WorkflowOutcome.Failure($"'{item.Deliverable}' still failed its check after {run.Options.MaxRepairRounds} repair rounds: {string.Join(" ", Json.Strings(lastEvaluation, "faults"))}")
                with
            { ForOwner = $"\"{item.Text.TrimEnd('.')}\" still did not work after {run.Options.MaxRepairRounds} rounds of repair, each on a stronger model, so the app was not published. Its work so far is saved; the repairs were not charged." };
        }

        await RecordProgressAsync(run, item, lastEvaluation!, workspace, cancellationToken);
        await run.Journal.RecordAsync($"item:{item.Id}", new JsonObject { ["passed"] = true }, cancellationToken);
        return null;
    }

    /// <summary>The preview, then a separate evaluator with its own context; a build that fails is a failed evaluation without one.</summary>
    private async Task<JsonObject?> EvaluateAsync(RunContext run, PlanContract plan, PlanItem item, int round, string tier, IWorkspace workspace, Guid appId, Crew crew, CancellationToken cancellationToken)
    {
        string? previewNote = null;
        ITool? probe = null;
        ITool? callApp = null;
        if (run.Dock is { } dock)
        {
            try
            {
                var image = await dock.BuildAsync(appId, null, cancellationToken);
                var token = await run.ControlPlane.MintAppTokenAsync(appId, cancellationToken);
                await dock.StartAsync(appId, new StartAppRequest(run.OrganisationId, image.Image, token, null, null), cancellationToken);
                probe = preview is null ? null : new CheckPreviewTool(preview, appId);
                callApp = caller is null ? null : new CallAppTool(caller, appId);
                previewNote = caller is null ? "The app is running, but this Runner has no way to call it signed in; no requirement can be shown working, so the item fails." : null;
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

        var evaluatorId = $"evaluator-{item.Id}-{round}";
        var evaluator = AgentFactory.As(run, run.Agents.Evaluator(run, evaluatorId, item, plan.RequirementsOf(item), workspace.Root, probe, callApp), crew.Qa, crew.QaMemory, canRemember: true, crew.ProjectPath);
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
            answer = new JsonObject { ["passed"] = false, ["evidence"] = OutputText.Truncate(result.FinalText ?? "", 2000), ["faults"] = Json.Array(["The evaluator gave no verdict; treat the item as unchecked and check it again."]) };
        }

        // Code's gate: every requirement the item delivers is shown working in the running app, signed in, or the item fails.
        var calls = CallAppTool.CallsIn(await run.LogReader.ReadAllAsync(cancellationToken), evaluatorId);
        return EvaluationGate.Apply(plan, item, answer, calls);
    }

    private static async Task RecordProgressAsync(RunContext run, PlanItem item, JsonObject evaluation, IWorkspace workspace, CancellationToken cancellationToken)
    {
        var path = $"{workspace.Root}/{ProgressFile}";
        var existing = await workspace.ReadBytesAsync(path, cancellationToken);
        var text = existing is null ? "# Progress\n\nWhat is built and checked, feature by feature. Kept by the factory.\n\n" : Encoding.UTF8.GetString(existing);
        var evidence = (Json.Str(evaluation, "evidence") ?? "").Split('\n')[0];
        var line = $"- [x] **{item.Id}** — {item.Text.TrimEnd('.')}. Checked: {OutputText.Truncate(evidence, 300)}\n";
        if (!text.Contains($"**{item.Id}**", StringComparison.Ordinal))
        {
            await workspace.WriteBytesAsync(path, Encoding.UTF8.GetBytes(text.TrimEnd('\n') + "\n" + line), cancellationToken);
            await workspace.CommitAsync($"Record progress: {item.Id} is built and checked", "Endgame factory", $"factory@{run.Options.AuthorDomain}", cancellationToken);
        }
    }

    private static async Task<WorkflowOutcome?> ReviewAsync(RunContext run, PlanContract plan, IWorkspace workspace, Crew crew, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var key = $"security:{attempt}";
            var findings = run.Journal.Get(key);
            if (findings is null)
            {
                // The organisation's standing security reviewer does it, and the work is attributed to them.
                var reviewer = await WorkflowSupport.RunAgentAsync(run, AgentFactory.As(run, run.Agents.SecurityReviewer(run, workspace.Root) with { Id = $"security-reviewer-{attempt}" }, crew.Reviewer, crew.ReviewerMemory, canRemember: true, crew.ProjectPath), workspace,
                    "Review the app now against your checklist, then reply with the JSON object.", cancellationToken);
                if (WorkflowOutcome.FromAgent(reviewer) is { } stopped)
                {
                    return stopped;
                }

                findings = WorkflowSupport.JsonAnswer(reviewer.FinalText)
                    ?? new JsonObject { ["passed"] = false, ["findings"] = new JsonArray(new JsonObject { ["problem"] = "The review gave no report, so the app is not cleared." }) };
                await run.Journal.RecordAsync(key, findings, cancellationToken);
                await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["from"] = "security-reviewer", ["kind"] = "security.review", ["passed"] = Passed(findings), ["findings"] = findings["findings"]?.DeepClone() }, cancellationToken);
                var count = (findings["findings"] as JsonArray ?? []).Count;
                await Workforce.SayAsync(run, "security-reviewer", Passed(findings) ? "Security review passed" : "Security review found problems",
                    Passed(findings)
                        ? "The security review checked secrets, sign-in, data, model calls and outbound calls, and found nothing that blocks publishing."
                        : attempt == 0
                            ? $"The security review found {count} problem{(count == 1 ? "" : "s")} that would block publishing; they are being fixed now, at no charge."
                            : $"The security review still found {count} problem{(count == 1 ? "" : "s")} after the fix, so the app is not published.",
                    cancellationToken, attempt == 0 ? "security.reviewed" : "security.rechecked");
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
            var builder = AgentFactory.As(run, run.Agents.Builder(run, "builder-security-repair", run.Options.BuildTiers[Math.Min(1, run.Options.BuildTiers.Count - 1)], repair: true, workspace.Root), crew.Engineer, crew.EngineerMemory, canRemember: true, crew.ProjectPath);
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
        return WorkflowOutcome.Failure($"Publishing is blocked by the security review: {string.Join("; ", list)}")
            with
        { ForOwner = "The security review still found problems after one repair, so the app was not published. Its work is saved, and technical mode lists each finding." };
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
        string division;
        var divisionCreated = false;
        if (levels.FirstOrDefault(l => Json.Str(l, "level") == "division") is { } d)
        {
            division = Json.Str(d, "path")!;
        }
        else
        {
            var slug = WorkflowSupport.Slug(Json.Str(proposal, "division"), "labs");
            var made = await run.ControlPlane.EnsureNodeAsync(organisation, "division", DivisionName(slug), slug, cancellationToken);
            division = made.Path;
            divisionCreated = made.Created;
        }

        var projectSlug = WorkflowSupport.Slug(Json.Str(proposal, "project") ?? name, "project");
        var project = await run.ControlPlane.EnsureNodeAsync(division, "project", name, projectSlug, cancellationToken);
        var app = await run.ControlPlane.EnsureNodeAsync(project.Path, "app", name, WorkflowSupport.Slug(Json.Str(proposal, "app") ?? "web", "web"), cancellationToken);
        await Workforce.SayAsync(run, "builder", "Placed", divisionCreated
            ? $"{name} will live in a new division, {DivisionName(division.Split('/')[^1])}, as the project {project.Name}."
            : $"{name} will live in {DivisionName(division.Split('/')[^1])}, as the project {project.Name}.", cancellationToken, "placed");
        return new JsonObject { ["name"] = name, ["division"] = division, ["divisionCreated"] = divisionCreated, ["projectPath"] = project.Path, ["appPath"] = app.Path, ["appId"] = app.Id.ToString() };
    }

    /// <summary>The plan as the owner hears it: what will be built, and anything deliberately left out with the reason.</summary>
    private static string PlanAnnouncement(PlanContract plan)
    {
        var count = plan.Items.Count;
        var built = $"{count} part{(count == 1 ? "" : "s")}, each built, then checked in the running app against what you asked for";
        var left = plan.LeftOut.Count == 0
            ? $"All {plan.Requirements.Count} things the idea asks for are covered."
            : "Left out: " + string.Join(" ", plan.LeftOut.Select(l => $"{plan.Requirements.FirstOrDefault(r => r.Id == l.Requirement)?.Text.TrimEnd('.') ?? l.Requirement}, because {l.Reason.TrimEnd('.')}."));
        return Sentences.Join([plan.Summary, built, left]);
    }

    /// <summary>The owner's requirements an item delivers, for the builder's task.</summary>
    private static string Requirements(PlanContract plan, PlanItem item) =>
        plan.RequirementsOf(item) is { Count: > 0 } r
            ? "It delivers these requirements of the owner's idea, in their words — the evaluator will check each one in the running app, signed in:\n" + string.Join("\n", r.Select(x => $"- {x.Id}: {x.Text}")) + "\n"
            : "";

    /// <summary>One plain sentence for the owner about an evaluation; the evidence and faults are technical detail.</summary>
    private static string EvaluationSummary(PlanItem item, bool passed, IReadOnlyList<JsonObject> requirements, int round)
    {
        var what = item.Text.TrimEnd('.');
        var shown = requirements.Count(r => Json.Bool(r, "met") == true);
        var count = requirements.Count == 0 ? "" : $" ({shown} of {requirements.Count} of your requirements shown working in the running app)";
        return passed
            ? $"Checked and working: {what}{count}."
            : $"Sent back for repair{(round > 0 ? " again" : "")}, at no charge: {what}{count}.";
    }

    private static string DivisionName(string slug)
    {
        var words = slug.Split('-', StringSplitOptions.RemoveEmptyEntries);
        return string.Join(' ', words.Select(w => char.ToUpperInvariant(w[0]) + w[1..]));
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
