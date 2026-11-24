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
    /// <summary>Everything the tests create starts with this; nothing else is ever touched.</summary>
    public const string Prefix = "test-endgame-";

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
