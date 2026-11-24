using System.Diagnostics;
using System.Text;

namespace Endgame.Dock.Repositories;

/// <summary>A failed git command, with what it said on standard error.</summary>
public sealed class GitException(string message, int exitCode, string stderr) : Exception(message)
{
    public int ExitCode { get; } = exitCode;

    public string Stderr { get; } = stderr;
}

/// <summary>
/// Runs the plain <c>git</c> CLI. No user or system configuration is read, hooks never run, and
/// nothing ever prompts — every command behaves the same on every machine.
/// </summary>
public static class GitCli
{
    public static async Task<string> RunAsync(string? workingDirectory, IEnumerable<string> arguments, IReadOnlyDictionary<string, string>? environment = null, CancellationToken cancellationToken = default)
    {
        var (exit, stdout, stderr) = await RunRawAsync(workingDirectory, arguments, environment, cancellationToken);
        if (exit != 0)
        {
            throw new GitException($"git {string.Join(' ', arguments.Take(3))} failed ({exit}): {stderr.Trim()}", exit, stderr);
        }

        return stdout;
    }

    public static async Task<(int ExitCode, string Stdout, string Stderr)> RunRawAsync(string? workingDirectory, IEnumerable<string> arguments, IReadOnlyDictionary<string, string>? environment = null, CancellationToken cancellationToken = default)
    {
        var start = new ProcessStartInfo("git")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        if (workingDirectory is not null)
        {
            start.WorkingDirectory = workingDirectory;
        }

        foreach (var setting in new[] { "core.hooksPath=/dev/null", "init.defaultBranch=main", "advice.detachedHead=false", "core.autocrlf=false" })
        {
            start.ArgumentList.Add("-c");
            start.ArgumentList.Add(setting);
        }

        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        start.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        start.Environment["GIT_CONFIG_GLOBAL"] = "/dev/null";
        start.Environment["GIT_TERMINAL_PROMPT"] = "0";
        start.Environment["LC_ALL"] = "C";
        foreach (var (key, value) in environment ?? new Dictionary<string, string>())
        {
            start.Environment[key] = value;
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("git could not be started.");
        var stdout = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderr = process.StandardError.ReadToEndAsync(cancellationToken);
        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        return (process.ExitCode, await stdout, await stderr);
    }
}
