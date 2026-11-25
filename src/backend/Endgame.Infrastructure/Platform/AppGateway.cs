using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

/// <summary>Bound from <c>AppCalls</c>: how the control plane reaches an app's own API.</summary>
public sealed class AppCallOptions
{
    public const string SectionName = "AppCalls";

    /// <summary><c>edge</c> (through Edge's control listener, which wakes the app) or <c>direct</c> (straight to the container).</summary>
    public string Transport { get; set; } = "edge";

    public int TimeoutSeconds { get; set; } = 60;

    /// <summary>The most of an app's answer an MCP client is given.</summary>
    public int MaxResponseBytes { get; set; } = 256 * 1024;
}

/// <summary>One tool derived from an app's OpenAPI operation.</summary>
public sealed record AppOperation(string Tool, string Description, string Method, string Path, JsonObject InputSchema,
    IReadOnlyList<string> PathParameters, IReadOnlyList<string> QueryParameters, bool HasBody);

public sealed record AppCallResult(int Status, string? ContentType, JsonNode? Json, string Text, bool Truncated);

/// <summary>
/// The control plane calling an app's own API (ARCH-004, <i>Per-app MCP</i>): its OpenAPI document,
/// cached per published version, turned into one tool per operation; and an operation called with an
/// app-scoped member session, through Edge's control listener so a sleeping app is woken.
/// </summary>
public sealed class AppGateway(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IOptions<AppCallOptions> options, IConfiguration configuration)
{
    public const string ClientName = "app-calls";
    public const string OpenApiPath = "openapi/v1.json";
    private static readonly string[] Methods = ["get", "post", "put", "patch", "delete"];
    private readonly ConcurrentDictionary<(Guid App, string Version), IReadOnlyList<AppOperation>> cache = new();

    /// <summary>The app's tools at its published version; read from the app once per version.</summary>
    public async Task<IReadOnlyList<AppOperation>> OperationsAsync(Guid appId, string? version, CancellationToken cancellationToken)
    {
        var key = (appId, version ?? "");
        if (version is not null && cache.TryGetValue(key, out var known))
        {
            return known;
        }

        var answer = await SendAsync(appId, HttpMethod.Get, OpenApiPath, null, null, cancellationToken);
        if (answer.Status != 200 || answer.Json is not JsonObject document)
        {
            throw new EndgameProblem(502, "app_openapi_unavailable", "The app did not describe itself",
                $"Its OpenAPI document ({OpenApiPath}) answered {answer.Status}.");
        }

        var operations = Derive(document);
        if (version is not null)
        {
            foreach (var stale in cache.Keys.Where(k => k.App == appId && k.Version != version))
            {
                cache.TryRemove(stale, out _);
            }

            cache[key] = operations;
        }

        return operations;
    }

    public async Task<AppCallResult> CallAsync(Guid appId, AppOperation operation, JsonObject arguments, string sessionToken, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentNullException.ThrowIfNull(arguments);
        var path = new StringBuilder();
        foreach (var segment in operation.Path.TrimStart('/').Split('/'))
        {
            if (path.Length > 0)
            {
                path.Append('/');
            }

            if (segment.StartsWith('{') && segment.EndsWith('}'))
            {
                var name = segment[1..^1];
                var value = Scalar(arguments[name]) ?? throw EndgameProblem.Invalid($"'{name}' is required.");
                path.Append(Uri.EscapeDataString(value));
            }
            else
            {
                path.Append(segment);
            }
        }

        var query = operation.QueryParameters
            .Select(q => (q, Value: Scalar(arguments[q])))
            .Where(p => p.Value is not null)
            .Select(p => $"{Uri.EscapeDataString(p.q)}={Uri.EscapeDataString(p.Value!)}")
            .ToList();
        var target = path.ToString() + (query.Count > 0 ? "?" + string.Join('&', query) : "");
        HttpContent? body = operation.HasBody && arguments["body"] is { } b ? new StringContent(b.ToJsonString(), Encoding.UTF8, "application/json") : null;
        return await SendAsync(appId, new HttpMethod(operation.Method.ToUpperInvariant()), target, body, sessionToken, cancellationToken);
    }

    /// <summary>A declared webhook called as its device would, with the header the platform computed (the evaluator's signed test).</summary>
    public Task<AppCallResult> CallHookAsync(Guid appId, string name, string header, string value, string body, CancellationToken cancellationToken) =>
        SendAsync(appId, HttpMethod.Post, $"hooks/{name}", new StringContent(body, Encoding.UTF8, "application/json"), null, cancellationToken, (header, value));

    private async Task<AppCallResult> SendAsync(Guid appId, HttpMethod method, string relative, HttpContent? content, string? sessionToken, CancellationToken cancellationToken, (string Name, string Value)? extra = null)
    {
        var o = options.Value;
        Uri target;
        var viaEdge = !string.Equals(o.Transport, "direct", StringComparison.OrdinalIgnoreCase);
        if (viaEdge)
        {
            if (string.IsNullOrWhiteSpace(addresses.Value.EdgeControl) || !Uri.TryCreate(addresses.Value.EdgeControl, UriKind.Absolute, out var root))
            {
                throw new EndgameProblem(503, "app_unreachable", "The app cannot be reached", "No address is configured for Edge's control listener (Services:EdgeControl).");
            }

            target = new Uri(root, $"/internal/apps/{appId:D}/call/{relative}");
        }
        else
        {
            target = new Uri($"http://app-{appId:N}:{HostingConventions.AppPort}/{relative}");
        }

        using var request = new HttpRequestMessage(method, target) { Content = content };
        if (viaEdge)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["ENDGAME_SERVICE_TOKEN"]);
        }

        if (sessionToken is not null)
        {
            request.Headers.TryAddWithoutValidation(HostingConventions.SessionHeader, sessionToken);
        }

        if (extra is { } header)
        {
            request.Headers.TryAddWithoutValidation(header.Name, header.Value);
        }

        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, o.TimeoutSeconds)));
        HttpResponseMessage response;
        try
        {
            response = await http.CreateClient(ClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new EndgameProblem(502, "app_unreachable", "The app did not answer", ex.Message);
        }

        using (response)
        {
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            var buffer = new byte[Math.Max(1024, o.MaxResponseBytes) + 1];
            var read = 0;
            int n;
            while (read < buffer.Length && (n = await stream.ReadAsync(buffer.AsMemory(read, buffer.Length - read), timeout.Token)) > 0)
            {
                read += n;
            }

            var truncated = read > o.MaxResponseBytes;
            var text = Encoding.UTF8.GetString(buffer, 0, Math.Min(read, o.MaxResponseBytes));
            var type = response.Content.Headers.ContentType?.MediaType;
            JsonNode? json = null;
            if (!truncated && type is not null && (type.EndsWith("json", StringComparison.OrdinalIgnoreCase) || type.EndsWith("+json", StringComparison.OrdinalIgnoreCase)) && text.Length > 0)
            {
                try
                {
                    json = JsonNode.Parse(text);
                }
                catch (JsonException)
                {
                    json = null;
                }
            }

            return new AppCallResult((int)response.StatusCode, type, json, text, truncated);
        }
    }

    /// <summary>
    /// One tool per operation: its name from <c>operationId</c>, its description from the operation,
    /// its input from the parameters (path and query) and the JSON body (as <c>body</c>). Platform
    /// paths are never offered.
    /// </summary>
    public static IReadOnlyList<AppOperation> Derive(JsonObject document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var operations = new List<AppOperation>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (path, item) in document["paths"] as JsonObject ?? [])
        {
            var trimmed = path.TrimStart('/');
            if (item is not JsonObject pathItem || trimmed.StartsWith("_platform", StringComparison.Ordinal) || trimmed.StartsWith("_endgame", StringComparison.Ordinal)
                || trimmed.StartsWith("hooks", StringComparison.Ordinal) || trimmed is "health" || trimmed.StartsWith("openapi", StringComparison.Ordinal))
            {
                continue;
            }

            var shared = pathItem["parameters"] as JsonArray ?? [];
            foreach (var method in Methods)
            {
                if (pathItem[method] is not JsonObject op || (op["operationId"] as JsonValue)?.GetValue<string>() is not { Length: > 0 } operationId)
                {
                    continue;
                }

                var name = ToolName(operationId);
                if (!names.Add(name))
                {
                    continue;
                }

                var properties = new JsonObject();
                var required = new JsonArray();
                var pathParameters = new List<string>();
                var queryParameters = new List<string>();
                foreach (var raw in shared.Concat(op["parameters"] as JsonArray ?? []))
                {
                    if (Resolve(raw, document, 0) is not JsonObject parameter || (parameter["name"] as JsonValue)?.GetValue<string>() is not { Length: > 0 } pname)
                    {
                        continue;
                    }

                    var where = (parameter["in"] as JsonValue)?.GetValue<string>();
                    if (where is not ("path" or "query"))
                    {
                        continue;
                    }

                    var schema = Resolve(parameter["schema"], document, 0) as JsonObject ?? new JsonObject { ["type"] = "string" };
                    if ((parameter["description"] as JsonValue)?.GetValue<string>() is { } pd)
                    {
                        schema["description"] = pd;
                    }

                    properties[pname] = schema;
                    (where == "path" ? pathParameters : queryParameters).Add(pname);
                    if (where == "path" || (parameter["required"] as JsonValue)?.GetValueKind() == JsonValueKind.True)
                    {
                        required.Add(pname);
                    }
                }

                var hasBody = false;
                if (Resolve(op["requestBody"], document, 0) is JsonObject requestBody && requestBody["content"]?["application/json"]?["schema"] is { } bodySchema)
                {
                    hasBody = true;
                    var schema = Resolve(bodySchema, document, 0) as JsonObject ?? new JsonObject { ["type"] = "object" };
                    schema["description"] ??= "The request body, as JSON.";
                    properties["body"] = schema;
                    if ((requestBody["required"] as JsonValue)?.GetValueKind() == JsonValueKind.True)
                    {
                        required.Add("body");
                    }
                }

                var description = (op["description"] as JsonValue)?.GetValue<string>() ?? (op["summary"] as JsonValue)?.GetValue<string>() ?? $"{method.ToUpperInvariant()} {path}";
                var input = new JsonObject { ["type"] = "object", ["properties"] = properties };
                if (required.Count > 0)
                {
                    input["required"] = required;
                }

                operations.Add(new AppOperation(name, description, method, path, input, pathParameters, queryParameters, hasBody));
            }
        }

        return operations;
    }

    /// <summary>MCP tool names are letters, digits, '_' and '-', at most 64.</summary>
    public static string ToolName(string operationId)
    {
        var chars = operationId.Select(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' ? c : '_').ToArray();
        var name = new string(chars);
        return name.Length > 64 ? name[..64] : name;
    }

    /// <summary>A copy of the node with every local <c>$ref</c> replaced by what it names, eight levels deep at most.</summary>
    private static JsonNode? Resolve(JsonNode? node, JsonObject document, int depth)
    {
        switch (node)
        {
            case JsonObject o when o["$ref"] is JsonValue r && r.GetValue<string>() is { } reference && reference.StartsWith("#/", StringComparison.Ordinal):
                if (depth >= 8)
                {
                    return new JsonObject { ["type"] = "object" };
                }

                JsonNode? target = document;
                foreach (var part in reference[2..].Split('/'))
                {
                    target = target?[part.Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal)];
                }

                return Resolve(target, document, depth + 1);
            case JsonObject o:
                var copy = new JsonObject();
                foreach (var (k, v) in o)
                {
                    copy[k] = Resolve(v, document, depth);
                }

                return copy;
            case JsonArray a:
                return new JsonArray(a.Select(x => Resolve(x, document, depth)).ToArray());
            default:
                return node?.DeepClone();
        }
    }

    private static string? Scalar(JsonNode? node) => node switch
    {
        null => null,
        JsonValue v when v.GetValueKind() == JsonValueKind.String => v.GetValue<string>(),
        JsonValue v => v.ToJsonString(),
        _ => node.ToJsonString(),
    };
}
