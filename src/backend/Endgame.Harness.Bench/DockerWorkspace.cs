using System.Diagnostics;
using System.Globalization;
using System.Text;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Bench;

/// <summary>
/// One fresh workspace container per task run (ARCH-006, <i>The workspace</i>): no network, no
/// capabilities, no new privileges, not root, no socket, limits on CPU, memory and processes. The
/// benchmark drives it with the Docker CLI, as Dock does through the Engine API in production; every
/// container it creates is named <c>test-endgame-bench-…</c> and removed when the run ends.
/// </summary>
public sealed class DockerWorkspace : IWorkspace, IAsyncDisposable
{
    public const string Prefix = "test-endgame-bench-";

    private DockerWorkspace(string name) => Name = name;

    public string Name { get; }

    public string Root => "/workspace";

    public static async Task<DockerWorkspace> StartAsync(string image, string id, CancellationToken cancellationToken)
    {
        var name = Prefix + id;
        var run = await Proc.RunAsync("docker",
            ["run", "-d", "--name", name, "--label", "endgame-bench=1", "--network", "none", "--cpus", "2", "--memory", "3g", "--memory-swap", "3g",
             "--pids-limit", "1024", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "agent", image],
            null, TimeSpan.FromMinutes(2), cancellationToken);
        if (run.ExitCode != 0)
        {
            throw new WorkspaceException($"docker run failed: {run.Stdout}{run.Stderr}");
        }

        var workspace = new DockerWorkspace(name);
        var seed = await workspace.ExecAsync(WorkspaceCommand.Line("cp -a /seed/. /workspace/"), cancellationToken);
        if (seed.ExitCode != 0)
        {
            throw new WorkspaceException($"Seeding the workspace failed: {seed.Combined}");
        }

        return workspace;
    }

    public async Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken)
    {
        var result = await Proc.RunAsync("docker", ["exec", "-w", Root, Name, "bash", "-c", "if [ -f \"$1\" ]; then base64 -w 0 -- \"$1\"; else exit 3; fi", "read", absolutePath], null, TimeSpan.FromMinutes(1), cancellationToken);
        return result.ExitCode switch
        {
            0 => Convert.FromBase64String(result.Stdout.Trim()),
            3 => null,
            _ => throw new WorkspaceException($"Reading failed: {result.Stderr}"),
        };
    }

    public async Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken)
    {
        // The path the container resolves, through any link, must stay under the root and out of .git.
        var real = await Proc.RunAsync("docker", ["exec", Name, "realpath", "-m", "--", absolutePath], null, TimeSpan.FromSeconds(30), cancellationToken);
        var resolved = real.Stdout.Trim();
        if (real.ExitCode != 0 || !(resolved == Root || resolved.StartsWith(Root + "/", StringComparison.Ordinal)) || resolved.Split('/').Contains(".git"))
        {
            throw new WorkspaceException($"'{absolutePath}' resolves to '{resolved}', outside the workspace or inside .git.", "protected_path");
        }

        var result = await Proc.RunAsync("docker", ["exec", "-i", Name, "sh", "-c", "mkdir -p \"$(dirname \"$1\")\" && base64 -d > \"$1\"", "sh", resolved], Convert.ToBase64String(content), TimeSpan.FromMinutes(1), cancellationToken);
        if (result.ExitCode != 0)
        {
            throw new WorkspaceException($"Writing failed: {result.Stderr}");
        }
    }

    public async Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        var argv = new List<string> { "exec", "-w", command.WorkingDirectory ?? Root, "-e", "NO_COLOR=1", "-e", "FORCE_COLOR=0", "-e", "TERM=dumb" };
        foreach (var (key, value) in command.Environment ?? new Dictionary<string, string>())
        {
            argv.AddRange(["-e", $"{key}={value}"]);
        }

        argv.Add(Name);
        argv.AddRange(["timeout", "-k", "5", command.TimeoutSeconds.ToString(CultureInfo.InvariantCulture)]);
        argv.AddRange(command.Argv ?? ["bash", "-lc", command.Shell!]);
        var clock = Stopwatch.StartNew();
        var result = await Proc.RunAsync("docker", argv, null, TimeSpan.FromSeconds(command.TimeoutSeconds + 30), cancellationToken);
        var timedOut = result.TimedOut || result.ExitCode == 124;
        var (stdout, cutOut) = Cap(result.Stdout, command.MaxOutputBytes);
        var (stderr, cutErr) = Cap(result.Stderr, command.MaxOutputBytes);
        return new WorkspaceExec(result.ExitCode, stdout, stderr, timedOut, cutOut || cutErr, clock.ElapsedMilliseconds);
    }

    public async Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken)
    {
        var result = await ExecAsync(new WorkspaceCommand(["bash", "-c", "git add -A && (git diff --cached --quiet && git rev-parse HEAD || (git -c user.name=\"$1\" -c user.email=\"$2\" commit -qm \"$3\" && git rev-parse HEAD && echo changed))", "commit", authorName, authorEmail, message], null, 120), cancellationToken);
        if (result.ExitCode != 0)
        {
            throw new WorkspaceException($"The commit failed: {result.Combined}");
        }

        var lines = result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return new WorkspaceCommit(lines[0].Trim(), lines.Length > 1 && lines[^1].Trim() == "changed");
    }

    /// <summary>Copies a host directory into the workspace, as the agent's own user.</summary>
    public async Task OverlayAsync(string hostDirectory, CancellationToken cancellationToken)
    {
        if (!Directory.Exists(hostDirectory))
        {
            return;
        }

        foreach (var file in Directory.EnumerateFiles(hostDirectory, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(hostDirectory, file).Replace('\\', '/');
            await WriteBytesAsync($"{Root}/{relative}", await File.ReadAllBytesAsync(file, cancellationToken), cancellationToken);
        }
    }

    public async ValueTask DisposeAsync() => await Proc.RunAsync("docker", ["rm", "-f", Name], null, TimeSpan.FromMinutes(1), CancellationToken.None);

    private static (string Text, bool Cut) Cap(string text, int maxBytes)
    {
        if (Encoding.UTF8.GetByteCount(text) <= maxBytes)
        {
            return (text, false);
        }

        var keep = Math.Max(256, maxBytes / 2);
        return (string.Concat(text.AsSpan(0, Math.Min(text.Length, keep / 3)), "\n... [output cut] ...\n", text.AsSpan(Math.Max(0, text.Length - (keep * 2 / 3)))), true);
    }
}

public sealed record ProcResult(int ExitCode, string Stdout, string Stderr, bool TimedOut);

/// <summary>Runs a program with an argument vector (never a host shell), optional stdin, and a hard timeout. Output is read raw.</summary>
public static class Proc
{
    public static async Task<ProcResult> RunAsync(string file, IEnumerable<string> args, string? stdin, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var info = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = stdin is not null,
            UseShellExecute = false,
        };
        foreach (var a in args)
        {
            info.ArgumentList.Add(a);
        }

        using var process = Process.Start(info) ?? throw new InvalidOperationException($"{file} could not be started.");
        var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
        if (stdin is not null)
        {
            await process.StandardInput.WriteAsync(stdin);
            process.StandardInput.Close();
        }

        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(limit.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            return new ProcResult(-1, await stdout, await stderr, true);
        }

        return new ProcResult(process.ExitCode, await stdout, await stderr, false);
    }
}
