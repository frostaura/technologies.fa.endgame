using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Gateway;
using Microsoft.Extensions.Configuration;

namespace Endgame.Infrastructure.Gateway;

/// <summary>
/// The OpenRouter adapter — the only code in Endgame that holds <c>OPENROUTER_API_KEY</c>. It sends
/// what the gateway built and hands back exactly what came back; it never logs a request or the key.
/// </summary>
public sealed class OpenRouterProvider(HttpClient http, ModelGatewayOptions options, IConfiguration configuration) : IModelProvider
{
    public const string ClientName = "openrouter";
    public const string KeyName = "OPENROUTER_API_KEY";

    private string? Key => configuration[KeyName] is { Length: > 0 } key ? key : null;

    public bool IsConfigured => Key is not null;

    public async Task<ProviderReply> CompleteAsync(JsonObject body, CancellationToken cancellationToken)
    {
        using var request = Request(HttpMethod.Post, "/api/v1/chat/completions", body);
        using var response = await http.SendAsync(request, cancellationToken);
        return new ProviderReply((int)response.StatusCode, await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<ProviderStream> StreamAsync(JsonObject body, CancellationToken cancellationToken)
    {
        var request = Request(HttpMethod.Post, "/api/v1/chat/completions", body);
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(cancellationToken);
            response.Dispose();
            request.Dispose();
            return new ProviderStream((int)response.StatusCode, Empty(), error);
        }

        return new ProviderStream((int)response.StatusCode, Lines(request, response, cancellationToken), null);
    }

    public async Task<decimal?> GetGenerationCostAsync(string generationId, CancellationToken cancellationToken)
    {
        using var request = Request(HttpMethod.Get, $"/api/v1/generation?id={Uri.EscapeDataString(generationId)}", null);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound || !response.IsSuccessStatusCode)
        {
            return null;
        }

        var node = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var cost = node?["data"]?["total_cost"];
        return cost is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? v.GetValue<decimal>() : null;
    }

    private HttpRequestMessage Request(HttpMethod method, string path, JsonObject? body)
    {
        var key = Key ?? throw new HttpRequestException("No OpenRouter key is configured.");
        var request = new HttpRequestMessage(method, new Uri(new Uri(options.BaseUrl), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        // Attribution: the app, never a person.
        request.Headers.TryAddWithoutValidation("HTTP-Referer", options.AppUrl);
        request.Headers.TryAddWithoutValidation("X-Title", options.AppTitle);
        if (body is not null)
        {
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        }

        return request;
    }

    private static async IAsyncEnumerable<string> Lines(HttpRequestMessage request, HttpResponseMessage response, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            while (await reader.ReadLineAsync(cancellationToken) is { } line)
            {
                yield return line;
            }
        }
        finally
        {
            response.Dispose();
            request.Dispose();
        }
    }

    private static async IAsyncEnumerable<string> Empty()
    {
        await Task.CompletedTask;
        yield break;
    }

    internal static string Invariant(decimal value) => value.ToString(CultureInfo.InvariantCulture);
}
