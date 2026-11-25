using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Api;
using Endgame.Dock.Egress;
using Endgame.Dock.Engine;
using Endgame.Dock.Platform;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Apps;

/// <summary>
/// An app's lifecycle (ARCH-004, ARCH-005): provision on first start, start, stop and keep, wake,
/// status. Sleep is stop-and-keep, never remove — the wake time depends on it.
/// </summary>
public sealed class AppService(
    DockerClient docker,
    NetworkManager networks,
    EgressManager egress,
    DatabaseProvisioner databases,
    AppRuntimeRegistry registry,
    WakeGate wakes,
    PlatformReports reports,
    ResourceNames names,
    IOptions<DockOptions> options,
    TimeProvider time,
    ILogger<AppService> logger)
{
    private const string User = "1654:1654";
    private const string LimitsLabel = "endgame.limits";

    /// <summary>How long after Dock stops an app its exit is still taken as asked for.</summary>
    public static readonly TimeSpan StopGrace = TimeSpan.FromSeconds(60);

    public async Task<AppStatus> StartAsync(Guid appId, StartAppRequest request, CancellationToken cancellationToken)
    {
        if (appId == Guid.Empty || request.OrganisationId == Guid.Empty)
        {
            throw DockProblem.Invalid("An app id and an organisation id are required.");
        }

        IReadOnlyList<string>? allowed = null;
        if (request.AllowedHosts is not null)
        {
            allowed = EgressRules.NormaliseAll(request.AllowedHosts, out var rejected);
            if (rejected.Count > 0)
            {
                throw DockProblem.Invalid($"Not host names: {string.Join(", ", rejected)}.");
            }
        }

        var runtime = registry.For(appId);
        await runtime.Lifecycle.WaitAsync(cancellationToken);
        try
        {
            var image = await ResolveImageAsync(appId, request.Image, cancellationToken);
            var commit = image[(image.LastIndexOf(':') + 1)..];
            var o = options.Value;
            var limits = LimitsPolicy.Resolve(request.Limits, o.AppDefaults, o.AppMaxima);
            var network = names.AppNetwork(appId);
            var subnet = await networks.EnsureAsync(network, names.Labels(ResourceNames.AppNetworkKind, appId), NetworkPeers.Edge | NetworkPeers.Postgres | NetworkPeers.Egress, cancellationToken);
            await egress.SetAsync(network, subnet, allowed ?? await egress.HostsAsync(network, cancellationToken), platform: true, cancellationToken);
            var connection = await databases.EnsureAsync(appId, cancellationToken);

            var name = names.AppContainer(appId);
            var existing = await TryInspectAsync(name, cancellationToken);
            var previousCommit = existing?.LabelMap().TryGetValue(ResourceNames.CommitLabel, out var c) == true ? c : null;
            var token = request.AppToken ?? await reports.AppTokenAsync(appId, cancellationToken) ?? ExistingToken(existing)
                ?? throw DockProblem.Unavailable("The control plane did not issue the app's platform token.");
            var limitsText = string.Create(CultureInfo.InvariantCulture, $"{limits.Cpus}/{limits.MemoryMb}/{limits.Pids}");
            var tokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
            var current = existing is not null
                && existing.Config?.Image == image
                && existing.LabelMap().GetValueOrDefault(ResourceNames.TokenLabel, "") == tokenHash
                && existing.LabelMap().GetValueOrDefault(LimitsLabel, "") == limitsText;

            if (existing is not null && !current)
            {
                await StopContainerAsync(runtime, name, cancellationToken);
                await docker.Containers.RemoveContainerAsync(name, new ContainerRemoveParameters { Force = true }, cancellationToken);
                existing = null;
            }

            if (existing is null)
            {
                var labels = names.Labels(ResourceNames.AppKind, appId);
                labels[ResourceNames.CommitLabel] = commit;
                labels[ResourceNames.OrganisationLabel] = request.OrganisationId.ToString("D");
                labels[ResourceNames.TokenLabel] = tokenHash;
                labels[LimitsLabel] = limitsText;
                var proxy = $"http://{o.Peers.EgressAlias}:{o.Peers.EgressPort}";
                // The app kit's contract (src/appkit/PLATFORM-API.md §1). The standard proxy
                // variables are set too, for anything in the app that does not go through the kit.
                var environment = new List<string>
                {
                    $"{AppEnvironment.Database}={connection}",
                    $"{AppEnvironment.PlatformUrl}={o.PlatformUrlForApps}",
                    $"{AppEnvironment.AppToken}={token}",
                    $"{AppEnvironment.EgressProxy}={proxy}",
                    $"{AppEnvironment.AppId}={appId:D}",
                    $"ASPNETCORE_HTTP_PORTS={HostingConventions.AppPort}",
                    "DOTNET_EnableDiagnostics=0", // no diagnostics socket to write on a read-only root
                    $"HTTP_PROXY={proxy}",
                    $"HTTPS_PROXY={proxy}",
                    $"NO_PROXY={o.Peers.PostgresAlias},localhost,127.0.0.1",
                };
                if (o.TelemetryExport is { Length: > 0 } export)
                {
                    environment.Add($"{AppEnvironment.TelemetryExport}={export}");
                }

                await docker.Containers.CreateContainerAsync(new CreateContainerParameters
                {
                    Name = name,
                    Image = image,
                    User = User,
                    Env = environment,
                    Labels = labels,
                    StopTimeout = TimeSpan.FromSeconds(10),
                    HostConfig = Hardening.App(limits, network),
                    NetworkingConfig = new NetworkingConfig { EndpointsConfig = new Dictionary<string, EndpointSettings> { [network] = new() } },
                }, cancellationToken);
                logger.LogInformation("Container for app {AppId} created at {Commit}.", appId, commit[..Math.Min(12, commit.Length)]);
            }

            await StartContainerAsync(appId, runtime, name, cancellationToken);
            var status = await StatusAsync(appId, cancellationToken);
            if (previousCommit != commit)
            {
                _ = reports.PublishedAsync(appId, commit, CancellationToken.None);
            }

            _ = reports.StatusAsync(appId, AppRuntimeState.Running, CancellationToken.None);

            return status;
        }
        finally
        {
            runtime.Lifecycle.Release();
        }
    }

    /// <summary>Starts a sleeping app. A running app is answered at once.</summary>
    public async Task<AppStatus> WakeAsync(Guid appId, CancellationToken cancellationToken)
    {
        var runtime = registry.For(appId);
        await runtime.Lifecycle.WaitAsync(cancellationToken);
        try
        {
            var name = names.AppContainer(appId);
            var container = await TryInspectAsync(name, cancellationToken)
                ?? throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.NotPublished, "The app has not been started yet.");

            // A peer recreated since the app started (a redeployed edge, a restarted database or proxy) is no longer on
            // the app's network, and the app is unreachable however often it is woken: join them again first (idempotent).
            await networks.ConnectPeersAsync(names.AppNetwork(appId), NetworkPeers.Edge | NetworkPeers.Postgres | NetworkPeers.Egress, cancellationToken);
            if (container.State?.Running != true)
            {
                await StartContainerAsync(appId, runtime, name, cancellationToken);
                _ = reports.StatusAsync(appId, AppRuntimeState.Running, CancellationToken.None);
            }

            return await StatusAsync(appId, cancellationToken);
        }
        finally
        {
            runtime.Lifecycle.Release();
        }
    }

    /// <summary>Puts the app to sleep: stopped, container kept.</summary>
    public async Task<AppStatus> StopAsync(Guid appId, CancellationToken cancellationToken)
    {
        var runtime = registry.For(appId);
        await runtime.Lifecycle.WaitAsync(cancellationToken);
        try
        {
            var name = names.AppContainer(appId);
            if (await TryInspectAsync(name, cancellationToken) is null)
            {
                throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.NotPublished, "The app has not been started yet.");
            }

            await StopContainerAsync(runtime, name, cancellationToken);
            _ = reports.StatusAsync(appId, AppRuntimeState.Sleeping, CancellationToken.None);
            return await StatusAsync(appId, cancellationToken);
        }
        finally
        {
            runtime.Lifecycle.Release();
        }
    }

    public async Task<AppStatus> SetEgressAsync(Guid appId, EgressAllowList request, CancellationToken cancellationToken)
    {
        var allowed = EgressRules.NormaliseAll(request.AllowedHosts, out var rejected);
        if (rejected.Count > 0)
        {
            throw DockProblem.Invalid($"Not host names: {string.Join(", ", rejected)}.");
        }

        var network = names.AppNetwork(appId);
        var inspected = await networks.TryInspectAsync(network, cancellationToken)
            ?? throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.NotPublished, "The app has not been started yet.");
        await egress.SetAsync(network, NetworkManager.SubnetOf(inspected)!.Value, allowed, platform: true, cancellationToken);
        return await StatusAsync(appId, cancellationToken);
    }

    /// <summary>
    /// Retires the app's container and network. Its database, repository and images are kept:
    /// Dock never deletes data (CLAUDE.md, "Never do here").
    /// </summary>
    public async Task RetireAsync(Guid appId, CancellationToken cancellationToken)
    {
        var runtime = registry.For(appId);
        await runtime.Lifecycle.WaitAsync(cancellationToken);
        try
        {
            runtime.StopRequestedAt = time.GetUtcNow();
            try
            {
                await docker.Containers.RemoveContainerAsync(names.AppContainer(appId), new ContainerRemoveParameters { Force = true }, cancellationToken);
            }
            catch (Exception e) when (EngineErrors.IsNotFound(e))
            {
            }

            var network = names.AppNetwork(appId);
            await networks.RemoveAsync(network, cancellationToken);
            await egress.RemoveAsync(network, cancellationToken);
        }
        finally
        {
            runtime.Lifecycle.Release();
        }
    }

    public async Task<AppStatus> StatusAsync(Guid appId, CancellationToken cancellationToken)
    {
        var target = $"http://{names.AppContainer(appId)}:{HostingConventions.AppPort}";
        var container = await TryInspectAsync(names.AppContainer(appId), cancellationToken);
        var subnet = await networks.TryInspectAsync(names.AppNetwork(appId), cancellationToken) is { } network ? NetworkManager.SubnetOf(network)?.ToString() : null;
        if (container is null)
        {
            return new AppStatus(appId, AppRuntimeState.NotProvisioned, null, null, target, subnet, null, null, null, false, null, null);
        }

        var runtime = registry.For(appId);
        var state = container.State;
        var started = ParseTime(state?.StartedAt);
        var finished = ParseTime(state?.FinishedAt);
        var value = state?.Running == true ? AppRuntimeState.Running
            : IsCrash(state, runtime, time.GetUtcNow()) ? AppRuntimeState.Crashed
            : AppRuntimeState.Sleeping;
        var labels = container.LabelMap();
        var limits = labels.TryGetValue(LimitsLabel, out var text) && text.Split('/') is [var c, var m, var p]
            ? new ResourceLimits(double.Parse(c, CultureInfo.InvariantCulture), int.Parse(m, CultureInfo.InvariantCulture), int.Parse(p, CultureInfo.InvariantCulture))
            : null;
        return new AppStatus(
            appId,
            value,
            container.Config?.Image,
            labels.GetValueOrDefault(ResourceNames.CommitLabel),
            target,
            subnet,
            started,
            value == AppRuntimeState.Running ? null : finished,
            value == AppRuntimeState.Running || finished is null ? null : (int?)state?.ExitCode,
            state?.OOMKilled == true,
            value == AppRuntimeState.Running ? runtime.LastMemoryBytes : null,
            limits);
    }

    /// <summary>
    /// A container that exited without Dock asking: out of memory, or a code other than a clean
    /// exit or the one a stop signal gives.
    /// </summary>
    public static bool IsCrash(State? state, AppRuntime runtime, DateTimeOffset now)
    {
        if (state is null || state.Running || ParseTime(state.FinishedAt) is null)
        {
            return false;
        }

        if (runtime.StopRequestedAt is { } asked && now - asked < StopGrace)
        {
            return false;
        }

        return state.OOMKilled || state.ExitCode is not (0 or 143);
    }

    private async Task StartContainerAsync(Guid appId, AppRuntime runtime, string name, CancellationToken cancellationToken)
    {
        var running = registry.All
            .Where(a => a.Key != appId && a.Value.LastMemoryBytes > 0)
            .Select(a => a.Value.LastMemoryBytes);
        var o = options.Value;
        var estimate = Math.Max(Volatile.Read(ref runtime.PeakMemoryBytes), o.DefaultAppEstimateMb * 1024L * 1024L);
        var decision = MemoryBudget.Admit(o.AppMemoryBudgetMb * 1024L * 1024L, running, estimate);
        if (!decision.Admitted)
        {
            throw new DockProblem(StatusCodes.Status503ServiceUnavailable, DockProblemCodes.Capacity, "There is no room to start this app right now.",
                $"{decision.UsedBytes / (1024 * 1024)} MB in use of {o.AppMemoryBudgetMb} MB.");
        }

        runtime.StopRequestedAt = null;
        await wakes.RunAsync(() => docker.Containers.StartContainerAsync(name, new ContainerStartParameters(), cancellationToken), cancellationToken);
        Volatile.Write(ref runtime.LastMemoryBytes, estimate); // until the sampler measures it
    }

    private async Task StopContainerAsync(AppRuntime runtime, string name, CancellationToken cancellationToken)
    {
        runtime.StopRequestedAt = time.GetUtcNow();
        try
        {
            await docker.Containers.StopContainerAsync(name, new ContainerStopParameters { WaitBeforeKillSeconds = 10 }, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
        }

        Volatile.Write(ref runtime.LastMemoryBytes, 0);
    }

    private async Task<string> ResolveImageAsync(Guid appId, string? requested, CancellationToken cancellationToken)
    {
        var repository = names.AppImageRepository(appId);
        if (requested is { Length: > 0 })
        {
            // Only an image Dock built for this app may run as this app.
            if (!requested.StartsWith(repository + ":", StringComparison.Ordinal))
            {
                throw DockProblem.Invalid("Only an image built for this app can be started.");
            }

            try
            {
                await docker.Images.InspectImageAsync(requested, cancellationToken);
                return requested;
            }
            catch (Exception e) when (EngineErrors.IsNotFound(e))
            {
                throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.NotPublished, "That version has not been built.");
            }
        }

        var images = await docker.Images.ListImagesAsync(new ImagesListParameters
        {
            Filters = new Dictionary<string, IDictionary<string, bool>> { ["reference"] = new Dictionary<string, bool> { [repository] = true } },
        }, cancellationToken);
        var newest = images.OrderByDescending(i => i.Created)
            .SelectMany(i => i.RepoTags ?? [])
            .FirstOrDefault(t => t.StartsWith(repository + ":", StringComparison.Ordinal));
        return newest ?? throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.NotPublished, "The app has not been built yet.");
    }

    private static string? ExistingToken(ContainerInspectResponse? container) =>
        container?.Config?.Env?.FirstOrDefault(e => e.StartsWith(AppEnvironment.AppToken + "=", StringComparison.Ordinal))?[(AppEnvironment.AppToken.Length + 1)..];

    private async Task<ContainerInspectResponse?> TryInspectAsync(string name, CancellationToken cancellationToken)
    {
        try
        {
            return await docker.Containers.InspectContainerAsync(name, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            return null;
        }
    }

    private static DateTimeOffset? ParseTime(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) && parsed.Year > 1
            ? parsed
            : null;
}
