using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Tree;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <param name="Source"><c>cloudflare</c> (the zone was read), <c>built-in</c> (Cloudflare is not managed here), or <c>static</c>.</param>
/// <param name="Note">Said plainly when only the built-in list applied.</param>
public sealed record NameCheck(string Slug, string Source, string? Note);

/// <summary>
/// Organisation names may not take one of FrostAura's own subdomains (spec, <i>Addresses and
/// hosting</i>). The ops service reads the zone (<c>GET /internal/ops/reserved-hosts</c>, ARCH-007);
/// while Cloudflare is managed and that read is incomplete, every new name is refused, because a
/// name that collides would hide a FrostAura site. With Cloudflare not managed at all (development),
/// the built-in list applies and the answer says so.
/// </summary>
public sealed class ReservedNames(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IConfiguration configuration, ILogger<ReservedNames> logger)
{
    public const string ClientName = "ops";

    public async Task<NameCheck> CheckAsync(string slug, CancellationToken cancellationToken)
    {
        if (SlugRules.ReservedOrganisationSlugs.Contains(slug))
        {
            throw Reserved(slug, "it is one of Endgame's own names");
        }

        var ops = addresses.Value.Ops;
        if (string.IsNullOrWhiteSpace(ops) || !Uri.TryCreate(ops, UriKind.Absolute, out var root))
        {
            return new NameCheck(slug, "built-in", "No ops service is configured, so FrostAura's own subdomains were checked against the built-in list only.");
        }

        var reserved = await GetAsync(root, "/internal/ops/reserved-hosts", cancellationToken);
        var labels = (reserved?["labels"] as JsonArray ?? []).Select(l => (l as JsonValue)?.GetValue<string>()).Where(l => l is not null).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (labels.Contains(slug))
        {
            throw Reserved(slug, "FrostAura already uses it as a subdomain");
        }

        if (reserved?["complete"] is JsonValue complete && complete.GetValueKind() == JsonValueKind.True)
        {
            return new NameCheck(slug, "cloudflare", null);
        }

        // Incomplete: refuse only when Cloudflare is meant to be managed here.
        var health = await GetAsync(root, "/health", cancellationToken, allowUnhealthy: true);
        var state = (health?["cloudflare"]?["state"] as JsonValue)?.GetValue<string>();
        if (state is "idle")
        {
            return new NameCheck(slug, "built-in",
                "Cloudflare is not managed by this installation, so FrostAura's own subdomains were checked against the built-in list only.");
        }

        var reason = (reserved?["reason"] as JsonValue)?.GetValue<string>();
        throw new EndgameProblem(503, "reserved_names_unavailable", "New organisation names are paused",
            $"FrostAura's own subdomains could not all be read, so no new name can be checked against them yet. {reason}".Trim());
    }

    private static EndgameProblem Reserved(string slug, string why) =>
        new(409, "reserved_name", "That name is reserved", $"'{slug}' cannot name an organisation: {why}.");

    private async Task<JsonNode?> GetAsync(Uri root, string path, CancellationToken cancellationToken, bool allowUnhealthy = false)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(root, path));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["ENDGAME_SERVICE_TOKEN"]);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            using var response = await http.CreateClient(ClientName).SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode && !(allowUnhealthy && (int)response.StatusCode == 503))
            {
                throw new HttpRequestException($"ops answered {(int)response.StatusCode}");
            }

            return JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("The ops service could not be asked for reserved names: {Message}", ex.Message);
            throw new EndgameProblem(503, "reserved_names_unavailable", "New organisation names are paused",
                "The service that knows FrostAura's own subdomains did not answer, so no new name can be checked yet. Try again shortly.");
        }
    }
}
