using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Endgame.Ops.Cloudflare;

/// <summary>A DNS record as Cloudflare returns it (fields used here only).</summary>
public sealed record DnsRecord(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("content")] string Content,
    [property: JsonPropertyName("proxied")] bool Proxied,
    [property: JsonPropertyName("ttl")] int Ttl,
    [property: JsonPropertyName("comment")] string? Comment);

/// <summary>The body of a DNS create or edit.</summary>
public sealed record DnsRecordInput(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("content")] string Content,
    [property: JsonPropertyName("proxied")] bool Proxied,
    [property: JsonPropertyName("ttl")] int Ttl,
    [property: JsonPropertyName("comment")] string Comment);

/// <summary>A Workers route. <see cref="Script"/> null is a route with no Worker, which excludes its pattern.</summary>
public sealed record WorkerRoute(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("pattern")] string Pattern,
    [property: JsonPropertyName("script")] string? Script);

/// <summary>A plain-text Worker binding.</summary>
public sealed record WorkerBinding(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("text")] string? Text);

/// <summary>A tunnel's remotely-managed configuration: its version and the <c>config</c> object, kept whole.</summary>
public sealed record TunnelConfiguration(long Version, JsonObject Config);

/// <summary>Cloudflare answered with <c>success: false</c> or an error status.</summary>
public sealed class CloudflareException(HttpStatusCode status, IReadOnlyList<(int Code, string Message)> errors)
    : Exception($"Cloudflare refused the request ({(int)status}): {string.Join("; ", errors.Select(e => $"{e.Code} {e.Message}"))}")
{
    public HttpStatusCode Status { get; } = status;

    public IReadOnlyList<(int Code, string Message)> Errors { get; } = errors;
}

/// <summary>
/// The Cloudflare API calls Endgame makes, typed. The base URL is configuration
/// (<see cref="CloudflareOptions.BaseUrl"/>); every method cites the reference page whose request
/// and response shapes it follows. Authentication is an API token as a bearer header, as each of
/// those pages prefers.
/// </summary>
public sealed class CloudflareClient(HttpClient http, CloudflareOptions options)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Records per page when listing. The API allows up to 5,000,000; pages keep each answer small.</summary>
    public const int PageSize = 500;

    /// <summary>
    /// List DNS records — GET /zones/{zone_id}/dns_records?page=&amp;per_page=
    /// https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
    /// </summary>
    public async Task<IReadOnlyList<DnsRecord>> ListDnsRecordsAsync(CancellationToken cancellationToken)
    {
        var all = new List<DnsRecord>();
        for (var page = 1; ; page++)
        {
            var envelope = await SendAsync(HttpMethod.Get, $"zones/{options.ZoneId}/dns_records?page={page}&per_page={PageSize}", null, cancellationToken);
            var records = envelope["result"].Deserialize<List<DnsRecord>>(Json) ?? [];
            all.AddRange(records);
            var totalPages = envelope["result_info"]?["total_pages"]?.GetValue<int>() ?? 1;
            if (records.Count == 0 || page >= totalPages)
            {
                return all;
            }
        }
    }

    /// <summary>
    /// Create DNS record — POST /zones/{zone_id}/dns_records
    /// https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/
    /// </summary>
    public async Task<DnsRecord> CreateDnsRecordAsync(DnsRecordInput record, CancellationToken cancellationToken) =>
        (await SendAsync(HttpMethod.Post, $"zones/{options.ZoneId}/dns_records", JsonSerializer.SerializeToNode(record, Json), cancellationToken))["result"]
            .Deserialize<DnsRecord>(Json)!;

    /// <summary>
    /// Update DNS record (partial) — PATCH /zones/{zone_id}/dns_records/{dns_record_id}
    /// https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/
    /// </summary>
    public async Task<DnsRecord> EditDnsRecordAsync(string id, DnsRecordInput record, CancellationToken cancellationToken) =>
        (await SendAsync(HttpMethod.Patch, $"zones/{options.ZoneId}/dns_records/{id}", JsonSerializer.SerializeToNode(record, Json), cancellationToken))["result"]
            .Deserialize<DnsRecord>(Json)!;

    /// <summary>
    /// Delete DNS record — DELETE /zones/{zone_id}/dns_records/{dns_record_id} → result { id }
    /// https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/delete/
    /// </summary>
    public async Task DeleteDnsRecordAsync(string id, CancellationToken cancellationToken) =>
        await SendAsync(HttpMethod.Delete, $"zones/{options.ZoneId}/dns_records/{id}", null, cancellationToken);

    /// <summary>
    /// Get tunnel configuration — GET /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
    /// → result { tunnel_id, version, config { ingress, originRequest }, source, created_at }
    /// https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/
    /// </summary>
    public async Task<TunnelConfiguration> GetTunnelConfigurationAsync(CancellationToken cancellationToken)
    {
        var result = (await SendAsync(HttpMethod.Get, TunnelPath, null, cancellationToken))["result"];
        return new TunnelConfiguration(result?["version"]?.GetValue<long>() ?? 0, result?["config"] as JsonObject ?? []);
    }

    /// <summary>
    /// Put tunnel configuration — PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations, body { config }.
    /// Replaces the whole configuration: callers send back everything they read, changed only where they mean to.
    /// https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/update/
    /// </summary>
    public async Task<TunnelConfiguration> PutTunnelConfigurationAsync(JsonObject config, CancellationToken cancellationToken)
    {
        var result = (await SendAsync(HttpMethod.Put, TunnelPath, new JsonObject { ["config"] = config.DeepClone() }, cancellationToken))["result"];
        return new TunnelConfiguration(result?["version"]?.GetValue<long>() ?? 0, result?["config"] as JsonObject ?? []);
    }

    /// <summary>
    /// Get script settings — GET /accounts/{account_id}/workers/scripts/{script_name}/settings → result { bindings, ... }.
    /// Null when the script does not exist (404).
    /// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/
    /// </summary>
    public async Task<IReadOnlyList<WorkerBinding>?> GetWorkerBindingsAsync(string script, CancellationToken cancellationToken)
    {
        try
        {
            var result = (await SendAsync(HttpMethod.Get, $"accounts/{options.AccountId}/workers/scripts/{script}/settings", null, cancellationToken))["result"];
            return result?["bindings"].Deserialize<List<WorkerBinding>>(Json) ?? [];
        }
        catch (CloudflareException ex) when (ex.Status == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    /// <summary>
    /// Upload Worker module — PUT /accounts/{account_id}/workers/scripts/{script_name}, multipart/form-data:
    /// a <c>metadata</c> part (application/json: main_module, compatibility_date, bindings) and the
    /// module as a part named as main_module, typed application/javascript+module.
    /// https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/ ·
    /// https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
    /// </summary>
    public async Task UploadWorkerAsync(string script, string moduleName, string source, string compatibilityDate, IReadOnlyList<WorkerBinding> bindings, CancellationToken cancellationToken)
    {
        var metadata = new JsonObject
        {
            ["main_module"] = moduleName,
            ["compatibility_date"] = compatibilityDate,
            ["bindings"] = JsonSerializer.SerializeToNode(bindings, Json),
        };
        using var form = new MultipartFormDataContent();
        var meta = new StringContent(metadata.ToJsonString(), System.Text.Encoding.UTF8);
        meta.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        form.Add(meta, "metadata");
        var module = new StringContent(source, System.Text.Encoding.UTF8);
        module.Headers.ContentType = new MediaTypeHeaderValue("application/javascript+module");
        form.Add(module, moduleName, moduleName);
        await SendContentAsync(HttpMethod.Put, $"accounts/{options.AccountId}/workers/scripts/{script}", form, cancellationToken);
    }

    /// <summary>
    /// List routes — GET /zones/{zone_id}/workers/routes → result [{ id, pattern, script? }]
    /// https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/
    /// </summary>
    public async Task<IReadOnlyList<WorkerRoute>> ListWorkerRoutesAsync(CancellationToken cancellationToken) =>
        (await SendAsync(HttpMethod.Get, $"zones/{options.ZoneId}/workers/routes", null, cancellationToken))["result"].Deserialize<List<WorkerRoute>>(Json) ?? [];

    /// <summary>
    /// Create route — POST /zones/{zone_id}/workers/routes { pattern, script? }; no script makes an excluding route.
    /// https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/create/
    /// </summary>
    public async Task<WorkerRoute> CreateWorkerRouteAsync(string pattern, string? script, CancellationToken cancellationToken) =>
        (await SendAsync(HttpMethod.Post, $"zones/{options.ZoneId}/workers/routes", RouteBody(pattern, script), cancellationToken))["result"]
            .Deserialize<WorkerRoute>(Json) is { } created
            ? created with { Pattern = pattern, Script = script }
            : throw new CloudflareException(HttpStatusCode.OK, [(0, "A route was created but not returned.")]);

    /// <summary>
    /// Update route — PUT /zones/{zone_id}/workers/routes/{route_id} { pattern, script? }
    /// https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/update/
    /// </summary>
    public async Task UpdateWorkerRouteAsync(string id, string pattern, string? script, CancellationToken cancellationToken) =>
        await SendAsync(HttpMethod.Put, $"zones/{options.ZoneId}/workers/routes/{id}", RouteBody(pattern, script), cancellationToken);

    /// <summary>
    /// Delete route — DELETE /zones/{zone_id}/workers/routes/{route_id} → result { id }
    /// https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/delete/
    /// </summary>
    public async Task DeleteWorkerRouteAsync(string id, CancellationToken cancellationToken) =>
        await SendAsync(HttpMethod.Delete, $"zones/{options.ZoneId}/workers/routes/{id}", null, cancellationToken);

    private string TunnelPath => $"accounts/{options.AccountId}/cfd_tunnel/{options.TunnelId}/configurations";

    private static JsonObject RouteBody(string pattern, string? script)
    {
        var body = new JsonObject { ["pattern"] = pattern };
        if (script is not null)
        {
            body["script"] = script;
        }

        return body;
    }

    private Task<JsonNode> SendAsync(HttpMethod method, string path, JsonNode? body, CancellationToken cancellationToken) =>
        SendContentAsync(method, path, body is null ? null : JsonContent.Create(body, options: Json), cancellationToken);

    /// <summary>Every answer is the v4 envelope { success, errors[{code, message}], messages, result }.</summary>
    private async Task<JsonNode> SendContentAsync(HttpMethod method, string path, HttpContent? content, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, new Uri(options.BaseUrl.TrimEnd('/') + "/" + path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.ApiToken);
        request.Content = content;
        using var response = await http.SendAsync(request, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        JsonNode? envelope = null;
        try
        {
            envelope = text.Length > 0 ? JsonNode.Parse(text) : null;
        }
        catch (JsonException)
        {
        }

        if (!response.IsSuccessStatusCode || envelope?["success"]?.GetValue<bool>() != true)
        {
            var errors = (envelope?["errors"] as JsonArray)?
                .Select(e => (e?["code"]?.GetValue<int>() ?? 0, e?["message"]?.GetValue<string>() ?? ""))
                .ToList() ?? [(0, text.Length > 200 ? text[..200] : text)];
            throw new CloudflareException(response.StatusCode, errors);
        }

        return envelope!;
    }
}
