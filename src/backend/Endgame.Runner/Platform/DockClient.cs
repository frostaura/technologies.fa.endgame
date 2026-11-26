using System.Net;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Workspaces;
using Endgame.Hosting.Contracts;

namespace Endgame.Runner.Platform;

/// <summary>
/// Dock's internal API for the Runner: workspaces, repositories, builds and the app lifecycle. The
/// Runner never touches Docker; Dock is the only service holding the socket (CLAUDE.md rule 5).
/// </summary>
public sealed class DockClient(HttpClient http)
{
    public HttpClient Http { get; } = http;

    public async Task<WorkspaceInfo?> GetWorkspaceAsync(Guid runId, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/workspaces/{runId:D}", cancellationToken);
        return response.StatusCode == HttpStatusCode.NotFound ? null : await ReadAsync<WorkspaceInfo>(response, cancellationToken);
    }

    /// <summary>How long a workspace may wait for Dock to finish preparing the workspace image (a fresh stack builds it first).</summary>
    public TimeSpan WorkspaceImageWait { get; init; } = TimeSpan.FromMinutes(20);

    public TimeSpan WorkspaceImagePoll { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// A workspace for the run. While Dock is still preparing the workspace image (503 <c>workspace_image_not_ready</c>, a
    /// fresh stack's first minutes) it waits and asks again, up to <see cref="WorkspaceImageWait"/>: a live build failed
    /// at once when research finished before the image did.
    /// </summary>
    public async Task<WorkspaceInfo> CreateWorkspaceAsync(CreateWorkspaceRequest request, CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + WorkspaceImageWait;
        while (true)
        {
            using var response = await Http.PostAsJsonAsync("/internal/workspaces", request, Json.Web, cancellationToken);
            if (response.StatusCode == HttpStatusCode.ServiceUnavailable && DateTimeOffset.UtcNow < deadline)
            {
                var problem = await ServiceProblemException.FromAsync(response, cancellationToken);
                if (problem.Code == DockProblemCodes.WorkspaceImageNotReady)
                {
                    await Task.Delay(WorkspaceImagePoll, cancellationToken);
                    continue;
                }

                throw new WorkspaceException($"Dock refused: {problem.Detail}", problem.Code);
            }

            return await ReadAsync<WorkspaceInfo>(response, cancellationToken);
        }
    }

    public async Task RenewWorkspaceAsync(Guid runId, DateTimeOffset expiresAt, CancellationToken cancellationToken)
    {
        using var response = await Http.PutAsJsonAsync($"/internal/workspaces/{runId:D}/lease", new RenewLeaseRequest(expiresAt), Json.Web, cancellationToken);
        if (response.StatusCode != HttpStatusCode.NotFound)
        {
            await ReadAsync<WorkspaceInfo>(response, cancellationToken);
        }
    }

    public async Task DestroyWorkspaceAsync(Guid runId, CancellationToken cancellationToken)
    {
        using var response = await Http.DeleteAsync($"/internal/workspaces/{runId:D}", cancellationToken);
        if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
        {
            throw await ServiceProblemException.FromAsync(response, cancellationToken);
        }
    }

    /// <summary>Creates the app's repository from the app-kit template, or finds the one that exists.</summary>
    public async Task<RepositoryInfo> EnsureRepositoryAsync(Guid appId, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync("/internal/repos", new CreateRepositoryRequest(appId), Json.Web, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            using var existing = await Http.GetAsync($"/internal/repos/{appId:D}", cancellationToken);
            return await ReadAsync<RepositoryInfo>(existing, cancellationToken);
        }

        return await ReadAsync<RepositoryInfo>(response, cancellationToken);
    }

    public async Task<BuildResult> BuildAsync(Guid appId, string? reference, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/apps/{appId:D}/build", new BuildRequest(reference), Json.Web, cancellationToken);
        return await ReadAsync<BuildResult>(response, cancellationToken);
    }

    /// <summary>
    /// The run's work as the app's next version (R2-4): one commit on the app's line titled with what the person asked
    /// for. Until this, a run's commits live on its own branch only, so a failed or cancelled run leaves the app's history
    /// as it was.
    /// </summary>
    public async Task<CommitInfo> PublishRunAsync(Guid appId, Guid runId, PublishRunRequest request, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/repos/{appId:D}/runs/{runId:D}/publish", request, Json.Web, cancellationToken);
        return await ReadAsync<CommitInfo>(response, cancellationToken);
    }

    /// <summary>The run's own newest work, built for its preview: its branch, or where it started when it has committed nothing yet.</summary>
    public async Task<BuildResult> BuildRunAsync(Guid appId, Guid runId, string? startedFrom, CancellationToken cancellationToken)
    {
        try
        {
            return await BuildAsync(appId, RunBranches.Of(runId), cancellationToken);
        }
        catch (WorkspaceException e) when (e.Code == DockProblemCodes.NotFound)
        {
            return await BuildAsync(appId, startedFrom, cancellationToken);
        }
    }

    /// <summary>Starts the app privately: Dock never makes an app public; going public is a human act in the console.</summary>
    public async Task<AppStatus> StartAsync(Guid appId, StartAppRequest request, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/apps/{appId:D}/start", request, Json.Web, cancellationToken);
        return await ReadAsync<AppStatus>(response, cancellationToken);
    }

    /// <summary>The evaluator's preview of the app (its own throwaway database), replacing any earlier one.</summary>
    public async Task<AppStatus> StartPreviewAsync(Guid appId, StartAppRequest request, CancellationToken cancellationToken)
    {
        using var response = await Http.PostAsJsonAsync($"/internal/apps/{appId:D}/preview", request, Json.Web, cancellationToken);
        return await ReadAsync<AppStatus>(response, cancellationToken);
    }

    /// <summary>Destroys the preview and its database.</summary>
    public async Task RemovePreviewAsync(Guid appId, CancellationToken cancellationToken)
    {
        using var response = await Http.DeleteAsync($"/internal/apps/{appId:D}/preview", cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var problem = await ServiceProblemException.FromAsync(response, cancellationToken);
            throw new WorkspaceException($"Dock refused: {problem.Detail}", problem.Code);
        }
    }

    public async Task<AppStatus> StatusAsync(Guid appId, CancellationToken cancellationToken)
    {
        using var response = await Http.GetAsync($"/internal/apps/{appId:D}", cancellationToken);
        return await ReadAsync<AppStatus>(response, cancellationToken);
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
        where T : class
    {
        if (!response.IsSuccessStatusCode)
        {
            var problem = await ServiceProblemException.FromAsync(response, cancellationToken);
            throw new WorkspaceException($"Dock refused: {problem.Detail}", problem.Code);
        }

        return await response.Content.ReadFromJsonAsync<T>(Json.Web, cancellationToken)
            ?? throw new WorkspaceException("Dock answered with no body.");
    }
}

/// <summary>Where a run's workspace comes from. Production: Dock; tests: an in-memory fake.</summary>
public interface IWorkspaceProvider
{
    /// <summary>
    /// The run's workspace: the one Dock still holds for it, or a fresh one at the run's own newest work, else at
    /// <paramref name="startFrom"/> (an earlier attempt's branch, for "Try again"), else at the app's published line.
    /// </summary>
    Task<(IWorkspace Workspace, bool Recreated)> EnsureAsync(Guid runId, Guid appId, DateTimeOffset leaseExpiresAt, string? startFrom, CancellationToken cancellationToken);

    Task RenewAsync(Guid runId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken);

    Task ReleaseAsync(Guid runId, CancellationToken cancellationToken);
}

public sealed class DockWorkspaceProvider(DockClient dock) : IWorkspaceProvider
{
    public async Task<(IWorkspace Workspace, bool Recreated)> EnsureAsync(Guid runId, Guid appId, DateTimeOffset leaseExpiresAt, string? startFrom, CancellationToken cancellationToken)
    {
        if (await dock.GetWorkspaceAsync(runId, cancellationToken) is { } existing)
        {
            await dock.RenewWorkspaceAsync(runId, leaseExpiresAt, cancellationToken);
            return (new DockWorkspace(dock.Http, runId, existing.Root), false);
        }

        await dock.EnsureRepositoryAsync(appId, cancellationToken);
        var created = await dock.CreateWorkspaceAsync(new CreateWorkspaceRequest(runId, appId, startFrom, leaseExpiresAt, null, null), cancellationToken);
        return (new DockWorkspace(dock.Http, runId, created.Root), true);
    }

    public Task RenewAsync(Guid runId, DateTimeOffset leaseExpiresAt, CancellationToken cancellationToken) => dock.RenewWorkspaceAsync(runId, leaseExpiresAt, cancellationToken);

    public Task ReleaseAsync(Guid runId, CancellationToken cancellationToken) => dock.DestroyWorkspaceAsync(runId, cancellationToken);
}
