using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Hooks;
using Endgame.Harness.Kernel;
using Endgame.Harness.Permissions;
using Endgame.Harness.Planning;
using Endgame.Harness.Skills;
using Endgame.Harness.Subagents;
using Endgame.Harness.Tasks;
using Endgame.Harness.Tools;
using Endgame.Runner.Agents;

namespace Endgame.Runner.Execution;

/// <summary>
/// The workforce's roles as agent definitions: builder, planner, evaluator, researcher, security
/// reviewer and conversation. Each gets its prompt, its tools, and a permission policy built from
/// the run's cascade (its rule sets and checkpoints) over the protected-path floor.
/// </summary>
public sealed class AgentFactory(RunnerOptions options)
{
    public static readonly string[] BuilderSkills = ["build-on-the-app-kit", "add-an-entity", "add-an-endpoint", "write-a-migration", "write-a-screen"];

    public AgentDefinition Builder(RunContext run, string id, string taskType, bool repair, string root, string? prompt = null) => Base(run, id, taskType) with
    {
        SystemPrompt = prompt ?? RunnerResources.Prompt("builder", new Dictionary<string, string> { ["root"] = root, ["skills"] = SkillLibrary.Index(run.Skills, BuilderSkills) }),
        Tools = new ToolRegistry([
            new ReadFileTool(), new EditFileTool(), new WriteFileTool(), new ListFilesTool(), new SearchTool(), new RunTool(), new GitDiffTool(), new CommitTool(),
            new NotesTool(), new LoadSkillTool(), new TasksTool(), new SpawnTool(),
        ]),
        Permissions = Policy(run, "build", ["edit_file", "write_file", "run", "commit", "tasks"]),
        Progress = new ProgressReports("builder", "Still building", repair ? "Still repairing this part" : "Still building this part"),
        Repair = repair,
        // A whole feature across entity, migration, endpoints, screens and tests: the first live build needed more than 50.
        Limits = new AgentLimits { MaxSteps = 70 },
        StopHooks =
        [
            new VerifyAfterEditStopHook(),
            new CheckCommandStopHook("lint", "make lint", "Fix each lint or format error at the file and line it names; never disable a rule, add a suppression or edit vendor/."),
        ],
    };

    /// <summary>The factory's planner: its plan must be a faithful contract with <paramref name="idea"/>, or propose_plan refuses it.</summary>
    public AgentDefinition Planner(RunContext run, string root, string idea) => Base(run, "planner", options.PlanTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("planner", new Dictionary<string, string> { ["root"] = root, ["skills"] = SkillLibrary.Index(run.Skills, BuilderSkills) }),
        Tools = new ToolRegistry([new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new LoadSkillTool(), new NotesTool(), new ProposePlanTool(idea)]),
        Permissions = Policy(run, "plan", []).WithMode(AgentMode.Plan),
        // propose_plan is read by code: a call cut off at the output limit is asked for again with twice the room (R2-6).
        StructuredAnswer = true,
        Title = "Drew up the plan",
        Progress = new ProgressReports("planner", "Still planning", "Still reading the app and deciding the parts of the plan"),
        AutoAcceptPlan = false,
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 30 },
    };

    public AgentDefinition Evaluator(RunContext run, string id, PlanItem item, IReadOnlyList<PlanRequirement> requirements, string root, ITool? preview, ITool? callApp, Guid? appId = null) => Base(run, id, options.EvaluateTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("evaluator", new Dictionary<string, string>
        {
            ["root"] = root,
            ["item"] = $"[{item.Id}] {item.Deliverable}\nChecked by: {item.Check}" + (item.TestIds.Count == 0 ? "" : $"\nTest ids its screens must carry: {string.Join(", ", item.TestIds)}"),
            ["requirements"] = requirements.Count == 0 ? "(none listed: judge the item as written)" : string.Join("\n", requirements.Select(r => $"- {r.Id}: {r.Text}" + (PlanRequirement.IsOwnRecord(r.Text) ? " [their own: check coming back later]" : ""))),
        }),
        Tools = new ToolRegistry(new ITool?[]
        {
            new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new RunTool(), preview, callApp,
            callApp is not null && appId is { } app ? new CallWebhookTool(run.ControlPlane, app) : null,
            callApp is not null && appId is { } mailApp ? new SentEmailsTool(run.ControlPlane, mailApp) : null,
        }.OfType<ITool>()),
        // The evaluator may run checks but never change files: no write tool, and file writes denied outright.
        Permissions = Policy(run, "evaluate", ["run"], deny: ["edit_file", "write_file", "commit"]),
        Progress = new ProgressReports("evaluator", "Still checking", "Still checking this part in the running app"),
        StopHooks = [],
        // Its verdict is a JSON object code reads (R2-6); 8,000 tokens leaves a reasoning model room, and twice that for the one retry.
        StructuredAnswer = true,
        // Reading the change, two checks and every requirement in the running app: a live evaluator of a five-requirement item ran out at 30.
        Limits = new AgentLimits { MaxSteps = 50, MaxOutputTokens = 8000 },
    };

    public AgentDefinition SecurityReviewer(RunContext run, string root) => Base(run, "security-reviewer", options.ReviewTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("security-reviewer", new Dictionary<string, string> { ["root"] = root, ["skills"] = SkillLibrary.Index(run.Skills, ["security-review-checklist"]) }),
        Tools = new ToolRegistry([new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new LoadSkillTool(), new NotesTool()]),
        Permissions = Policy(run, "review", []).WithMode(AgentMode.Plan),
        StopHooks = [],
        StructuredAnswer = true,
        Limits = new AgentLimits { MaxSteps = 40, MaxOutputTokens = 8000 },
    };

    /// <summary>A research contractor or the judge: no workspace, the research route's server-side web search, no tools of its own beyond notes.</summary>
    public AgentDefinition Researcher(RunContext run, string id, string prompt) => Base(run, id, options.ResearchTaskType) with
    {
        SystemPrompt = prompt,
        Tools = new ToolRegistry([new NotesTool()]),
        Permissions = Policy(run, "research", []).WithMode(AgentMode.Plan),
        StopHooks = [],
        // Every research agent replies with a JSON object that code reads (R2-6).
        StructuredAnswer = true,
        // No web search unless a workflow gives this agent a search budget of its own.
        Limits = new AgentLimits { MaxSteps = 8, MaxOutputTokens = 8000, MaxSearchesPerCall = 0 },
    };

    /// <summary>
    /// A researcher whose whole job is one JSON answer — a screen, a verdict, a memory review, suggestions: no tools at all,
    /// so the gateway can ask the model for a JSON object outright (R2-6).
    /// </summary>
    public AgentDefinition Answerer(RunContext run, string id, string prompt) => Researcher(run, id, prompt) with { Tools = new ToolRegistry([]) };

    /// <param name="noWebSearch">The person asked for no web search in this message (ARCH-011): web search is denied by the run's own rule, ahead of the cascade, and no call may search.</param>
    public AgentDefinition Conversation(RunContext run, IEnumerable<ITool> tools, bool noWebSearch = false) => Base(run, "assistant", options.ChatTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("conversation", new Dictionary<string, string>
        {
            ["place"] = PlaceNames.Of(run).Name(run.Run.Scope),
            ["places"] = PlaceNames.Of(run).Listing(),
        }),
        Tools = new ToolRegistry(tools),
        // Starting an idea, changing an app, trying stopped work again or changing a setting is the owner's call: each asks, as a
        // checkpoint the person answers in the conversation itself, before it happens.
        Permissions = Policy(run, "conversation", ["read_organisation"], deny: noWebSearch ? [WebSearch.Name] : null, checkpoints: ["start_idea", "change_app", "try_again", "adjust_setting"]),
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 12, MaxOutputTokens = 4000, MaxSearchesPerCall = noWebSearch ? 0 : null },
    };

    /// <summary>
    /// The agent as the employee (or contractor) doing the work: its model calls carry that id, its curated
    /// memory follows its instructions as context, and an employee may keep notes with <c>remember</c>.
    /// </summary>
    public static AgentDefinition As(RunContext run, AgentDefinition agent, Guid? workerId, string memory, bool canRemember, string? scope = null)
    {
        ArgumentNullException.ThrowIfNull(run);
        ArgumentNullException.ThrowIfNull(agent);
        if (workerId is not { } id)
        {
            return agent;
        }

        var remember = canRemember
            ? "\n\nBefore you finish, if you learned something about this organisation or this app that would help next time, keep it with remember (at most twice)."
            : "";
        return agent with
        {
            EmployeeId = id,
            SystemPrompt = agent.SystemPrompt.TrimEnd() + remember + memory,
            Tools = canRemember ? agent.Tools.With(new RememberTool(run.ControlPlane, id, run.Run.Id, scope ?? run.Run.Scope)) : agent.Tools,
            // A plain name Dock accepts as a commit author: no brackets, no line breaks, never a truncation marker.
            AuthorName = $"Endgame employee {id.ToString("N")[..8]}",
            AuthorEmail = $"{id:N}@{run.Options.AuthorDomain}",
        };
    }

    public PermissionPolicy Policy(RunContext run, string stage, IEnumerable<string> allow, IEnumerable<string>? deny = null, IEnumerable<string>? checkpoints = null)
    {
        ArgumentNullException.ThrowIfNull(run);
        var ruleSets = (run.Context["ruleSets"] as JsonArray ?? []).OfType<JsonObject>()
            .Select(r => CascadeRuleSet.FromJson(Json.Str(r, "key") ?? "", Json.Str(r, "setAtPath") ?? Json.Str(r, "setAtLevel") ?? "", r["value"]))
            .ToList();
        return new PermissionPolicy
        {
            Stage = stage,
            ProtectedPaths = options.ProtectedPaths,
            Allow = allow.Select(PermissionRule.Parse).ToList(),
            Deny = (deny ?? []).Select(PermissionRule.Parse).ToList(),
            Checkpoints = (checkpoints ?? []).Select(PermissionRule.Parse).ToList(),
            Cascade = ruleSets,
            Unattended = true,
        };
    }

    private AgentDefinition Base(RunContext run, string id, string taskType) => new()
    {
        Id = id,
        TaskType = taskType,
        Scope = run.Run.Scope,
        RunId = run.Run.Id,
        EmployeeId = run.Run.EmployeeId,
        SystemPrompt = "",
        Tools = new ToolRegistry([]),
        AuthorName = run.Run.EmployeeId is { } employee ? $"Endgame employee {employee:N}"[..30] : "Endgame factory",
        AuthorEmail = run.Run.EmployeeId is { } e ? $"{e:N}@{options.AuthorDomain}" : $"factory@{options.AuthorDomain}",
        SummaryTaskType = options.SummaryTaskType,
    };
}
