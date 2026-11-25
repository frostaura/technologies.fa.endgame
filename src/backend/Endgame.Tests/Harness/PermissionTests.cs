using System.Text.Json.Nodes;
using Endgame.Harness.Permissions;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Tests.Harness;

/// <summary>The permission pipeline, table-driven: each rule source, the floor, plan mode, unattended denial and checkpoint approval.</summary>
public sealed class PermissionTests
{
    private static readonly CascadeRuleSet OrgRules = CascadeRuleSet.FromJson("all", "frostaura", JsonNode.Parse("""
        { "deny": ["run(git push*)"], "ask": ["write_file(infra/**)"], "allow": ["edit_file"], "checkpoints": ["write_file(infra/**)"] }
        """));

    private static readonly CascadeRuleSet BuildRules = CascadeRuleSet.FromJson("build", "frostaura/technologies", JsonNode.Parse("""
        { "deny": ["write_file(secrets/**)"] }
        """));

    private static readonly CascadeRuleSet ResearchRules = CascadeRuleSet.FromJson("research", "frostaura", JsonNode.Parse("""
        { "deny": ["*"] }
        """));

    public static TheoryData<string, string, ToolEffect, string?, string?, string, string> Cases() => new()
    {
        // name, tool, effect, path, command, expected verdict, expected rule (prefix)
        { "the .git floor beats every allow", "write_file", ToolEffect.WritesFiles, ".git/hooks/pre-commit", null, "Deny", "floor:.git" },
        { "reading .git is refused too", "read_file", ToolEffect.ReadOnly, ".git/config", null, "Deny", "floor:.git" },
        { "a protected path beats an explicit allow", "write_file", ToolEffect.WritesFiles, "vendor/kit/a.cs", null, "Deny", "floor:protected-path(vendor/**)" },
        { "reading a protected path is fine", "read_file", ToolEffect.ReadOnly, "vendor/kit/a.cs", null, "Allow", "default:read-only" },
        { "the run's deny rule", "run", ToolEffect.Executes, null, "rm -rf /workspace", "Deny", "deny:run(rm -rf*)" },
        { "a cascade deny at the organisation", "run", ToolEffect.Executes, null, "git push origin main", "Deny", "cascade:frostaura:all:deny:run(git push*)" },
        { "a cascade deny for this stage only", "write_file", ToolEffect.WritesFiles, "secrets/key.txt", null, "Deny", "cascade:frostaura/technologies:build:deny:" },
        { "a cascade ask with a checkpoint asks", "write_file", ToolEffect.WritesFiles, "infra/main.tf", null, "Ask", "cascade:frostaura:all:ask:" },
        { "the run's allow rule", "write_file", ToolEffect.WritesFiles, "api/Program.cs", null, "Allow", "allow:write_file" },
        { "a cascade allow", "edit_file", ToolEffect.WritesFiles, "api/Program.cs", null, "Allow", "cascade:frostaura:all:allow:edit_file" },
        { "reads are allowed by default", "search", ToolEffect.ReadOnly, null, null, "Allow", "default:read-only" },
        { "unattended, an unallowed command is denied", "run", ToolEffect.Executes, null, "dotnet build", "Deny", "unattended:default:ask" },
        { "unattended, an unallowed external tool is denied", "commit", ToolEffect.External, null, null, "Deny", "unattended:default:ask" },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void The_pipeline_decides_by_the_first_rule_that_applies(string name, string tool, ToolEffect effect, string? path, string? command, string verdict, string rule)
    {
        var policy = Policy();
        var decision = policy.Decide(tool, effect, Targets(path, command), hasPlan: true);
        Assert.True(decision.Verdict.ToString() == verdict, $"{name}: expected {verdict}, got {decision.Verdict} ({decision.Rule}: {decision.Reason})");
        Assert.StartsWith(rule, decision.Rule, StringComparison.Ordinal);
    }

    [Fact]
    public void Plan_mode_allows_reads_and_refuses_every_change_even_an_allowed_one()
    {
        var plan = Policy().WithMode(AgentMode.Plan);
        Assert.Equal(PermissionVerdict.Allow, plan.Decide("read_file", ToolEffect.ReadOnly, Targets("api/Program.cs", null), false).Verdict);
        var write = plan.Decide("write_file", ToolEffect.WritesFiles, Targets("api/Program.cs", null), false);
        Assert.Equal(PermissionVerdict.Deny, write.Verdict);
        Assert.Equal("mode:plan", write.Rule);
        Assert.Equal("mode:plan", plan.Decide("run", ToolEffect.Executes, Targets(null, "ls"), false).Rule);
    }

    [Fact]
    public void A_run_that_must_plan_first_cannot_change_anything_before_its_plan_is_accepted()
    {
        var policy = Policy().WithRequirePlan(true);
        Assert.Equal("plan:required", policy.Decide("write_file", ToolEffect.WritesFiles, Targets("api/Program.cs", null), hasPlan: false).Rule);
        Assert.Equal(PermissionVerdict.Allow, policy.Decide("write_file", ToolEffect.WritesFiles, Targets("api/Program.cs", null), hasPlan: true).Verdict);
    }

    [Fact]
    public void A_rule_set_for_another_stage_does_not_apply()
    {
        var policy = Policy();
        Assert.Equal(PermissionVerdict.Allow, policy.Decide("write_file", ToolEffect.WritesFiles, Targets("api/a.cs", null), true).Verdict);
        var research = new PermissionPolicy { Stage = "research", Cascade = [ResearchRules] };
        Assert.StartsWith("cascade:frostaura:research:deny:*", research.Decide("read_file", ToolEffect.ReadOnly, Targets("a.cs", null), true).Rule, StringComparison.Ordinal);
    }

    [Fact]
    public void An_unreadable_deny_rule_denies_everything_rather_than_nothing()
    {
        var broken = CascadeRuleSet.FromJson("all", "frostaura", JsonNode.Parse("""{ "deny": ["((not a rule"] }"""));
        var policy = new PermissionPolicy { Cascade = [broken], Allow = [PermissionRule.Parse("write_file")] };
        Assert.Equal(PermissionVerdict.Deny, policy.Decide("write_file", ToolEffect.WritesFiles, Targets("a.cs", null), true).Verdict);
    }

    [Fact]
    public async Task Unattended_an_ask_without_a_checkpoint_is_denied_and_the_event_names_the_rule()
    {
        var ws = new FakeWorkspace();
        var model = new ScriptedModel().ThenTool("run", new { command = "make deploy" }).ThenText("Could not deploy.");
        var agent = TestAgents.Builder(change: a => a with { Permissions = new PermissionPolicy() });
        var (_, log) = await TestAgents.RunAsync(agent, model, ws);
        var denied = log.Events.Single(e => e.Type == "tool.denied");
        Assert.Equal("unattended:default:ask", denied.Payload["rule"]!.GetValue<string>());
        Assert.Empty(ws.Commands);
        var result = log.Events.Single(e => e.Type == "tool.result");
        Assert.Contains("Permission denied (unattended:default:ask)", result.Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(true, "tool.permitted", "checkpoint:frostaura:write_file(infra/**):approved")]
    [InlineData(false, "tool.denied", "checkpoint:frostaura:write_file(infra/**):rejected")]
    public async Task With_a_checkpoint_the_run_raises_an_approval_and_waits_for_the_answer(bool approve, string type, string rule)
    {
        var ws = new FakeWorkspace();
        var gate = new RecordingApprovals(approve);
        var model = new ScriptedModel().ThenTool("write_file", new { path = "infra/main.tf", content = "x" }).ThenText("Done.");
        var agent = TestAgents.Builder(change: a => a with { Permissions = new PermissionPolicy { Cascade = [OrgRules] } });
        var (_, log) = await TestAgents.RunAsync(agent, model, ws, services: TestAgents.Services(model) with { Approvals = gate });
        Assert.Single(gate.Asked);
        // The owner reads the title in plain words; the tool and its file are the detail (technical mode).
        Assert.Equal("Let the agent change part of the app?", gate.Asked[0]);
        Assert.Contains("write_file: infra/main.tf", gate.Details[0], StringComparison.Ordinal);
        var decision = log.Events.Single(e => e.Type is "tool.permitted" or "tool.denied");
        Assert.Equal(type, decision.Type);
        Assert.Equal(rule, decision.Payload["rule"]!.GetValue<string>());
        Assert.Equal(approve, ws.Files.ContainsKey("/workspace/infra/main.tf"));
    }

    [Fact]
    public async Task Every_tool_call_is_checked_and_every_decision_is_an_event()
    {
        var ws = new FakeWorkspace().With("a.txt", "hello\n");
        var model = new ScriptedModel()
            .Then(_ => ScriptedModel.Tools(("read_file", new { path = "a.txt" }, null), ("write_file", new { path = ".git/config", content = "x" }, null), ("edit_file", new { path = "a.txt", old_string = "hello", new_string = "bye" }, null)))
            .ThenText("Done.");
        var (_, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, ws);
        var decisions = log.Events.Where(e => e.Type is "tool.permitted" or "tool.denied").Select(e => (e.Type, Rule: e.Payload["rule"]!.GetValue<string>())).ToList();
        Assert.Equal([("tool.permitted", "default:read-only"), ("tool.denied", "floor:.git"), ("tool.permitted", "allow:edit_file")], decisions);
        Assert.Equal("bye\n", ws.Text("a.txt"));
    }

    private static PermissionPolicy Policy() => new()
    {
        ProtectedPaths = ["vendor/**", "api/Migrations/*.Designer.cs"],
        Deny = [PermissionRule.Parse("run(rm -rf*)")],
        Allow = [PermissionRule.Parse("write_file"), PermissionRule.Parse("vendor_never")],
        Cascade = [BuildRules, OrgRules, ResearchRules],
    };

    private static ToolTargets Targets(string? path, string? command) =>
        new(path is null ? [] : [WorkspacePath.Resolve(path, "/workspace").Path!], command);

    private sealed class RecordingApprovals(bool answer) : IApprovalGate
    {
        public List<string> Asked { get; } = [];

        public List<string> Details { get; } = [];

        public Task<bool> RequestAsync(string title, string detail, CancellationToken cancellationToken)
        {
            Asked.Add(title);
            Details.Add(detail);
            return Task.FromResult(answer);
        }
    }
}
