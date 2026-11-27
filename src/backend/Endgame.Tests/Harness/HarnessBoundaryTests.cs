using System.Xml.Linq;
using Endgame.Runner.Agents;

namespace Endgame.Tests.Harness;

/// <summary>
/// The harness's boundaries, enforced from the project files: no agent framework or SDK of any
/// kind, and the Runner reaches the control plane and Dock only over HTTP — never their code, never
/// the Docker client. Plus the prompts and skills that ship inside the Runner.
/// </summary>
public sealed class HarnessBoundaryTests
{
    private static readonly string[] HarnessProjects = ["Endgame.Harness", "Endgame.Runner", "Endgame.Harness.Bench"];

    [Fact]
    public void The_harness_projects_reference_no_package_at_all()
    {
        foreach (var project in Existing())
        {
            var packages = XDocument.Load(project).Descendants("PackageReference").Select(e => (string?)e.Attribute("Include")).ToList();
            Assert.True(packages.Count == 0, $"{Path.GetFileName(project)} references packages: {string.Join(", ", packages)}. The harness is Endgame's own: no agent framework, SDK or MCP client.");
        }
    }

    [Fact]
    public void The_harness_projects_reach_the_control_plane_and_dock_only_over_http()
    {
        string[] forbidden = ["Endgame.Infrastructure", "Endgame.Application", "Endgame.ControlPlane", "Endgame.Dock", "Endgame.Edge"];
        foreach (var project in Existing())
        {
            var references = XDocument.Load(project).Descendants("ProjectReference").Select(e => Path.GetFileNameWithoutExtension(((string?)e.Attribute("Include") ?? "").Replace('\\', '/'))).ToList();
            Assert.DoesNotContain(references, r => forbidden.Contains(r));
        }
    }

    [Fact]
    public void Every_prompt_and_skill_ships_inside_the_runner()
    {
        var skills = RunnerResources.Skills().All.Select(s => s.Name).ToList();
        Assert.Equal(["add-an-endpoint", "add-an-entity", "build-on-the-app-kit", "security-review-checklist", "write-a-migration", "write-a-screen"], skills);
        foreach (var prompt in new[] { "builder", "planner", "evaluator", "research-contractor", "research-judge", "security-reviewer", "security-repair", "security-docs", "conversation", "task", "repair" })
        {
            Assert.False(string.IsNullOrWhiteSpace(RunnerResources.Prompt(prompt)));
        }

        Assert.DoesNotContain("{{", RunnerResources.Prompt("builder", new Dictionary<string, string> { ["root"] = "/workspace", ["skills"] = "" }), StringComparison.Ordinal);
    }

    private static IEnumerable<string> Existing()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "Endgame.slnx")))
        {
            root = root.Parent;
        }

        Assert.NotNull(root);
        var found = HarnessProjects.Select(p => Path.Combine(root.FullName, p, $"{p}.csproj")).Where(File.Exists).ToList();
        Assert.Contains(found, f => f.EndsWith("Endgame.Harness.csproj", StringComparison.Ordinal));
        return found;
    }
}
