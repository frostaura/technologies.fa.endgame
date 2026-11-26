using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Domain.Credits;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Permissions;
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
public sealed partial class BuildWorkflow(Estimator estimator, IPreviewProbe? preview = null, IAppCaller? caller = null) : IWorkflow
{
    public const string ProgressFile = "PROGRESS.md";

    public string Kind => RunKinds.Build;

    /// <summary>
    /// How the earlier parts are shown working again. A live change failed this check four times although the app worked:
    /// for parts on screen the evaluator cited the screen's code and tests, which code's gate does not count.
    /// </summary>
    public const string KeepCheck = "Each earlier part shown working again in the running app, signed in as a test member: call_app every part, and cite the exact calls made (METHOD path, with the real ids). A part that is on screen is shown by the data it shows or changes — for example the list it reads after the action its button takes — never by its code or its tests alone.";

    /// <summary>The code-owned part of a change's plan: everything the app did before, checked again in the running app.</summary>
    public const string KeepItem = "keep";

    public async Task<WorkflowOutcome> RunAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        var owner = run.OwnerMessage();
        var idea = Json.Str(owner, "text") ?? run.Run.Title;
        await CarryOverAsync(run, cancellationToken);

        // What is built: the idea, plus every change agreed after research (the owner's own, or research's that the owner accepted).
        var request = WithAgreedChanges(idea, Json.Strings(owner, "changes"));
        var placement = await run.Journal.OnceAsync("placement", () => PlaceAsync(run, idea, cancellationToken), cancellationToken);
        var task = $"Plan the app described below. It starts from the app kit's template (the Notes example), which it replaces.\n\nThe idea, word for word:\n{request}\n\nConstraints: {Json.Str(owner, "constraints")}";
        return await PipelineAsync(run, new Job(request, task, placement, Change: false), cancellationToken);
    }

    /// <summary>
    /// A change to an app that is already built (CHG-01): research is not repeated — it is the same product — but the request is
    /// screened against the red lines first; then the build's own stages: a plan whose requirements quote the request, each part
    /// built and checked by the separate evaluator on a preview, everything that worked before checked again, the security
    /// review, and the new version published and the app restarted.
    /// </summary>
    public async Task<WorkflowOutcome> ChangeAsync(RunContext run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        if (run.LevelId("app") is null)
        {
            return WorkflowOutcome.Failure("A change is made to an app, and this run's scope names none.");
        }

        var request = Json.Str(run.OwnerMessage(), "text") ?? run.Run.Title;
        await CarryOverAsync(run, cancellationToken);
        var screen = run.Journal.Get("screen");
        if (screen is null)
        {
            var screener = await WorkflowSupport.RunAgentAsync(run, run.Agents.Answerer(run, "red-line-screen", RunnerResources.Prompt("change-screen", new Dictionary<string, string> { ["request"] = request })) with
            {
                TaskType = run.Options.SummaryTaskType,
                // Room for a reasoning model to think and still answer (R2-6).
                Limits = new AgentLimits { MaxSteps = 2, MaxOutputTokens = 4000, MaxSearchesPerCall = 0 },
            }, NoWorkspace.Instance, "Screen the change now and reply with the JSON object.", cancellationToken);
            if (WorkflowOutcome.FromAgent(screener) is { } stopped)
            {
                return stopped;
            }

            if (screener.CutOff)
            {
                return WorkflowOutcome.Failure("The red-line screen's answer was too long to finish, so nothing was changed.")
                    with
                { ForOwner = "The check against FrostAura's red lines gave an answer too long to finish, so nothing was changed. “Try again” checks it again." };
            }

            // An unreadable screen has not cleared anything: the change is not made on a guess.
            if (WorkflowSupport.JsonAnswer(screener.FinalText) is not { } answer || Json.Bool(answer, "breached") is not { } breached)
            {
                return WorkflowOutcome.Failure("The red-line screen gave no answer in the agreed form, so nothing was changed.")
                    with
                { ForOwner = "The change could not be checked against FrostAura's red lines, so nothing was changed. “Try again” checks it again." };
            }

            screen = await run.Journal.RecordAsync("screen", new JsonObject { ["breached"] = breached, ["line"] = Json.Str(answer, "line"), ["reasoning"] = OutputText.Truncate(Json.Str(answer, "reasoning") ?? "", 1000) }, cancellationToken);
        }

        if (Json.Bool(screen, "breached") == true)
        {
            var line = Json.Str(screen, "line") ?? "a red line";
            return WorkflowOutcome.Failure($"The change crosses a red line ({line}); nothing was changed.")
                with
            { ForOwner = $"This change crosses a red line ({line}). FrostAura never builds it, and no one can overrule that, so nothing was changed." };
        }

        var placement = await run.Journal.OnceAsync("placement", () => Task.FromResult(ExistingPlacement(run)), cancellationToken);
        var task = $"Plan a change to {Json.Str(placement, "name")}, an app that is already built and running. PROGRESS.md lists what it does now, part by part. Change only what the request asks for, and keep everything it does now working; a change is usually one to three items.\n\nThe change, word for word:\n{request}";
        return await PipelineAsync(run, new Job(request, task, placement, Change: true), cancellationToken);
    }

    /// <summary>What one pipeline run is for: the words the plan must be faithful to, the planner's task, where the app lives, and whether it already existed.</summary>
    private sealed record Job(string Request, string PlannerTask, JsonObject Placement, bool Change);

    private async Task<WorkflowOutcome> PipelineAsync(RunContext run, Job job, CancellationToken cancellationToken)
    {
        var placement = job.Placement;
        var appId = Guid.Parse(Json.Str(placement, "appId")!);
        var crew = await StaffAsync(run, placement, cancellationToken);
        var (workspace, recreated) = await run.Workspaces.EnsureAsync(run.Run.Id, appId, run.LeaseExpiry(), run.StartFrom(), cancellationToken);
        var root = workspace.Root;

        // The plan: a contract, proposed in plan mode, accepted only once it is valid.
        var plan = PlanContract.FromJson(run.Journal.Get("plan"));
        if (plan is null)
        {
            var planner = await WorkflowSupport.RunAgentAsync(run, AgentFactory.As(run, run.Agents.Planner(run, root, job.Request), crew.Engineer, crew.EngineerMemory, canRemember: false), workspace, job.PlannerTask, cancellationToken);
            if (WorkflowOutcome.FromAgent(planner) is { } stopped)
            {
                return stopped;
            }

            plan = planner.State.Plan;
            if (plan is null || plan.Faults(job.Request).Count > 0)
            {
                return WorkflowOutcome.Failure("Planning produced no valid contract, so nothing was built." + (plan is null ? "" : " " + string.Join(" ", plan.Faults(job.Request))))
                    with
                { ForOwner = $"Planning did not produce a plan that covers everything {(job.Change ? "the change" : "the idea")} asks for, so nothing was {(job.Change ? "changed" : "built")}. “Try again” plans it afresh." };
            }

            if (job.Change)
            {
                plan = WithKeep(plan, await run.Journal.OnceAsync("earlier", () => EarlierWorkAsync(workspace, cancellationToken), cancellationToken));
            }

            if (Checkpoint(run, "plan"))
            {
                var answer = await new Harness.Platform.ControlPlaneApprovals(run.ControlPlane, run.Run.Id).AskAsync(job.Change ? "Accept this plan for the change?" : "Accept this plan?", Sentences.Flatten(plan.ForOwner(), 2000), ApprovalConsequence.Stops, cancellationToken);
                if (!answer.Approved)
                {
                    var note = string.IsNullOrWhiteSpace(answer.Note) ? "" : $" Your note: \"{OutputText.Truncate(answer.Note.Trim(), 300)}\"";
                    return WorkflowOutcome.Failure("The owner rejected the plan." + note)
                        with
                    { ForOwner = $"You declined the plan, so nothing was {(job.Change ? "changed" : "built")}.{note} “Try again” plans it afresh." };
                }
            }

            var accepted = plan.ToEvent();
            accepted["by"] = Checkpoint(run, "plan") ? "owner" : "auto-mode";
            await run.AppendAsync(HarnessEvents.PlanAccepted, accepted, cancellationToken);
            await run.Journal.RecordAsync("plan", plan.ToJson(), cancellationToken);
            await Workforce.SayAsync(run, "builder", "The plan", PlanAnnouncement(plan), cancellationToken, "planned");
        }

        // The estimate, refined by the plan's size: in every autonomy mode a build that would break the budget does not begin.
        if (!run.Journal.Done("estimate.plan"))
        {
            var estimate = await estimator.EstimateAsync(run, plan, cancellationToken);
            await run.AppendAsync(HarnessEvents.EstimateMade, Estimator.Made(estimate, "plan"), cancellationToken);
            var headroom = await HeadroomAsync(run, cancellationToken);
            if (headroom is { } room && estimate.Credits > room)
            {
                await run.Sink.AppendAsync(
                [
                    new RunEvent(HarnessEvents.Message, new JsonObject { ["from"] = "runner", ["title"] = "Waiting for budget", ["code"] = "estimate_over_budget", ["text"] = string.Create(CultureInfo.InvariantCulture, $"The plan is estimated at {CreditText.Format(estimate.Credits)} credits, more than the {CreditText.Format(room)} left, so building has not started. Raise the budget, then resume."), ["estimate"] = estimate.Credits, ["headroom"] = room }),
                    new RunEvent(RunEventTypes.RunPaused, new JsonObject { ["by"] = "runner", ["reason"] = "estimate_over_budget" }),
                ], cancellationToken);
                return WorkflowOutcome.Suspend("plan estimate over budget");
            }

            await run.Journal.RecordAsync("estimate.plan", new JsonObject { ["credits"] = estimate.Credits }, cancellationToken);
        }

        // Build, evaluate, repair: one feature per session; a change's last part checks that what worked before still works.
        foreach (var item in plan.Items)
        {
            var built = await BuildItemAsync(run, plan, item, workspace, appId, recreated, crew, job.Change, cancellationToken);
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

        // Publish: built and started. Going public is the owner's act, in the console; a change keeps who may open the app as it was.
        var published = await run.Journal.OnceAsync("publish", () => PublishAsync(run, appId, cancellationToken), cancellationToken);
        var name = Json.Str(placement, "name");
        if (Json.Bool(published, "started") != true)
        {
            return WorkflowOutcome.Failure($"{name} is {(job.Change ? "changed" : "built")} and its work is saved, but it could not be started: {Json.Str(published, "detail")}");
        }

        await RecurringJobsAsync(run, placement, crew, cancellationToken);
        if (job.Change)
        {
            await Workforce.SayAsync(run, "builder", "New version running", $"The new version of {name} is running, with the change and everything it did before checked in the running app. Who may open it has not changed. Its history shows the change.", cancellationToken, "published");
            return WorkflowOutcome.Success($"{name} is changed and its new version is running.") with { Announced = true };
        }

        await Workforce.SayAsync(run, "builder", "Running privately", $"{name} is built and running privately. Only you and the people you choose can open it until you make it public.", cancellationToken, "published");
        return WorkflowOutcome.Success($"{name} is built and running privately.") with { Announced = true };
    }

    /// <summary>
    /// How the planner treats what an agreed change replaces (D31): the change wins, and the idea's words it replaces are
    /// listed as left out, replaced, so the owner's list of requirements never keeps both.
    /// </summary>
    public const string ChangeWins = "Where an agreed change replaces something the idea says (for example the idea says members sign in, and the change says they open a link with no account), the change wins: list the idea's words it replaces as a requirement in leftOut, with the reason \"replaced by the change agreed after research\", and build only the change.";

    /// <summary>The idea, then each change agreed after research, so the planner holds the app to both.</summary>
    public static string WithAgreedChanges(string idea, IReadOnlyList<string> changes)
    {
        ArgumentNullException.ThrowIfNull(idea);
        ArgumentNullException.ThrowIfNull(changes);
        var agreed = changes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c.Trim()).Distinct(StringComparer.Ordinal).ToList();
        return agreed.Count == 0
            ? idea
            : $"{idea}\n\nAgreed after research, and part of what is built:\n{string.Join("\n", agreed.Select(c => $"- {c}"))}\n\n{ChangeWins}";
    }

    /// <summary>The existing app a change is made to, from the run's own scope: nothing is created.</summary>
    private static JsonObject ExistingPlacement(RunContext run)
    {
        var levels = (run.Context["levels"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        JsonObject? Level(string level) => levels.FirstOrDefault(l => Json.Str(l, "level") == level);
        var project = Level("project");
        var app = Level("app")!;
        return new JsonObject
        {
            ["name"] = Json.Str(project, "name") ?? Json.Str(app, "name"),
            ["division"] = Json.Str(Level("division"), "path"),
            ["divisionCreated"] = false,
            ["projectPath"] = Json.Str(project, "path") ?? Json.Str(app, "path"),
            ["appPath"] = Json.Str(app, "path"),
            ["appId"] = Json.Str(app, "id"),
            ["existing"] = true,
        };
    }

    /// <summary>
    /// What the app does now, part by part, from the progress file in its repository. The factory's own lines
    /// (<c>- [x] **id** — what the owner gets. Checked: …</c>) give each part in plain words. A builder may keep the file
    /// in its own words (<c>- **id** — what was built</c>, a live build did); such a part is still checked again, named
    /// by its place, with the builder's note as the detail the evaluator reads.
    /// </summary>
    public static JsonObject EarlierWork(string? progress)
    {
        var parts = new JsonArray();
        var notes = new JsonArray();
        var plain = new HashSet<string>(StringComparer.Ordinal);
        var lines = (progress ?? "").Split('\n').Select(l => l.TrimEnd()).ToList();
        foreach (var line in lines)
        {
            if (ProgressLine().Match(line.Trim()) is { Success: true } m && parts.Count < PlanContract.MaxRequirements - 10)
            {
                plain.Add(m.Groups[1].Value);
                parts.Add(m.Groups[2].Value.Trim());
            }
        }

        // A builder's own note: its first line, and the indented lines that continue it. Only what it says was built: a line
        // under a heading of what is still to do, or one that says it is not done, is not a part the app has (the real
        // change run of 2026-11-26 checked a to-do line against the running app, and repaired it twice for nothing).
        var todo = false;
        for (var i = 0; i < lines.Count && parts.Count < PlanContract.MaxRequirements - 10; i++)
        {
            if (lines[i].TrimStart().StartsWith('#'))
            {
                todo = ToDoHeading().IsMatch(lines[i]);
                continue;
            }

            if (todo || BuilderLine().Match(lines[i].Trim()) is not { Success: true } m || plain.Any(p => p.EndsWith(m.Groups[1].Value, StringComparison.Ordinal))
                || NotDone().IsMatch(m.Groups[2].Value))
            {
                continue;
            }

            var note = new StringBuilder(m.Groups[2].Value.Trim());
            for (var j = i + 1; j < lines.Count && lines[j].StartsWith("  ", StringComparison.Ordinal); j++)
            {
                note.Append(' ').Append(lines[j].Trim());
            }

            parts.Add($"Part {parts.Count + 1} of what was built before still works, as its note describes");
            notes.Add($"k{parts.Count} ({m.Groups[1].Value}): {OutputText.Truncate(note.ToString(), 600)}");
        }

        return new JsonObject { ["parts"] = parts, ["notes"] = notes };
    }

    private static async Task<JsonObject> EarlierWorkAsync(IWorkspace workspace, CancellationToken cancellationToken)
    {
        var bytes = await workspace.ReadBytesAsync($"{workspace.Root}/{ProgressFile}", cancellationToken);
        return EarlierWork(bytes is null ? null : Encoding.UTF8.GetString(bytes));
    }

    /// <summary>
    /// A change's plan with code's own last part: every part the app had before, as a requirement of its own, shown working again
    /// in the running app by the evaluator. Nothing to build first; a part it finds broken is repaired, unbilled, like any other.
    /// </summary>
    public static PlanContract WithKeep(PlanContract plan, JsonObject? earlier)
    {
        ArgumentNullException.ThrowIfNull(plan);
        var parts = Json.Strings(earlier, "parts").Where(p => p.Length > 0).ToList();
        if (parts.Count == 0 || plan.Items.Any(i => i.Id == KeepItem))
        {
            return plan;
        }

        var kept = parts.Select((p, i) => new PlanRequirement($"k{i + 1}", p)).ToList();
        var notes = Json.Strings(earlier, "notes");
        var detail = "No new work: the app as changed is checked again against each part it already had." + (notes.Count == 0 ? "" : " The builder's notes on the earlier parts: " + string.Join(" ", notes));
        var item = new PlanItem(KeepItem, "Everything the app did before still works", detail,
            KeepCheck, kept.Select(k => k.Id).ToList());
        return plan with { Items = [.. plan.Items, item], Requirements = [.. plan.Requirements, .. kept] };
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^- \[x\] \*\*([^*]+)\*\* — (.+?)\. Checked:")]
    private static partial System.Text.RegularExpressions.Regex ProgressLine();

    [System.Text.RegularExpressions.GeneratedRegex(@"^- \*\*([a-z0-9][a-z0-9-]*)\*\* — (.+)$")]
    private static partial System.Text.RegularExpressions.Regex BuilderLine();

    /// <summary>A heading over what is not built yet: to do, next, later, planned, remaining, backlog, known issues, ideas.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"^\s*#+\s*(to[ -]?do|todo|next|later|planned|plans?|remaining|not (yet )?(done|built)|pending|backlog|open|known (issues|gaps)|ideas|future|wish ?list|follow[ -]?ups?)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex ToDoHeading();

    /// <summary>A note that says its part is not there: TODO, not yet, still to, planned, later, pending, not implemented.</summary>
    [System.Text.RegularExpressions.GeneratedRegex(@"\b(todo|to do|not yet|not done|not built|not implemented|still (to|needs?)|planned|pending|later|next step|stub(bed)?|placeholder|wip)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex NotDone();

    /// <summary>
    /// Trying again (CHG-03): a new run picks up what the earlier attempt finished and agreed — where the app lives, the plan the
    /// owner or auto-mode accepted, and every part that passed its check — so finished parts are not rebuilt or billed again.
    /// A rejected plan was never recorded, so it is planned afresh; a part that failed is built again with fresh repair rounds.
    /// </summary>
    private static async Task CarryOverAsync(RunContext run, CancellationToken cancellationToken)
    {
        if (run.Journal.Done("carried") || !Guid.TryParse(Json.Str(run.OwnerMessage(), "retryOf"), out var earlier))
        {
            return;
        }

        var events = new List<RunEvent>();
        long after = 0;
        while (true)
        {
            var page = await run.ControlPlane.ReadEventsAsync(earlier, after, 500, cancellationToken);
            events.AddRange(page);
            if (page.Count < 500)
            {
                break;
            }

            after = page[^1].Seq;
        }

        var steps = new WorkflowJournal(events, run.Sink);
        foreach (var key in new[] { "placement", "screen", "earlier" })
        {
            if (steps.Get(key) is { } data)
            {
                await run.Journal.RecordAsync(key, data, cancellationToken);
            }
        }

        var plan = PlanContract.FromJson(steps.Get("plan"));
        var kept = new JsonArray();
        if (plan is not null)
        {
            var accepted = plan.ToEvent();
            accepted["by"] = "earlier-attempt";
            await run.AppendAsync(HarnessEvents.PlanAccepted, accepted, cancellationToken);
            await run.Journal.RecordAsync("plan", plan.ToJson(), cancellationToken);
            // The try's own estimate, made for what is left, stands: the plan is not priced again as if nothing were built.
            await run.Journal.RecordAsync("estimate.plan", steps.Get("estimate.plan") ?? new JsonObject { ["carried"] = true }, cancellationToken);
            foreach (var item in plan.Items.Where(i => Json.Bool(steps.Get($"item:{i.Id}"), "passed") == true))
            {
                await run.Journal.RecordAsync($"item:{item.Id}", new JsonObject { ["passed"] = true, ["carried"] = true }, cancellationToken);
                kept.Add(item.Id);
            }
        }

        await run.AppendAsync(HarnessEvents.Message, new JsonObject { ["kind"] = "plan.carried", ["from"] = "runner", ["items"] = kept.DeepClone(), ["retryOf"] = earlier.ToString() }, cancellationToken);
        await run.Journal.RecordAsync("carried", new JsonObject { ["from"] = earlier.ToString(), ["items"] = kept }, cancellationToken);
        var text = plan is null
            ? "This starts again from the plan; nothing the earlier attempt did needed undoing."
            : kept.Count == 0
                ? "This picks up where the earlier attempt stopped: the plan agreed then is kept, and building starts again from its first part."
                : $"This picks up where the earlier attempt stopped: {kept.Count} of {plan.Items.Count} parts were already built and checked, so they are kept, not rebuilt or charged again.";
        await Workforce.SayAsync(run, "runner", "Carrying on", text, cancellationToken, "carried");
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

    private async Task<WorkflowOutcome?> BuildItemAsync(RunContext run, PlanContract plan, PlanItem item, IWorkspace workspace, Guid appId, bool recreated, Crew crew, bool change, CancellationToken cancellationToken)
    {
        if (Json.Bool(run.Journal.Get($"item:{item.Id}"), "passed") == true)
        {
            return null;
        }

        // A change's "keep" part has nothing to build: it is checked first, and only repaired if the check finds something broken.
        var checkFirst = change && item.Id == KeepItem;

        // The item is a task in the graph, claimed by the engineer who builds it: the work is theirs wherever the run belongs.
        var taskId = await ClaimTaskAsync(run, $"build:{item.Id}", crew.ProjectPath, item.Text, $"{item.Detail}\nChecked by: {item.Check}", checkFirst ? crew.Qa : crew.Engineer, cancellationToken);
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
            if (checkFirst && round == 0)
            {
                // Nothing built yet: straight to the check of what worked before.
                var firstCheck = await JudgeAsync(run, plan, item, round, tier, workspace, appId, crew, taskId, cancellationToken);
                if (firstCheck.Outcome is { } interrupted)
                {
                    return interrupted;
                }

                lastEvaluation = firstCheck.Evaluation;
                if (Json.Bool(lastEvaluation, "passed") == true)
                {
                    break;
                }

                continue;
            }

            var task = repair
                ? RunnerResources.Prompt("repair", new Dictionary<string, string>
                {
                    ["round"] = round.ToString(CultureInfo.InvariantCulture),
                    ["rounds"] = run.Options.MaxRepairRounds.ToString(CultureInfo.InvariantCulture),
                    ["item"] = $"[{item.Id}] {item.Deliverable} — checked by: {item.Check}\n{TestIdsLine(item)}{Requirements(plan, item)}",
                    ["evidence"] = Json.Str(lastEvaluation, "evidence") ?? "",
                    ["faults"] = string.Join("\n", Json.Strings(lastEvaluation, "faults").Select(f => $"- {f}")),
                })
                : $"Build this one feature of the plan, completely, then commit it.\n\nThe feature: [{item.Id}] {item.Deliverable}\nIt will be checked by: {item.Check}\n{TestIdsLine(item)}{Requirements(plan, item)}\nThe whole plan, for context (build only this item now):\n{plan.Render()}"
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

            var judged = await JudgeAsync(run, plan, item, round, tier, workspace, appId, crew, taskId, cancellationToken);
            if (judged.Outcome is { } interrupted2)
            {
                return interrupted2;
            }

            var evaluation = judged.Evaluation!;
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
            await FinishTaskAsync(run, taskId, "failed", $"Still did not work after {run.Options.MaxRepairRounds} rounds of repair, each on a stronger model; the repairs were not charged.", cancellationToken);
            return WorkflowOutcome.Failure($"'{item.Deliverable}' still failed its check after {run.Options.MaxRepairRounds} repair rounds: {string.Join(" ", Json.Strings(lastEvaluation, "faults"))}")
                with
            { ForOwner = $"\"{item.Text.TrimEnd('.')}\" still did not work after {run.Options.MaxRepairRounds} rounds of repair, each on a stronger model, so the app was not {(change ? "changed" : "published")}. Its work so far is saved and the repairs were not charged; “Try again” carries on from it." };
        }

        if (item.Id != KeepItem)
        {
            await RecordProgressAsync(run, item, lastEvaluation!, workspace, change, cancellationToken);
        }

        await run.Journal.RecordAsync($"item:{item.Id}", new JsonObject { ["passed"] = true }, cancellationToken);
        // The build task says what was built; its check task already said "Checked and working" (each finished task once, in its own words).
        await FinishTaskAsync(run, taskId, "done", checkFirst ? $"Still works after the change: {item.Text.TrimEnd('.')}." : $"Built and handed over: {item.Text.TrimEnd('.')}.", cancellationToken);
        return null;
    }

    /// <summary>One round's check by the QA engineer, as its own task, written to the log as a judgement on the engineer's work.</summary>
    private async Task<(JsonObject? Evaluation, WorkflowOutcome? Outcome)> JudgeAsync(RunContext run, PlanContract plan, PlanItem item, int round, string tier, IWorkspace workspace, Guid appId, Crew crew, Guid? taskId, CancellationToken cancellationToken)
    {
        var key = $"item:{item.Id}:round:{round}";
        // The check is the QA engineer's own piece of work.
        var checkTaskId = await ClaimTaskAsync(run, $"check:{item.Id}:{round}", crew.ProjectPath, $"Check: {item.Text}", $"Round {round}, built on {tier}. Checked by: {item.Check}", crew.Qa, cancellationToken);
        var evaluation = await EvaluateAsync(run, plan, item, round, tier, workspace, appId, crew, cancellationToken);
        if (evaluation is null)
        {
            return (null, WorkflowOutcome.Suspend("evaluation interrupted"));
        }

        var passedNow = Json.Bool(evaluation, "passed") == true;
        var shown = (evaluation["requirements"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var summary = EvaluationSummary(item, passedNow, shown, round);
        // A judgement on the engineer's work by the QA engineer: accepted, or sent back with the repair not charged.
        var judgement = new JsonObject
        {
            ["item"] = item.Id,
            ["text"] = item.Text,
            ["summary"] = summary,
            ["round"] = round,
            ["tier"] = tier,
            ["taskId"] = taskId?.ToString(),
            ["employeeId"] = crew.Engineer?.ToString(),
            ["judgedBy"] = crew.Qa?.ToString(),
            ["checkTaskId"] = checkTaskId?.ToString(),
            ["requirements"] = new JsonArray(shown.Select(r => (JsonNode)r.DeepClone()).ToArray()),
            ["evidence"] = OutputText.Truncate(Json.Str(evaluation, "evidence") ?? "", 4000),
            ["faults"] = evaluation["faults"]?.DeepClone(),
        };
        if (!passedNow && round < run.Options.MaxRepairRounds)
        {
            judgement["repairCharged"] = false;
        }
        else if (!passedNow)
        {
            judgement["final"] = true;
        }

        await run.AppendAsync(passedNow ? HarnessEvents.EvaluationPassed : HarnessEvents.EvaluationFailed, judgement, cancellationToken);
        await FinishTaskAsync(run, checkTaskId, "done", summary, cancellationToken);
        await run.Journal.RecordAsync(key, evaluation, cancellationToken);
        return (evaluation, null);
    }

    /// <summary>
    /// A piece of this build's work in the persistent task graph, claimed by the employee who does it (null when the hire
    /// still waits for the owner). Created once — the journal remembers it, so a resumed build creates nothing twice — and
    /// claimed again on resume only if the lease sweep handed it back. Attribution never stops the work: a refusal is null.
    /// </summary>
    private static async Task<Guid?> ClaimTaskAsync(RunContext run, string key, string scope, string title, string description, Guid? employeeId, CancellationToken cancellationToken)
    {
        var step = $"task:{key}";
        var recorded = run.Journal.Get(step);
        try
        {
            if (recorded is null)
            {
                var created = await run.ControlPlane.CreateTaskAsync(scope, run.Run.Id, Sentences.Flatten(title, 300), description, null, null, cancellationToken);
                recorded = await run.Journal.RecordAsync(step, new JsonObject { ["taskId"] = created.Id.ToString() }, cancellationToken);
            }

            var id = Guid.Parse(Json.Str(recorded, "taskId")!);
            try
            {
                await run.ControlPlane.CheckoutTaskAsync(id, run.Run.Id, employeeId, TaskStatuses.Todo, null, cancellationToken);
            }
            catch (Harness.Tasks.TaskConflictException)
            {
                // Already claimed by this run before it was resumed, or finished: either way it is this build's.
            }

            return id;
        }
        catch (Harness.Model.ServiceProblemException)
        {
            return recorded is not null && Guid.TryParse(Json.Str(recorded, "taskId"), out var known) ? known : null;
        }
    }

    /// <summary>Done or failed, with a plain sentence of what happened; the control plane logs it with who did it.</summary>
    private static async Task FinishTaskAsync(RunContext run, Guid? taskId, string status, string summary, CancellationToken cancellationToken)
    {
        if (taskId is not { } id)
        {
            return;
        }

        try
        {
            await run.ControlPlane.PatchTaskAsync(id, new { status, summary = Sentences.Plain(summary, 600) }, cancellationToken);
        }
        catch (Harness.Model.ServiceProblemException)
        {
            // The judgement and the run's log already record it.
        }
    }

    /// <summary>
    /// The preview, then a separate evaluator with its own context; a build that fails is a failed evaluation without one. The
    /// preview is the evaluated image with a throwaway database of its own, destroyed when the evaluation ends, so nothing the
    /// evaluator's test members do ever reaches the app that is published.
    /// </summary>
    private async Task<JsonObject?> EvaluateAsync(RunContext run, PlanContract plan, PlanItem item, int round, string tier, IWorkspace workspace, Guid appId, Crew crew, CancellationToken cancellationToken)
    {
        try
        {
            return await EvaluateOnPreviewAsync(run, plan, item, round, tier, workspace, appId, crew, cancellationToken);
        }
        finally
        {
            await RemovePreviewAsync(run, appId);
        }
    }

    private static async Task RemovePreviewAsync(RunContext run, Guid appId)
    {
        if (run.Dock is not { } dock)
        {
            return;
        }

        try
        {
            // Not the run's token: a cancelled or suspended run still takes its preview and the test data down.
            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(1));
            await dock.RemovePreviewAsync(appId, timeout.Token);
        }
        catch (Exception e) when (e is WorkspaceException or HttpRequestException or OperationCanceledException)
        {
            // Dock replaces any earlier preview when the next one starts, and drops its database then.
        }
    }

    private async Task<JsonObject?> EvaluateOnPreviewAsync(RunContext run, PlanContract plan, PlanItem item, int round, string tier, IWorkspace workspace, Guid appId, Crew crew, CancellationToken cancellationToken)
    {
        string? previewNote = null;
        ITool? probe = null;
        ITool? callApp = null;
        if (run.Dock is { } dock)
        {
            try
            {
                // The preview is of this run's own work, which is on its branch until it is published (R2-4).
                var image = await dock.BuildRunAsync(appId, run.Run.Id, run.StartFrom(), cancellationToken);
                // The preview's own token: what it e-mails is held, never sent, and the live app's token is left alone.
                var token = await run.ControlPlane.MintAppTokenAsync(appId, cancellationToken, preview: true);
                await dock.StartPreviewAsync(appId, new StartAppRequest(run.OrganisationId, image.Image, token, null, null), cancellationToken);
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
        // The check of what worked before says how a part on screen is shown: by the data it shows or changes (KeepCheck).
        var checkedItem = item.Id == KeepItem ? item with { Check = KeepCheck } : item;
        var evaluator = AgentFactory.As(run, run.Agents.Evaluator(run, evaluatorId, checkedItem, plan.RequirementsOf(item), workspace.Root, probe, callApp, appId), crew.Qa, crew.QaMemory, canRemember: true, crew.ProjectPath);
        var result = await WorkflowSupport.RunAgentAsync(run, evaluator, workspace,
            $"Evaluate the item now (round {round}, built on {tier}).{(previewNote is null ? "" : "\n\n" + previewNote)}", cancellationToken);
        if (WorkflowOutcome.FromAgent(result) is not null)
        {
            return null;
        }

        var answer = WorkflowSupport.JsonAnswer(result.FinalText);
        if (result.CutOff)
        {
            // Not a verdict in the wrong form: it did not fit (R2-6). Unchecked, and checked again.
            answer = new JsonObject { ["passed"] = false, ["evidence"] = "The check's answer was too long to finish.", ["faults"] = Json.Array(["The evaluator's answer was too long to finish; treat the item as unchecked and check it again."]) };
        }
        else if (answer is null || Json.Bool(answer, "passed") is null)
        {
            // An evaluator that gives no verdict has not passed anything.
            answer = new JsonObject { ["passed"] = false, ["evidence"] = OutputText.Truncate(result.FinalText ?? "", 2000), ["faults"] = Json.Array(["The evaluator gave no verdict; treat the item as unchecked and check it again."]) };
        }

        // Code's gate: every requirement the item delivers is shown working in the running app, signed in, and every test id the
        // plan promised is on the app's screens, or the item fails.
        var calls = CallAppTool.CallsIn(await run.LogReader.ReadAllAsync(cancellationToken), evaluatorId);
        return EvaluationGate.Apply(plan, item, answer, calls, await MissingTestIdsAsync(workspace, item, cancellationToken));
    }

    /// <summary>The item's promised test ids that no file under <c>web/src</c> writes as <c>data-testid="…"</c>.</summary>
    public static async Task<IReadOnlyList<string>> MissingTestIdsAsync(IWorkspace workspace, PlanItem item, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(workspace);
        ArgumentNullException.ThrowIfNull(item);
        if (item.TestIds.Count == 0)
        {
            return [];
        }

        var search = await workspace.ExecAsync(new WorkspaceCommand(["rg", "--no-messages", "--glob", "!*.test.*", "-e", "data-testid=", $"{workspace.Root}/web/src"], null, TimeoutSeconds: 60, MaxOutputBytes: 512 * 1024), cancellationToken);
        var found = TestIdConvention.Found(search.Stdout);
        return item.TestIds.Where(t => !found.Contains(t)).ToList();
    }

    private static async Task RecordProgressAsync(RunContext run, PlanItem item, JsonObject evaluation, IWorkspace workspace, bool change, CancellationToken cancellationToken)
    {
        // A change's parts are keyed by the run, so its "i1" never hides the build's "i1".
        var id = change ? $"{run.Run.Id.ToString("N")[..8]}-{item.Id}" : item.Id;
        var path = $"{workspace.Root}/{ProgressFile}";
        var existing = await workspace.ReadBytesAsync(path, cancellationToken);
        var text = existing is null ? "# Progress\n\nWhat is built and checked, feature by feature. Kept by the factory.\n\n" : Encoding.UTF8.GetString(existing);
        var evidence = (Json.Str(evaluation, "evidence") ?? "").Split('\n')[0];
        var line = $"- [x] **{id}** — {item.Text.TrimEnd('.')}. Checked: {OutputText.Truncate(evidence, 300)}\n";
        // The factory's own line, in the owner's words, even when the builder already noted the part in its own (a live build did).
        if (!text.Contains($"- [x] **{id}**", StringComparison.Ordinal))
        {
            await workspace.WriteBytesAsync(path, Encoding.UTF8.GetBytes(text.TrimEnd('\n') + "\n" + line), cancellationToken);
            await workspace.CommitAsync($"Record progress: {id} is built and checked", "Endgame factory", $"factory@{run.Options.AuthorDomain}", cancellationToken);
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
                // The organisation's standing security reviewer does it, and the work is attributed to them: their own task.
                var reviewTask = await ClaimTaskAsync(run, key, crew.ProjectPath, attempt == 0 ? "Review the app's security before it is published" : "Check the security fixes before the app is published",
                    "Secrets, sign-in, data, model calls and outbound calls, against the security review checklist.", crew.Reviewer, cancellationToken);
                var reviewer = await WorkflowSupport.RunAgentAsync(run, AgentFactory.As(run, run.Agents.SecurityReviewer(run, workspace.Root) with { Id = $"security-reviewer-{attempt}" }, crew.Reviewer, crew.ReviewerMemory, canRemember: true, crew.ProjectPath), workspace,
                    "Review the app now against your checklist, then reply with the JSON object.", cancellationToken);
                if (WorkflowOutcome.FromAgent(reviewer) is { } stopped)
                {
                    return stopped;
                }

                findings = (reviewer.CutOff ? null : WorkflowSupport.JsonAnswer(reviewer.FinalText))
                    ?? new JsonObject { ["passed"] = false, ["findings"] = new JsonArray(new JsonObject { ["problem"] = reviewer.CutOff ? "The review's report was too long to finish, so the app is not cleared." : "The review gave no report, so the app is not cleared." }) };
                await run.Journal.RecordAsync(key, findings, cancellationToken);
                await run.AppendAsync(HarnessEvents.Message, new JsonObject
                {
                    ["from"] = "security-reviewer",
                    ["kind"] = "security.review",
                    ["passed"] = Passed(findings),
                    ["findings"] = findings["findings"]?.DeepClone(),
                    ["employeeId"] = crew.Reviewer?.ToString(),
                    ["taskId"] = reviewTask?.ToString(),
                }, cancellationToken);
                var count = (findings["findings"] as JsonArray ?? []).Count;
                await FinishTaskAsync(run, reviewTask, "done", Passed(findings) ? "Nothing found that blocks publishing." : $"Found {count} problem{(count == 1 ? "" : "s")} that block publishing.", cancellationToken);
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

            // One repair of the findings, on the agent's own work, not billed: the engineer's task.
            var fixTask = await ClaimTaskAsync(run, "security-fix", crew.ProjectPath, "Fix what the security review found", "Each finding fixed, verified with make lint and make test, and committed.", crew.Engineer, cancellationToken);
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

            await FinishTaskAsync(run, fixTask, "done", "The security review's findings were fixed, at no charge, and go back for a second review.", cancellationToken);
        }

        var list = (run.Journal.Get("security:1")?["findings"] as JsonArray ?? []).OfType<JsonObject>().Select(f => $"{Json.Str(f, "file")}: {Json.Str(f, "problem")}");
        return WorkflowOutcome.Failure($"Publishing is blocked by the security review: {string.Join("; ", list)}")
            with
        { ForOwner = "The security review still found problems after one repair, so the app was not published. Its work is saved, technical mode lists each finding, and “Try again” carries on from it." };
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
            // The run's work becomes the app's next version only now, as one version titled with what was asked for (R2-4).
            var version = await dock.PublishRunAsync(appId, run.Run.Id, new PublishRunRequest(VersionTitle(run), "Endgame factory", $"factory@{run.Options.AuthorDomain}"), cancellationToken);
            var image = await dock.BuildAsync(appId, version.Id, cancellationToken);
            var token = await run.ControlPlane.MintAppTokenAsync(appId, cancellationToken);
            var status = await dock.StartAsync(appId, new StartAppRequest(run.OrganisationId, image.Image, token, null, null), cancellationToken);
            return new JsonObject { ["started"] = status.State == AppRuntimeState.Running, ["image"] = image.Image, ["commit"] = image.Commit, ["state"] = status.State, ["visibility"] = "private" };
        }
        catch (Exception e) when (e is WorkspaceException or Harness.Model.ServiceProblemException or HttpRequestException)
        {
            return new JsonObject { ["started"] = false, ["detail"] = OutputText.Truncate(e.Message, 500) };
        }
    }

    /// <summary>A published version's title: the run's own, without its kind — what the person asked for (R2-4).</summary>
    public static string VersionTitle(RunContext run)
    {
        ArgumentNullException.ThrowIfNull(run);
        var title = run.Run.Title.Trim();
        foreach (var prefix in new[] { "Change: ", "Build: " })
        {
            if (title.StartsWith(prefix, StringComparison.Ordinal))
            {
                title = title[prefix.Length..].Trim();
            }
        }

        return OutputText.Truncate(title.Length > 0 ? title : "A new version", 400);
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

    /// <summary>The test ids an item's screens must carry, for the builder's task.</summary>
    private static string TestIdsLine(PlanItem item) =>
        item.TestIds.Count == 0
            ? ""
            : $"Its screens carry these test ids, exactly, as data-testid on the elements the kit's convention names (AGENTS.md), and its tests select by them: {string.Join(", ", item.TestIds)}. Code checks each one is there.\n";

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
