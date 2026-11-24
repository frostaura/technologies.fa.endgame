using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Policy;
using Microsoft.Extensions.Options;

using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Engine;

/// <summary>Which shared services a new network is joined to.</summary>
[Flags]
public enum NetworkPeers
{
    None = 0,
    Edge = 1,
    Postgres = 2,
    Egress = 4,
}

/// <summary>
/// Creates the internal networks apps, workspaces and builds live on, each with a /28 Dock assigns
/// itself, and joins the shared services to them. Dock never joins one (ARCH-005): it keeps the
/// socket holder out of reach of what runs there.
/// </summary>
public sealed class NetworkManager(DockerClient docker, IOptions<DockOptions> options, ILogger<NetworkManager> logger)
{
    private readonly SemaphoreSlim allocation = new(1, 1);
    private readonly Ipv4Cidr pool = Ipv4Cidr.Parse(options.Value.SubnetPool);

    /// <summary>Creates the network if it does not exist; returns its subnet either way.</summary>
    public async Task<Ipv4Cidr> EnsureAsync(string name, IDictionary<string, string> labels, NetworkPeers peers, CancellationToken cancellationToken)
    {
        await allocation.WaitAsync(cancellationToken);
        Ipv4Cidr subnet;
        try
        {
            var existing = await TryInspectAsync(name, cancellationToken);
            if (existing is not null)
            {
                subnet = SubnetOf(existing) ?? throw new InvalidOperationException($"Network {name} has no IPv4 subnet.");
            }
            else
            {
                var networks = await docker.Networks.ListNetworksAsync(new NetworksListParameters(), cancellationToken);
                var used = networks.SelectMany(n => n.IPAM?.Config ?? []).Select(c => Ipv4Cidr.TryParse(c.Subnet, out var cidr) ? cidr : (Ipv4Cidr?)null).OfType<Ipv4Cidr>();
                subnet = SubnetAllocator.Next(pool, used) ?? throw new InvalidOperationException($"The subnet pool {pool} is exhausted.");
                await docker.Networks.CreateNetworkAsync(new NetworksCreateParameters
                {
                    Name = name,
                    Driver = "bridge",
                    Internal = true,
                    IPAM = new IPAM { Config = [new IPAMConfig { Subnet = subnet.ToString() }] },
                    Labels = labels,
                }, cancellationToken);
                logger.LogInformation("Created network {Network} on {Subnet}.", name, subnet);
            }
        }
        finally
        {
            allocation.Release();
        }

        await ConnectPeersAsync(name, peers, cancellationToken);
        return subnet;
    }

    public async Task ConnectPeersAsync(string network, NetworkPeers peers, CancellationToken cancellationToken)
    {
        var peerOptions = options.Value.Peers;
        if (peers.HasFlag(NetworkPeers.Edge))
        {
            await ConnectAsync(network, peerOptions.Edge, null, cancellationToken);
        }

        if (peers.HasFlag(NetworkPeers.Postgres))
        {
            await ConnectAsync(network, peerOptions.Postgres, peerOptions.PostgresAlias, cancellationToken);
        }

        if (peers.HasFlag(NetworkPeers.Egress))
        {
            await ConnectAsync(network, peerOptions.Egress, peerOptions.EgressAlias, cancellationToken);
        }
    }

    /// <summary>Disconnects every peer and removes the network. Missing is fine.</summary>
    public async Task RemoveAsync(string name, CancellationToken cancellationToken)
    {
        var network = await TryInspectAsync(name, cancellationToken);
        if (network is null)
        {
            return;
        }

        foreach (var container in network.Containers?.Keys ?? [])
        {
            try
            {
                await docker.Networks.DisconnectNetworkAsync(name, new NetworkDisconnectParameters { Container = container, Force = true }, cancellationToken);
            }
            catch (Exception e) when (EngineErrors.IsNotFound(e) || e is DockerApiException)
            {
                logger.LogDebug(e, "Disconnecting {Container} from {Network} failed.", container, name);
            }
        }

        try
        {
            await docker.Networks.DeleteNetworkAsync(name, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
        }
    }

    public async Task<NetworkResponse?> TryInspectAsync(string name, CancellationToken cancellationToken)
    {
        try
        {
            return await docker.Networks.InspectNetworkAsync(name, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            return null;
        }
    }

    public static Ipv4Cidr? SubnetOf(NetworkResponse network) =>
        network.IPAM?.Config?.Select(c => Ipv4Cidr.TryParse(c.Subnet, out var cidr) ? cidr : (Ipv4Cidr?)null).FirstOrDefault(c => c is not null);

    private async Task ConnectAsync(string network, string container, string? alias, CancellationToken cancellationToken)
    {
        try
        {
            await docker.Networks.ConnectNetworkAsync(network, new NetworkConnectParameters
            {
                Container = container,
                EndpointConfig = new EndpointSettings { Aliases = alias is null ? [] : [alias] },
            }, cancellationToken);
        }
        catch (DockerApiException e) when (e.StatusCode == System.Net.HttpStatusCode.Forbidden || (e.ResponseBody ?? "").Contains("already exists", StringComparison.OrdinalIgnoreCase))
        {
            // Already connected: joining is idempotent.
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            logger.LogWarning("Peer {Container} is not running; {Network} was created without it.", container, network);
        }
    }
}
