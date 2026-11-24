using System.Net;
using System.Net.Http.Json;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Hosting.Contracts;

namespace Endgame.Harness.Workspaces;

/// <summary>
/// <see cref="IWorkspace"/> over Dock's internal API (ARCH-004): the harness never touches Docker.
/// Reads go through <c>exec base64</c> so bytes, and therefore line endings, survive exactly;
/// writes through <c>PUT files</c> with base64 content, which Dock checks against its own floor.
/// </summary>
public sealed class DockWorkspace(HttpClient dock, Guid runId, string root = "/workspace") : IWorkspace
{
    /// <summary>Dock's largest exec output: a file read is refused above roughly three quarters of it.</summary>
    public const int MaxReadOutputBytes = 4 * 1024 * 1024;

    public Guid RunId { get; } = runId;

    public string Root { get; } = root;

    public async Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken)
    {
        var result = await ExecAsync(new WorkspaceCommand(
            ["bash", "-c", "if [ -f \"$1\" ]; then base64 -w 0 -- \"$1\"; else exit 3; fi", "read", absolutePath],
            null, 60, MaxReadOutputBytes), cancellationToken);
        if (result.ExitCode == 3)
        {
            return null;
        }

        if (result.ExitCode != 0)
        {
            throw new WorkspaceException($"Reading the file failed: {OutputText.Truncate(result.Stderr, 400)}");
        }

        if (result.Truncated)
        {
            throw new WorkspaceException("The file is too large to read whole (about 3 MB is the limit).", DockProblemCodes.TooLarge);
        }

        try
        {
            return Convert.FromBase64String(result.Stdout.Trim());
        }
        catch (FormatException)
        {
            throw new WorkspaceException("The file's bytes did not come back intact.");
        }
    }

    public async Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var request = new WriteFileRequest(absolutePath, Convert.ToBase64String(content), "base64");
        using var response = await dock.PutAsJsonAsync($"/internal/workspaces/{RunId:D}/files", request, Json.Web, cancellationToken);
        await EnsureAsync(response, cancellationToken);
    }

    public async Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);
        var environment = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            // ARCH-006: tool output with colour codes switched off.
            ["NO_COLOR"] = "1",
            ["FORCE_COLOR"] = "0",
            ["TERM"] = "dumb",
            ["DOTNET_CONSOLE_ANSI_COLOR"] = "false",
        };
        foreach (var (key, value) in command.Environment ?? new Dictionary<string, string>())
        {
            environment[key] = value;
        }

        var request = new ExecRequest(command.Argv, command.Shell, command.TimeoutSeconds, command.MaxOutputBytes, command.WorkingDirectory, environment);
        using var response = await dock.PostAsJsonAsync($"/internal/workspaces/{RunId:D}/exec", request, Json.Web, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<ExecResult>(Json.Web, cancellationToken)
            ?? throw new WorkspaceException("Dock answered an exec with no body.");
        return new WorkspaceExec(result.ExitCode, result.Stdout, result.Stderr, result.TimedOut, result.Truncated, result.DurationMs);
    }

    public async Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken)
    {
        using var response = await dock.PostAsJsonAsync($"/internal/workspaces/{RunId:D}/commit", new WorkspaceCommitRequest(message, authorName, authorEmail), Json.Web, cancellationToken);
        await EnsureAsync(response, cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<WorkspaceCommitResult>(Json.Web, cancellationToken)
            ?? throw new WorkspaceException("Dock answered a commit with no body.");
        return new WorkspaceCommit(result.CommitId, result.Changed);
    }

    private static async Task EnsureAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var problem = await ServiceProblemException.FromAsync(response, cancellationToken);
        throw response.StatusCode == HttpStatusCode.NotFound && problem.Code == DockProblemCodes.NotFound
            ? new WorkspaceException($"Dock: {problem.Detail}", DockProblemCodes.NotFound)
            : new WorkspaceException($"Dock refused: {problem.Detail}", problem.Code);
    }
}
