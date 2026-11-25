using System.Text;
using Docker.DotNet;
using Endgame.Dock.Engine;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Egress;

/// <summary>The allow-lists Dock holds, by network name.</summary>
public sealed class EgressState
{
    public Dictionary<string, EgressEntry> Networks { get; set; } = new(StringComparer.Ordinal);
}

public sealed record EgressEntry(string Subnet, List<string> Hosts, bool Platform);

/// <summary>
/// Owns the egress proxy's policy (ARCH-005: the allow-list is per app, keyed by the app's
/// subnet). Dock writes the policy into the proxy's container through the Engine API and tells
/// it to reload; the proxy has no volume or network shared with Dock.
/// </summary>
public sealed class EgressManager(
    DockerClient docker,
    ContainerFiles files,
    ContainerExec exec,
    IOptions<DockOptions> options,
    ILogger<EgressManager> logger)
{
    private readonly StateFile<EgressState> state = new(Path.Combine(options.Value.DataDirectory, "state", "egress.json"));
    private readonly SemaphoreSlim push = new(1, 1);
    private string? pushedTo;

    public async Task SetAsync(string network, Ipv4Cidr subnet, IEnumerable<string> hosts, bool platform, CancellationToken cancellationToken)
    {
        var list = EgressRules.NormaliseAll(hosts, out _).ToList();
        await state.UpdateAsync(s => s.Networks[network] = new EgressEntry(subnet.ToString(), list, platform), cancellationToken);
        await PushAsync(force: true, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> HostsAsync(string network, CancellationToken cancellationToken) =>
        (await state.ReadAsync(cancellationToken)).Networks.TryGetValue(network, out var entry) ? entry.Hosts : [];

    public async Task RemoveAsync(string network, CancellationToken cancellationToken)
    {
        var removed = false;
        await state.UpdateAsync(s => removed = s.Networks.Remove(network), cancellationToken);
        if (removed)
        {
            await PushAsync(force: true, cancellationToken);
        }
    }

    /// <summary>
    /// Writes the policy and reloads the proxy. Without <paramref name="force"/>, only when the
    /// proxy restarted since the last push — a recreated proxy comes back with no policy (deny all).
    /// </summary>
    public async Task PushAsync(bool force, CancellationToken cancellationToken)
    {
        var peers = options.Value.Peers;
        await push.WaitAsync(cancellationToken);
        try
        {
            Docker.DotNet.Models.ContainerInspectResponse proxy;
            try
            {
                proxy = await docker.Containers.InspectContainerAsync(peers.Egress, cancellationToken);
            }
            catch (Exception e) when (EngineErrors.IsNotFound(e))
            {
                logger.LogWarning("The egress proxy {Container} is not running: every outbound request is refused.", peers.Egress);
                return;
            }

            var incarnation = proxy.ID + "@" + proxy.State?.StartedAt;
            if (!force && incarnation == pushedTo)
            {
                return;
            }

            if (proxy.State?.Running != true)
            {
                return;
            }

            var current = await state.ReadAsync(cancellationToken);
            var rules = current.Networks
                .Select(n => Ipv4Cidr.TryParse(n.Value.Subnet, out var subnet) ? new EgressRule(n.Key, subnet, n.Value.Hosts, n.Value.Platform) : null)
                .OfType<EgressRule>();
            var text = EgressRules.Render(rules, options.Value.PlatformHost, options.Value.PlatformPort);
            var directory = Path.GetDirectoryName(peers.EgressPolicyPath)!.Replace('\\', '/');
            var name = Path.GetFileName(peers.EgressPolicyPath);
            await files.WriteAsync(proxy.ID, directory, [new ContainerFiles.Entry(name, Encoding.UTF8.GetBytes(text))], uid: 0, cancellationToken);
            var reload = await exec.RunAsync(proxy.ID, ["squid", "-k", "reconfigure", "-f", "/etc/squid/squid.conf"], TimeSpan.FromSeconds(20), 16 * 1024, cancellationToken: cancellationToken);
            if (reload.ExitCode != 0)
            {
                logger.LogError("The egress proxy refused its policy (exit {Code}): {Error}", reload.ExitCode, reload.Stderr.Trim());
                return;
            }

            // A reconfigure closes squid's listening port and opens it again a moment later; every app's outbound call
            // and platform call in that moment is refused. Return only once it accepts connections again, so whatever
            // asked for the push (an app's start, a changed allow-list) is never followed by a refused call of its own.
            await WaitUntilListeningAsync(proxy.ID, peers.EgressPort, cancellationToken);
            pushedTo = incarnation;
            logger.LogInformation("Egress policy pushed: {Count} networks.", current.Networks.Count);
        }
        finally
        {
            push.Release();
        }
    }

    /// <summary>Squid handles a reconfigure after the signal returns: let it start, then wait for two answers in a row.</summary>
    private async Task WaitUntilListeningAsync(string proxyId, int port, CancellationToken cancellationToken)
    {
        await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken);
        var answered = 0;
        for (var attempt = 0; attempt < 60 && answered < 2; attempt++)
        {
            var probe = await exec.RunAsync(proxyId, ["nc", "-z", "127.0.0.1", port.ToString(System.Globalization.CultureInfo.InvariantCulture)], TimeSpan.FromSeconds(5), 1024, cancellationToken: cancellationToken);
            answered = probe.ExitCode == 0 ? answered + 1 : 0;
            if (answered < 2)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100), cancellationToken);
            }
        }

        if (answered < 2)
        {
            logger.LogWarning("The egress proxy did not accept connections again within seconds of its reconfigure.");
        }
    }
}

/// <summary>Re-pushes the policy whenever the proxy has restarted, and once at start-up.</summary>
public sealed class EgressReconciler(EgressManager egress, ILogger<EgressReconciler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        do
        {
            try
            {
                await egress.PushAsync(force: false, stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Could not push the egress policy.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
