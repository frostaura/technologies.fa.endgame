using System.Diagnostics;
using System.Globalization;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Engine;

/// <summary>Runs a process inside a container through the Engine API and captures its output.</summary>
public sealed class ContainerExec(DockerClient docker)
{
    /// <summary>Exit code <c>timeout</c> reports when it had to stop the command.</summary>
    private const int TimeoutExitCode = 124;

    /// <summary>
    /// Runs <paramref name="argv"/> under coreutils <c>timeout</c>, which kills the whole command
    /// when time runs out — the Engine API itself cannot stop an exec once started.
    /// </summary>
    public async Task<ExecResult> RunAsync(
        string container,
        IReadOnlyList<string> argv,
        TimeSpan timeout,
        int maxOutputBytes,
        string? user = null,
        string? workingDirectory = null,
        IEnumerable<string>? environment = null,
        CancellationToken cancellationToken = default)
    {
        var seconds = Math.Max(1, (int)Math.Ceiling(timeout.TotalSeconds));
        var command = new List<string> { "timeout", "-k", "3", seconds.ToString(CultureInfo.InvariantCulture) }; // short options: busybox (the proxy) and coreutils both take them
        command.AddRange(argv);
        var clock = Stopwatch.StartNew();
        var exec = await docker.Exec.CreateContainerExecAsync(container, new ContainerExecCreateParameters
        {
            Cmd = command,
            AttachStdout = true,
            AttachStderr = true,
            User = user ?? "",
            WorkingDir = workingDirectory ?? "",
            Env = environment?.ToList() ?? [],
        }, cancellationToken);

        var stdout = new OutputCapture(maxOutputBytes);
        var stderr = new OutputCapture(maxOutputBytes);
        // The command's own timeout fires first; this is the backstop for a stream that never closes.
        using var backstop = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        backstop.CancelAfter(timeout + TimeSpan.FromSeconds(15));
        using (var stream = await docker.Exec.StartContainerExecAsync(exec.ID, new ContainerExecStartParameters(), backstop.Token))
        {
            var buffer = new byte[81920];
            while (true)
            {
                var read = await stream.ReadOutputAsync(buffer, 0, buffer.Length, backstop.Token);
                if (read.EOF)
                {
                    break;
                }

                (read.Target == MultiplexedStream.TargetStream.StandardError ? stderr : stdout).Append(buffer.AsSpan(0, read.Count));
            }
        }

        var exitCode = -1;
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var inspect = await docker.Exec.InspectContainerExecAsync(exec.ID, cancellationToken);
            if (!inspect.Running)
            {
                exitCode = (int)(inspect.ExitCode ?? -1);
                break;
            }

            await Task.Delay(20, cancellationToken);
        }

        var timedOut = exitCode == TimeoutExitCode || (exitCode == 137 && clock.Elapsed >= timeout);
        return new ExecResult(exitCode, stdout.ToString(), stderr.ToString(), stdout.Truncated || stderr.Truncated, timedOut, clock.ElapsedMilliseconds);
    }

    /// <summary>Runs a short command that must succeed; returns its standard output.</summary>
    public async Task<string> RunCheckedAsync(string container, IReadOnlyList<string> argv, string? user = null, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(container, argv, timeout ?? TimeSpan.FromSeconds(30), 1024 * 1024, user, null, null, cancellationToken);
        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException($"`{string.Join(' ', argv)}` exited {result.ExitCode}: {result.Stderr.Trim()}");
        }

        return result.Stdout;
    }
}
