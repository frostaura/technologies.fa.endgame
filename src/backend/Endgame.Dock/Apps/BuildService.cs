using System.Diagnostics;
using System.Security.Cryptography;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Api;
using Endgame.Dock.Egress;
using Endgame.Dock.Engine;
using Endgame.Dock.Policy;
using Endgame.Dock.Repositories;
using Endgame.Dock.Workspaces;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Apps;

/// <summary>
/// Builds an app's image from a commit (ARCH-005): in a throwaway container of the workspace image
/// with no socket, on an internal network whose only way out is the egress proxy to the package
/// registries. The build writes an image archive; Dock loads it through the Engine API.
/// </summary>
public sealed class BuildService(
    DockerClient docker,
    ContainerExec exec,
    ContainerFiles files,
    NetworkManager networks,
    EgressManager egress,
    RepositoryService repositories,
    WorkspaceImage workspaceImage,
    ResourceNames names,
    IOptions<DockOptions> options,
    ILogger<BuildService> logger)
{
    private const string User = "1654:1654";
    private const string ArchivePath = "/out/image.tar.gz";
    private readonly SemaphoreSlim concurrent = new(2, 2);

    public async Task<BuildResult> BuildAsync(Guid appId, BuildRequest request, CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();
        var commit = await repositories.ResolveAsync(appId, request.Ref, cancellationToken);
        var image = $"{names.AppImageRepository(appId)}:{commit}";
        if (await ExistsAsync(image, cancellationToken))
        {
            return new BuildResult(appId, commit, image, clock.ElapsedMilliseconds, "This version was already built.");
        }

        var builder = workspaceImage.Require();
        await concurrent.WaitAsync(cancellationToken);
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        var container = names.BuildContainer(appId, nonce);
        var network = names.BuildNetwork(appId, nonce);
        try
        {
            var o = options.Value;
            var subnet = await networks.EnsureAsync(network, names.Labels(ResourceNames.BuildNetworkKind, appId), NetworkPeers.Egress, cancellationToken);
            await egress.SetAsync(network, subnet, o.PackageRegistries, platform: false, cancellationToken);
            var proxy = $"http://{o.Peers.EgressAlias}:{o.Peers.EgressPort}";
            await docker.Containers.CreateContainerAsync(new CreateContainerParameters
            {
                Name = container,
                Image = builder,
                User = User,
                Cmd = ["sleep", "infinity"],
                Env = [$"HTTP_PROXY={proxy}", $"HTTPS_PROXY={proxy}", $"http_proxy={proxy}", $"https_proxy={proxy}", "NO_PROXY=localhost,127.0.0.1", "HOME=/home/app"],
                Labels = names.Labels(ResourceNames.BuildKind, appId),
                HostConfig = Hardening.Workspace(o.BuildLimits, network),
                NetworkingConfig = new NetworkingConfig { EndpointsConfig = new Dictionary<string, EndpointSettings> { [network] = new() } },
            }, cancellationToken);
            await docker.Containers.StartContainerAsync(container, new ContainerStartParameters(), cancellationToken);

            var tree = await repositories.TarAsync(appId, commit, cancellationToken);
            try
            {
                await using var source = File.OpenRead(tree);
                using var owned = new MemoryStream();
                await TarOwnership.RewriteAsync(source, owned, WorkspaceService.Uid, cancellationToken);
                owned.Position = 0;
                await files.WriteArchiveAsync(container, "/src", owned, cancellationToken);
            }
            finally
            {
                RepositoryService.TryDelete(tree);
            }

            var result = await exec.RunAsync(container, ["endgame-build", "/src", names.AppImageRepository(appId), commit, ArchivePath],
                TimeSpan.FromSeconds(o.BuildTimeoutSeconds), 48 * 1024, User, "/src", cancellationToken: cancellationToken);
            var log = (result.Stdout + "\n" + result.Stderr).Trim();
            if (result.ExitCode != 0)
            {
                logger.LogWarning("The build of app {AppId} at {Commit} failed ({Code}).", appId, commit[..12], result.ExitCode);
                throw new DockProblem(StatusCodes.Status422UnprocessableEntity, DockProblemCodes.BuildFailed,
                    result.TimedOut ? "The build took too long and was stopped." : "The app did not build.", Tail(log));
            }

            await using (var archive = await files.OpenReadAsync(container, ArchivePath, long.MaxValue, cancellationToken)
                ?? throw new DockProblem(StatusCodes.Status422UnprocessableEntity, DockProblemCodes.BuildFailed, "The build produced no image.", Tail(log)))
            {
                await docker.Images.LoadImageAsync(new ImageLoadParameters { Quiet = true }, archive, new Progress<JSONMessage>(), cancellationToken);
            }

            if (!await ExistsAsync(image, cancellationToken))
            {
                throw new DockProblem(StatusCodes.Status422UnprocessableEntity, DockProblemCodes.BuildFailed, "The built image could not be loaded.", Tail(log));
            }

            logger.LogInformation("Built app {AppId} at {Commit} in {Seconds:F1}s.", appId, commit[..12], clock.Elapsed.TotalSeconds);
            return new BuildResult(appId, commit, image, clock.ElapsedMilliseconds, Tail(log));
        }
        finally
        {
            concurrent.Release();
            try
            {
                await docker.Containers.RemoveContainerAsync(container, new ContainerRemoveParameters { Force = true, RemoveVolumes = true }, CancellationToken.None);
            }
            catch (Exception e) when (EngineErrors.IsNotFound(e))
            {
            }

            await networks.RemoveAsync(network, CancellationToken.None);
            await egress.RemoveAsync(network, CancellationToken.None);
        }
    }

    private async Task<bool> ExistsAsync(string image, CancellationToken cancellationToken)
    {
        try
        {
            await docker.Images.InspectImageAsync(image, cancellationToken);
            return true;
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            return false;
        }
    }

    private static string Tail(string log) => log.Length <= 4000 ? log : "…" + log[^4000..];
}
