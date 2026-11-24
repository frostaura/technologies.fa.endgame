using System.Net;
using Docker.DotNet;

namespace Endgame.Dock.Engine;

internal static class EngineErrors
{
    public static bool IsNotFound(Exception e) =>
        e is DockerContainerNotFoundException or DockerNetworkNotFoundException or DockerImageNotFoundException
        || (e is DockerApiException api && api.StatusCode == HttpStatusCode.NotFound);

    public static bool IsConflict(Exception e) => e is DockerApiException { StatusCode: HttpStatusCode.Conflict };
}

internal static class EngineModels
{
    private static readonly IReadOnlyDictionary<string, string> None = new Dictionary<string, string>();

    public static IReadOnlyDictionary<string, string> LabelMap(this Docker.DotNet.Models.ContainerInspectResponse container) =>
        container.Config?.Labels is { } labels ? labels.AsReadOnly() : None;

    public static IReadOnlyDictionary<string, string> LabelMap(this Docker.DotNet.Models.ContainerListResponse container) =>
        container.Labels is { } labels ? labels.AsReadOnly() : None;
}
