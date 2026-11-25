using System.Diagnostics;
using System.Text;

namespace Endgame.Tests.Hosting;

/// <summary>
/// The test harness's own hands on the real Docker Engine: the CLI, not a client library, so the
/// test assembly never loads the Docker client (ArchitectureTests) and every command is one a
/// person could rerun by hand.
/// </summary>
public static class DockerCli
{
    /// <summary>
    /// This test run's own id. Two test runs on one machine never share a name, a Dock instance label or a
    /// subnet pool, so neither removes or collides with what the other made.
    /// </summary>
    public static readonly string RunId = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(3)).ToLowerInvariant();

    /// <summary>Everything this run creates starts with this; nothing else is ever touched.</summary>
    public static readonly string Prefix = $"test-endgame-{RunId}-";

    /// <summary>
    /// Images every run may reuse, keyed by their content (the workspace image's tag is a hash of what it is
    /// built from): never removed by a run, so a warm machine skips the slowest build. Remove by hand with
    /// <c>docker images 'test-endgame-shared-*'</c>.
    /// </summary>
    public const string SharedPrefix = "test-endgame-shared-";

    private static readonly Lazy<Task<string>> Pool = new(PickSubnetPoolAsync);

    /// <summary>A private /16 no network on this engine overlaps, chosen once per run, for the Dock under test.</summary>
    public static Task<string> SubnetPoolAsync() => Pool.Value;

    private static async Task<string> PickSubnetPoolAsync()
    {
        var subnets = new List<string>();
        foreach (var id in (await CheckedAsync("network", "ls", "-q")).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var (exit, stdout, _) = await RunAsync(TimeSpan.FromSeconds(15), "network", "inspect", "--format", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", id);
            if (exit == 0)
            {
                subnets.AddRange(stdout.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
            }
        }

        // 10.64.0.0 to 10.127.255.255: clear of the stacks' own pools (10.213 to 10.219) and of Docker's defaults.
        var start = System.Security.Cryptography.RandomNumberGenerator.GetInt32(64);
        for (var i = 0; i < 64; i++)
        {
            var octet = 64 + ((start + i) % 64);
            if (!subnets.Any(s => s.StartsWith($"10.{octet}.", StringComparison.Ordinal)))
            {
                return $"10.{octet}.0.0/16";
            }
        }

        throw new InvalidOperationException("No free 10.x.0.0/16 between 10.64 and 10.127 on this Docker engine.");
    }

    private static readonly Lazy<string?> Unavailable = new(Probe);

    /// <summary>Why the real-Docker tests cannot run here, or null when they can.</summary>
    public static string? WhyUnavailable => Unavailable.Value;

    public static async Task<(int ExitCode, string Stdout, string Stderr)> RunAsync(TimeSpan timeout, params string[] arguments)
    {
        var start = new ProcessStartInfo("docker")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("docker could not be started.");
        using var cancel = new CancellationTokenSource(timeout);
        var stdout = process.StandardOutput.ReadToEndAsync(cancel.Token);
        var stderr = process.StandardError.ReadToEndAsync(cancel.Token);
        try
        {
            await process.WaitForExitAsync(cancel.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"docker {string.Join(' ', arguments.Take(3))} took longer than {timeout}.");
        }

        return (process.ExitCode, await stdout, await stderr);
    }

    public static async Task<string> CheckedAsync(TimeSpan timeout, params string[] arguments)
    {
        var (exit, stdout, stderr) = await RunAsync(timeout, arguments);
        if (exit != 0)
        {
            throw new InvalidOperationException($"docker {string.Join(' ', arguments.Take(4))} failed ({exit}): {stderr.Trim()}\n{stdout.Trim()}");
        }

        return stdout;
    }

    public static Task<string> CheckedAsync(params string[] arguments) => CheckedAsync(TimeSpan.FromMinutes(2), arguments);

    /// <summary>The names of every resource of a kind whose name starts with <see cref="Prefix"/>.</summary>
    public static async Task<IReadOnlyList<string>> OursAsync(string kind)
    {
        string[] list = kind switch
        {
            "container" => ["ps", "-a", "--format", "{{.Names}}"],
            "network" => ["network", "ls", "--format", "{{.Name}}"],
            "volume" => ["volume", "ls", "--format", "{{.Name}}"],
            "image" => ["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"],
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var output = await CheckedAsync(list);
        return output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(n => n.StartsWith(Prefix, StringComparison.Ordinal))
            .ToList();
    }

    /// <summary>Removes every container, network, volume and image the tests (or the Dock under test) made.</summary>
    public static async Task RemoveEverythingOursAsync()
    {
        foreach (var container in await OursAsync("container"))
        {
            await RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", "-v", container);
        }

        foreach (var network in await OursAsync("network"))
        {
            await RunAsync(TimeSpan.FromMinutes(1), "network", "rm", network);
        }

        foreach (var volume in await OursAsync("volume"))
        {
            await RunAsync(TimeSpan.FromMinutes(1), "volume", "rm", "-f", volume);
        }

        foreach (var image in await OursAsync("image"))
        {
            await RunAsync(TimeSpan.FromMinutes(1), "image", "rm", "-f", image);
        }
    }

    private static string? Probe()
    {
        if (Environment.GetEnvironmentVariable("ENDGAME_SKIP_DOCKER_TESTS") is "1" or "true")
        {
            return "ENDGAME_SKIP_DOCKER_TESTS is set";
        }

        try
        {
            var (exit, stdout, stderr) = RunAsync(TimeSpan.FromSeconds(15), "version", "--format", "{{.Server.Version}}").GetAwaiter().GetResult();
            return exit == 0 && stdout.Trim().Length > 0 ? null : $"the Docker Engine did not answer: {stderr.Trim()}";
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or TimeoutException or InvalidOperationException)
        {
            return $"the docker CLI could not be run: {e.Message}";
        }
    }
}

/// <summary>
/// A test that needs the real Docker Engine. Where none is reachable it is reported SKIPPED with
/// the reason — never silently passed.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DockerFactAttribute : FactAttribute
{
    public DockerFactAttribute()
    {
        if (DockerCli.WhyUnavailable is { } reason)
        {
            Skip = $"SKIPPED — real-Docker hosting test not run: {reason}.";
        }
    }
}

/// <summary>
/// A real-Docker test that also needs the app kit's template packed (<c>make -C src/appkit vendor</c>);
/// reported SKIPPED with that instruction when it is not.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DockerWithAppKitFactAttribute : FactAttribute
{
    public DockerWithAppKitFactAttribute()
    {
        if (DockerCli.WhyUnavailable is { } reason)
        {
            Skip = $"SKIPPED — real-Docker hosting test not run: {reason}.";
            return;
        }

        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var vendor = Path.Combine(dir.FullName, "src", "appkit", "template", "vendor", "nuget");
            if (File.Exists(Path.Combine(dir.FullName, "src", "backend", "Endgame.slnx")))
            {
                if (!Directory.Exists(vendor) || !Directory.EnumerateFiles(vendor, "*.nupkg").Any())
                {
                    Skip = "SKIPPED — the app kit's template is not packed: run `make -C src/appkit vendor` first.";
                }

                return;
            }
        }
    }
}
