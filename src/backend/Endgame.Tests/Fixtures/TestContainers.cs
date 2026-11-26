using System.Diagnostics;
using System.Globalization;
using Endgame.Tests.Hosting;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// Who owns a container the tests started, and whether that owner is gone (R3-3). One day of test runs left 54 anonymous
/// volumes holding 74.9 GB: the throwaway PostgreSQL was removed with <c>docker rm -f</c> (which, unlike the daemon's own
/// <c>--rm</c>, keeps the container's anonymous volumes), and a test host that crashed or was killed left its container
/// running for ever. Now every container a test starts carries <see cref="OwnerLabel"/> (the test host's process id) and
/// <see cref="StartedLabel"/> (that process's start time), is removed with its volumes, and each fixture first removes the
/// containers of test hosts that are no longer running — only containers labelled as this project's tests, never a stack's
/// (<c>endgame-*</c>), another project's, or a named volume.
/// </summary>
public static class TestContainers
{
    /// <summary>Every container this project's tests start carries this label.</summary>
    public const string Label = "endgame-tests";

    /// <summary>The process id of the test host that started the container.</summary>
    public const string OwnerLabel = "endgame-tests.pid";

    /// <summary>That process's start time (Unix seconds): a reused process id is a different owner.</summary>
    public const string StartedLabel = "endgame-tests.started";

    /// <summary>A container from before the owner labels is stale once it is older than any test run.</summary>
    public static readonly TimeSpan UnlabelledAfter = TimeSpan.FromHours(3);

    /// <summary>The labels for a container this test host starts.</summary>
    public static string[] Labels()
    {
        using var self = Process.GetCurrentProcess();
        return ["--label", $"{Label}=1", "--label", $"{OwnerLabel}={Environment.ProcessId}", "--label", $"{StartedLabel}={new DateTimeOffset(self.StartTime).ToUnixTimeSeconds()}"];
    }

    /// <summary>
    /// Whether a test container's owner is gone: its process is not running, or the process now holding that id started after
    /// the owner did. One with no owner labels (from before them) is stale once older than <see cref="UnlabelledAfter"/>.
    /// </summary>
    public static bool IsStale(string? pid, string? started, DateTimeOffset created, DateTimeOffset now, Func<int, DateTimeOffset?> processStart)
    {
        ArgumentNullException.ThrowIfNull(processStart);
        if (!int.TryParse(pid, NumberStyles.None, CultureInfo.InvariantCulture, out var id))
        {
            return now - created > UnlabelledAfter;
        }

        if (processStart(id) is not { } running)
        {
            return true;
        }

        return long.TryParse(started, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) && Math.Abs(running.ToUnixTimeSeconds() - seconds) > 2;
    }

    /// <summary>When the process with this id started, or null when none is running.</summary>
    public static DateTimeOffset? ProcessStart(int id)
    {
        try
        {
            using var process = Process.GetProcessById(id);
            return process.HasExited ? null : new DateTimeOffset(process.StartTime);
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// Removes, with their anonymous volumes, the containers labelled <see cref="Label"/> whose test host is gone; returns their
    /// names. Named volumes are never removed here. <paramref name="value"/> is the label's value: <c>1</c> for every test
    /// container; the sweep's own test uses a value of its own, so a fixture sweeping in parallel never races it.
    /// </summary>
    public static async Task<IReadOnlyList<string>> RemoveStaleAsync(string value = "1")
    {
        var listed = await DockerCli.CheckedAsync(TimeSpan.FromMinutes(1), "ps", "-a", "--filter", $"label={Label}={value}", "--format", "{{.Names}}");
        var removed = new List<string>();
        foreach (var name in listed.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var (exit, facts, _) = await DockerCli.RunAsync(TimeSpan.FromSeconds(30), "inspect", "-f",
                $"{{{{index .Config.Labels \"{OwnerLabel}\"}}}}|{{{{index .Config.Labels \"{StartedLabel}\"}}}}|{{{{.Created}}}}", name);
            var parts = facts.Trim().Split('|');
            if (exit != 0 || parts.Length != 3 || !DateTimeOffset.TryParse(parts[2], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var created))
            {
                continue;
            }

            if (IsStale(parts[0], parts[1], created, DateTimeOffset.UtcNow, ProcessStart))
            {
                await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", "-v", name);
                removed.Add(name);
            }
        }

        return removed;
    }
}
