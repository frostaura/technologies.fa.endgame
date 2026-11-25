using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Endgame.Application.Common;
using Endgame.ControlPlane.Endpoints;
using Endgame.Domain;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Endgame.ControlPlane.Mcp;

/// <summary>One MCP tool: its name, what it is for, its input schema, and what it does.</summary>
internal sealed record McpTool(string Name, string Description, JsonObject Schema, bool ReadOnly, Func<ToolCall, Task<object?>> Run);

/// <summary>One call of a tool: the request's own services and person, the arguments, and typed readers for them.</summary>
internal sealed class ToolCall(HttpContext http, JsonObject arguments)
{
    public HttpContext Http { get; } = http;

    public JsonObject Args { get; } = arguments;

    public ClaimsPrincipal User => Http.User;

    public Guid UserId => User.Id();

    public CancellationToken Ct => Http.RequestAborted;

    public T S<T>()
        where T : notnull => Http.RequestServices.GetRequiredService<T>();

    public string? Str(string name) => Args[name] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    public string Req(string name) => Str(name) ?? throw EndgameProblem.Invalid($"'{name}' is required.");

    public Guid Id(string name) => Guid.TryParse(Str(name), out var id) ? id : throw EndgameProblem.Invalid($"'{name}' is an id (a GUID).");

    public Guid? OptionalId(string name) => Str(name) is { } text ? Guid.TryParse(text, out var id) ? id : throw EndgameProblem.Invalid($"'{name}' is an id (a GUID).") : null;

    public int? Int(string name) => Args[name] is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<int>(out var i) ? i : null;

    public decimal? Dec(string name) => Args[name] is JsonValue v && v.GetValueKind() == JsonValueKind.Number && decimal.TryParse(v.ToJsonString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;

    public bool? Bool(string name) => Args[name] is JsonValue v ? v.GetValueKind() switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null } : null;

    public IReadOnlyList<string>? Strings(string name) =>
        Args[name] is JsonArray a ? a.OfType<JsonValue>().Where(v => v.GetValueKind() == JsonValueKind.String).Select(v => v.GetValue<string>()).ToList() : null;

    public JsonNode? Node(string name) => Args[name]?.DeepClone();
}

/// <summary>
/// MCP, on by default (spec: "anything possible in the UI is possible over MCP"), on the official C#
/// SDK's streamable HTTP transport, stateless. <c>/mcp</c> is the control plane's own server: the
/// organisation's capabilities as tools, each calling the same services with the same role checks as
/// the public API. <c>/mcp/apps/{appId}</c> is one app's own API, derived from its OpenAPI document.
/// Both accept only a personal access token (<see cref="AccessTokenAuthenticationHandler"/>).
/// </summary>
internal static class McpSetup
{
    public const string AppRouteValue = "appId";

    internal static readonly JsonSerializerOptions Json = Create();

    public static IServiceCollection AddEndgameMcp(this IServiceCollection services)
    {
        services.AddMcpServer(options => options.ServerInfo = new Implementation { Name = "endgame", Version = "1.0" })
            .WithHttpTransport(options => options.Stateless = true)
            .WithListToolsHandler(ListAsync)
            .WithCallToolHandler(CallAsync);
        return services;
    }

    public static void MapEndgameMcp(this WebApplication app)
    {
        app.MapMcp("/mcp").RequireAuthorization(AccessTokenAuthenticationHandler.Policy).WithTags("MCP");
        app.MapMcp($"/mcp/apps/{{{AppRouteValue}:guid}}").RequireAuthorization(AccessTokenAuthenticationHandler.Policy).WithTags("MCP");
    }

    private static HttpContext Http(IServiceProvider? services) =>
        (services ?? throw new McpException("No request context.")).GetRequiredService<IHttpContextAccessor>().HttpContext
        ?? throw new McpException("No HTTP request.");

    private static Guid? AppOf(HttpContext http) =>
        http.Request.RouteValues.TryGetValue(AppRouteValue, out var value) && Guid.TryParse(value?.ToString(), out var id) ? id : null;

    private static async ValueTask<ListToolsResult> ListAsync(RequestContext<ListToolsRequestParams> request, CancellationToken cancellationToken)
    {
        var http = Http(request.Services);
        IReadOnlyList<McpTool> tools = AppOf(http) is { } appId ? await AppTools.ForAsync(http, appId, cancellationToken) : ControlPlaneTools.All;
        return new ListToolsResult { Tools = tools.Select(Describe).ToList() };
    }

    private static async ValueTask<CallToolResult> CallAsync(RequestContext<CallToolRequestParams> request, CancellationToken cancellationToken)
    {
        var http = Http(request.Services);
        var name = request.Params?.Name ?? "";
        var arguments = new JsonObject();
        foreach (var (key, value) in request.Params?.Arguments ?? new Dictionary<string, JsonElement>())
        {
            arguments[key] = JsonNode.Parse(value.GetRawText());
        }

        try
        {
            IReadOnlyList<McpTool> tools = AppOf(http) is { } appId ? await AppTools.ForAsync(http, appId, cancellationToken) : ControlPlaneTools.All;
            var tool = tools.FirstOrDefault(t => t.Name == name) ?? throw new McpProtocolException($"There is no tool '{name}'.", McpErrorCode.InvalidParams);
            var result = await tool.Run(new ToolCall(http, arguments));
            return Success(result);
        }
        catch (EndgameProblem problem)
        {
            return Failure(problem);
        }
        catch (DomainException ex)
        {
            return Failure(EndgameProblem.Invalid(ex.Message));
        }
    }

    public static CallToolResult Success(object? result)
    {
        var node = result as JsonNode ?? JsonSerializer.SerializeToNode(result, Json);
        var text = node?.ToJsonString(Json) ?? "null";
        return new CallToolResult
        {
            Content = [new TextContentBlock { Text = text }],
            StructuredContent = JsonSerializer.SerializeToElement(node is JsonObject ? node : new JsonObject { ["result"] = node?.DeepClone() }, Json),
            IsError = false,
        };
    }

    public static CallToolResult Failure(EndgameProblem problem)
    {
        var body = new JsonObject
        {
            ["status"] = problem.Status,
            ["code"] = problem.Code,
            ["title"] = problem.Title,
            ["detail"] = problem.Detail,
        };
        foreach (var (key, value) in problem.Extensions)
        {
            body[key] = JsonSerializer.SerializeToNode(value, Json);
        }

        return new CallToolResult { Content = [new TextContentBlock { Text = body.ToJsonString(Json) }], StructuredContent = JsonSerializer.SerializeToElement(body, Json), IsError = true };
    }

    private static Tool Describe(McpTool tool) => new()
    {
        Name = tool.Name,
        Description = tool.Description,
        InputSchema = JsonSerializer.SerializeToElement(tool.Schema, Json),
        Annotations = new ToolAnnotations { ReadOnlyHint = tool.ReadOnly, DestructiveHint = !tool.ReadOnly && tool.Name.Contains("remove", StringComparison.Ordinal) },
    };

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
