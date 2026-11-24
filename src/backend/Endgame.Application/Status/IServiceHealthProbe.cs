namespace Endgame.Application.Status;

/// <summary>
/// Port: asks one service whether it is healthy. Adapters live in Infrastructure — an HTTP call to
/// the service's <c>/health</c>, or a connection to the database. A probe never throws for an
/// unhealthy service; it reports it.
/// </summary>
public interface IServiceHealthProbe
{
    string Key { get; }

    string Name { get; }

    /// <summary>Lower sorts first in the status report.</summary>
    int Order { get; }

    Task<ServiceHealth> ProbeAsync(CancellationToken cancellationToken);
}
