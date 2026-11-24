using System.Xml.Linq;

namespace Endgame.Tests.Architecture;

/// <summary>
/// The layering and the Docker boundary, enforced from the project files themselves — so a new
/// reference fails CI the day it is added, not the day somebody notices it.
/// </summary>
public sealed class ArchitectureTests
{
    private const string DockerClientPackage = "Docker.DotNet.Enhanced";
    private const string DockProject = "Endgame.Dock";

    private static readonly DirectoryInfo BackendRoot = FindBackendRoot();

    private static readonly IReadOnlyDictionary<string, ProjectFile> Projects = BackendRoot
        .EnumerateFiles("*.csproj", SearchOption.AllDirectories)
        .Where(f => !f.FullName.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
        // Test fixtures (an app the hosting tests build inside a container) are not solution projects.
        .Where(f => !f.FullName.Contains($"{Path.DirectorySeparatorChar}Fixtures{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
        .Select(ProjectFile.Load)
        .ToDictionary(p => p.Name, StringComparer.Ordinal);

    [Fact]
    public void Every_project_in_the_solution_was_found() =>
        Assert.Equal(
            ["Endgame.Application", "Endgame.ControlPlane", "Endgame.Dock", "Endgame.Domain", "Endgame.Edge", "Endgame.Hosting.Contracts", "Endgame.Infrastructure", "Endgame.Runner", "Endgame.Tests"],
            Projects.Keys.Order(StringComparer.Ordinal));

    [Fact]
    public void Domain_references_no_other_project_and_no_package()
    {
        var domain = Projects["Endgame.Domain"];
        Assert.Empty(domain.ProjectReferences);
        Assert.Empty(domain.PackageReferences);
    }

    [Fact]
    public void Domain_does_not_reach_infrastructure_directly_or_transitively()
    {
        Assert.DoesNotContain("Endgame.Infrastructure", Closure("Endgame.Domain"));
        Assert.DoesNotContain("Endgame.Infrastructure", Closure("Endgame.Application"));

        // The compiled assembly too: a reference added by any other route would show here.
        var referenced = typeof(Endgame.Domain.Tree.Organisation).Assembly.GetReferencedAssemblies().Select(a => a.Name);
        Assert.DoesNotContain(referenced, n => n is not null && n.StartsWith("Endgame.", StringComparison.Ordinal));
    }

    [Fact]
    public void Only_dock_references_the_docker_client_package()
    {
        var offenders = Projects.Values
            .Where(p => p.Name != DockProject)
            .Where(p => Closure(p.Name).Prepend(p.Name).Any(name => Projects[name].PackageReferences.Contains(DockerClientPackage)))
            .Select(p => p.Name)
            .ToList();
        Assert.Empty(offenders);
        Assert.Contains(DockerClientPackage, Projects[DockProject].PackageReferences);
    }

    [Fact]
    public void No_project_references_dock()
    {
        var offenders = Projects.Values.Where(p => p.ProjectReferences.Contains(DockProject)).Select(p => p.Name).ToList();
        Assert.Empty(offenders);
    }

    [Fact]
    public void The_docker_client_is_not_loaded_into_the_tested_services() =>
        Assert.DoesNotContain(AppDomain.CurrentDomain.GetAssemblies(), a => a.GetName().Name?.StartsWith("Docker.DotNet", StringComparison.Ordinal) == true);

    /// <summary>Every project reachable from <paramref name="name"/> by project references.</summary>
    private static HashSet<string> Closure(string name)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>(Projects[name].ProjectReferences);
        while (pending.TryPop(out var next))
        {
            if (seen.Add(next))
            {
                foreach (var reference in Projects[next].ProjectReferences)
                {
                    pending.Push(reference);
                }
            }
        }

        return seen;
    }

    private static DirectoryInfo FindBackendRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Endgame.slnx")))
            {
                return dir;
            }
        }

        throw new InvalidOperationException("Endgame.slnx was not found above the test output directory.");
    }

    private sealed record ProjectFile(string Name, IReadOnlySet<string> ProjectReferences, IReadOnlySet<string> PackageReferences)
    {
        public static ProjectFile Load(FileInfo file)
        {
            var xml = XDocument.Load(file.FullName);
            var projects = xml.Descendants("ProjectReference")
                .Select(e => Path.GetFileNameWithoutExtension(((string?)e.Attribute("Include") ?? "").Replace('\\', '/')))
                .ToHashSet(StringComparer.Ordinal);
            var packages = xml.Descendants("PackageReference")
                .Select(e => (string?)e.Attribute("Include") ?? "")
                .ToHashSet(StringComparer.Ordinal);
            return new ProjectFile(Path.GetFileNameWithoutExtension(file.Name), projects, packages);
        }
    }
}
