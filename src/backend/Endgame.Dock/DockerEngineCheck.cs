using Docker.DotNet;

namespace Endgame.Dock;

public sealed record EngineStatus(bool Reachable, string? Version, string Detail);

/// <summary>Asks the engine for its version: the cheapest call that proves the socket answers.</summary>
public sealed class DockerEngineCheck(DockerClient docker, ILogger<DockerEngineCheck> logger)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(2);

    public async Task<EngineStatus> CheckAsync(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        try
        {
            var version = await docker.System.GetVersionAsync(timeout.Token);
            return new EngineStatus(true, version.Version, $"Engine {version.Version} reachable.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "The Docker Engine did not answer.");
            return new EngineStatus(false, null, $"Engine unreachable: {ex.Message}");
        }
    }
}
