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
            new NotesTool(), new LoadSkillTool(), new MarkItemTool(), new TasksTool(), new SpawnTool(),
        ]),
        Permissions = Policy(run, "build", ["edit_file", "write_file", "run", "commit", "tasks"]),
        Repair = repair,
        StopHooks =
        [
            new VerifyAfterEditStopHook(),
            new CheckCommandStopHook("lint", "make lint", "Fix each lint or format error at the file and line it names; never disable a rule, add a suppression or edit vendor/."),
        ],
    };

    public AgentDefinition Planner(RunContext run, string root) => Base(run, "planner", options.PlanTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("planner", new Dictionary<string, string> { ["root"] = root, ["skills"] = SkillLibrary.Index(run.Skills, BuilderSkills) }),
        Tools = new ToolRegistry([new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new LoadSkillTool(), new NotesTool(), new ProposePlanTool()]),
        Permissions = Policy(run, "plan", []).WithMode(AgentMode.Plan),
        AutoAcceptPlan = false,
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 30 },
    };

    public AgentDefinition Evaluator(RunContext run, string id, PlanItem item, string root, ITool? preview) => Base(run, id, options.EvaluateTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("evaluator", new Dictionary<string, string> { ["root"] = root, ["item"] = $"[{item.Id}] {item.Deliverable}\nChecked by: {item.Check}" }),
        Tools = new ToolRegistry(new ITool?[] { new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new RunTool(), preview }.OfType<ITool>()),
        // The evaluator may run checks but never change files: no write tool, and file writes denied outright.
        Permissions = Policy(run, "evaluate", ["run"], deny: ["edit_file", "write_file", "commit"]),
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 30 },
    };

    public AgentDefinition SecurityReviewer(RunContext run, string root) => Base(run, "security-reviewer", options.ReviewTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("security-reviewer", new Dictionary<string, string> { ["root"] = root, ["skills"] = SkillLibrary.Index(run.Skills, ["security-review-checklist"]) }),
        Tools = new ToolRegistry([new ReadFileTool(), new ListFilesTool(), new SearchTool(), new GitDiffTool(), new LoadSkillTool(), new NotesTool()]),
        Permissions = Policy(run, "review", []).WithMode(AgentMode.Plan),
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 40 },
    };

    /// <summary>A research contractor or the judge: no workspace, the research route's server-side web search, no tools of its own beyond notes.</summary>
    public AgentDefinition Researcher(RunContext run, string id, string prompt) => Base(run, id, options.ResearchTaskType) with
    {
        SystemPrompt = prompt,
        Tools = new ToolRegistry([new NotesTool()]),
        Permissions = Policy(run, "research", []).WithMode(AgentMode.Plan),
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 8, MaxOutputTokens = 8000 },
    };

    public AgentDefinition Conversation(RunContext run, IEnumerable<ITool> tools) => Base(run, "assistant", options.ChatTaskType) with
    {
        SystemPrompt = RunnerResources.Prompt("conversation", new Dictionary<string, string> { ["scope"] = run.Run.Scope }),
        Tools = new ToolRegistry(tools),
        // Starting an idea or changing a setting is the owner's call: each asks, as a checkpoint, before it happens.
        Permissions = Policy(run, "conversation", ["read_organisation"], checkpoints: ["start_idea", "adjust_setting"]),
        StopHooks = [],
        Limits = new AgentLimits { MaxSteps = 12, MaxOutputTokens = 4000 },
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
            AuthorName = OutputText.Truncate($"Endgame employee {id:N}", 30),
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
