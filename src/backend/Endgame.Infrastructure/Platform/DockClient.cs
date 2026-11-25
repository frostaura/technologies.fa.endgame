using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <summary>
/// The control plane's side of Dock's internal API (ARCH-004, <i>Dock</i>): an app's version history,
/// restore, the code export and the data dump, and a rebuild after a restore. The service token on
/// every call; a failure becomes a problem that says which part did not answer.
/// </summary>
public sealed class DockClient(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IConfiguration configuration)
{
    public const string ClientName = "dock";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<CommitLog> LogAsync(Guid appId, int skip, int limit, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/internal/repos/{appId:D}/log?skip={skip}&limit={limit}", null, cancellationToken);
        return await ReadAsync<CommitLog>(response, "the version history", cancellationToken);
    }

    public async Task<CommitInfo> RestoreAsync(Guid appId, RestoreRequest request, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/internal/repos/{appId:D}/restore", JsonContent.Create(request, options: Json), cancellationToken);
        return await ReadAsync<CommitInfo>(response, "the restore", cancellationToken);
    }

    public async Task<BuildResult> BuildAsync(Guid appId, string? reference, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/internal/apps/{appId:D}/build", JsonContent.Create(new BuildRequest(reference), options: Json), cancellationToken, TimeSpan.FromMinutes(15));
        return await ReadAsync<BuildResult>(response, "the build", cancellationToken);
    }

    public async Task<AppStatus> StartAsync(Guid appId, StartAppRequest request, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/internal/apps/{appId:D}/start", JsonContent.Create(request, options: Json), cancellationToken, TimeSpan.FromMinutes(5));
        return await ReadAsync<AppStatus>(response, "starting the app", cancellationToken);
    }

    /// <summary>The whole code history as a git bundle, copied to <paramref name="destination"/>.</summary>
    public async Task CodeBundleAsync(Guid appId, Stream destination, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/internal/repos/{appId:D}/export", null, cancellationToken, TimeSpan.FromMinutes(10));
        await EnsureAsync(response, "the code export", cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
    }

    /// <summary>
    /// The app's own database as a <c>pg_dump</c> custom-format archive, copied to
    /// <paramref name="destination"/>. False when Dock says the app has no database yet.
    /// </summary>
    public async Task<bool> DatabaseDumpAsync(Guid appId, Stream destination, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/internal/apps/{appId:D}/database/dump", null, cancellationToken, TimeSpan.FromMinutes(10));
        if (response.StatusCode == HttpStatusCode.NotFound && await CodeOfAsync(response, cancellationToken) == "not_found")
        {
            return false;
        }

        await EnsureAsync(response, "the data export", cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return true;
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, HttpContent? content, CancellationToken cancellationToken, TimeSpan? timeout = null)
    {
        if (string.IsNullOrWhiteSpace(addresses.Value.Dock) || !Uri.TryCreate(addresses.Value.Dock, UriKind.Absolute, out var root))
        {
            throw new EndgameProblem(503, "dock_unconfigured", "App hosting is not reachable", "No address is configured for the hosting service (Services:Dock).");
        }

        var request = new HttpRequestMessage(method, new Uri(root, path)) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["ENDGAME_SERVICE_TOKEN"]);
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(timeout ?? TimeSpan.FromSeconds(60));
        try
        {
            return await http.CreateClient(ClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, limit.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new EndgameProblem(502, "dock_unavailable", "App hosting did not answer", ex.Message);
        }
    }

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response, string what, CancellationToken cancellationToken)
    {
        await EnsureAsync(response, what, cancellationToken);
        return await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken)
            ?? throw new EndgameProblem(502, "dock_unavailable", "App hosting answered nothing", $"Dock sent no body for {what}.");
    }

    private static async Task EnsureAsync(HttpResponseMessage response, string what, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var code = await CodeOfAsync(response, cancellationToken);
        throw response.StatusCode switch
        {
            HttpStatusCode.NotFound => new EndgameProblem(404, "not_found", "Not found", $"Dock found nothing for {what} ({code ?? "no such route"})."),
            HttpStatusCode.Conflict => new EndgameProblem(409, code ?? "conflict", "Conflict", $"Dock refused {what}: {code}."),
            HttpStatusCode.BadRequest => new EndgameProblem(400, code ?? "invalid_request", "The request is not valid", $"Dock refused {what}."),
            _ => new EndgameProblem(502, "dock_unavailable", "App hosting failed", $"Dock answered {(int)response.StatusCode} for {what}."),
        };
    }

    private static async Task<string?> CodeOfAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            return text.Length == 0 ? null : (JsonNode.Parse(text)?["code"] as JsonValue)?.GetValue<string>();
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }
}
