using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;

namespace Endgame.AppKit;

/// <summary>
/// The platform derives an app's MCP tools from its OpenAPI document, so every described endpoint
/// must carry an operation id and a description. This check runs when the app starts and refuses
/// to start an app that breaks the contract, naming each endpoint and the line that fixes it.
/// </summary>
internal static class ApiContract
{
    internal const string ApiPrefix = "api/";

    internal static List<string> Problems(IEnumerable<Endpoint> endpoints)
    {
        var problems = new List<string>();
        var seen = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var endpoint in endpoints.OfType<RouteEndpoint>())
        {
            var metadata = endpoint.Metadata;
            var methods = metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];
            var route = endpoint.RoutePattern.RawText?.TrimStart('/') ?? "";
            var label = $"{(methods.Count == 0 ? "ANY" : string.Join(",", methods))} {route}";

            // Only route handlers (MapGet, MapPost, …) are described; middleware endpoints such as
            // health checks are not, and anything excluded from the description is not a tool.
            if (metadata.GetMetadata<MethodInfo>() is null
                || metadata.GetMetadata<IExcludeFromDescriptionMetadata>() is { ExcludeFromDescription: true })
            {
                continue;
            }

            if (!route.StartsWith(ApiPrefix, StringComparison.Ordinal))
            {
                problems.Add($"{label}: the app's own endpoints live under api/. Map it as \"{ApiPrefix}{route}\" (or inside app.MapGroup(\"api/...\")).");
                continue;
            }

            var name = metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName;
            if (string.IsNullOrWhiteSpace(name))
            {
                problems.Add($"{label}: missing an operation id. Add .WithName(\"{SuggestName(methods, route)}\") — lowerCamelCase, unique, a verb first.");
            }
            else if (!Names.OperationId().IsMatch(name))
            {
                problems.Add($"{label}: operation id \"{name}\" must be lowerCamelCase letters and digits, 3 to 64 long (it becomes an MCP tool name), e.g. \"{SuggestName(methods, route)}\".");
            }
            else if (seen.TryGetValue(name, out var other))
            {
                problems.Add($"{label}: operation id \"{name}\" is already used by {other}. Every operation id is unique.");
            }
            else
            {
                seen[name] = label;
            }

            var description = metadata.GetMetadata<IEndpointDescriptionMetadata>()?.Description;
            if (string.IsNullOrWhiteSpace(description))
            {
                problems.Add($"{label}: missing a description. Add .WithDescription(\"…\") — one or two sentences saying what it does and returns; an agent reads it to decide when to call it.");
            }

            if (metadata.GetMetadata<RequireUserMetadata>() is null && TakesRequiredUser(metadata))
            {
                problems.Add($"{label}: takes a non-nullable EndgameUser but is not marked .RequireUser(). Add .RequireUser(), or take EndgameUser? if signing in is optional.");
            }
        }

        return problems;
    }

    internal static string Report(List<string> problems)
    {
        var text = new StringBuilder();
        text.Append("Endgame app kit: ").Append(problems.Count).Append(problems.Count == 1 ? " endpoint breaks" : " endpoints break")
            .Append(" the API contract (the platform builds the app's MCP tools from it):");
        foreach (var p in problems)
        {
            text.Append("\n  - ").Append(p);
        }

        return text.ToString();
    }

    private static bool TakesRequiredUser(EndpointMetadataCollection metadata) =>
        metadata.GetMetadata<MethodInfo>()?.GetParameters().Any(p => p.ParameterType == typeof(EndgameUser) && !EndgameUser.IsNullable(p)) == true;

    internal static string SuggestName(IReadOnlyList<string> methods, string route)
    {
        var segments = route[ApiPrefix.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        var nouns = segments.Where(s => !s.StartsWith('{')).Select(Pascal).ToList();
        var byId = segments.Length > 0 && segments[^1].StartsWith('{');
        var noun = nouns.Count == 0 ? "Thing" : string.Concat(nouns);
        var verb = methods.FirstOrDefault() switch
        {
            "GET" => byId ? "get" : "list",
            "POST" => "create",
            "PUT" or "PATCH" => "update",
            "DELETE" => "delete",
            _ => "call",
        };
        if (verb is "get" or "create" or "update" or "delete" && noun.EndsWith('s'))
        {
            noun = noun[..^1];
        }

        return verb + noun;
    }

    private static string Pascal(string segment) =>
        string.Concat(segment.Split('-', '_').Where(p => p.Length > 0).Select(p => char.ToUpperInvariant(p[0]) + p[1..]));
}
