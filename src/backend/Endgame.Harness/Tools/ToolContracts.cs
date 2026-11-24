using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Tools;

/// <summary>What a tool can do to the world, which is what the permission pipeline weighs.</summary>
public enum ToolEffect
{
    /// <summary>Reads the workspace or the harness's own state. Allowed in plan mode.</summary>
    ReadOnly,

    /// <summary>Writes files in the workspace.</summary>
    WritesFiles,

    /// <summary>Runs commands in the workspace container.</summary>
    Executes,

    /// <summary>Changes state outside the workspace: commits, tasks, the platform.</summary>
    External,
}

/// <summary>A tool's answer to the model. Errors are text that say what went wrong and how to fix it.</summary>
public sealed record ToolOutcome(string Content, bool IsError = false, string? ErrorKind = null)
{
    /// <summary>The call changed files (a sub-agent's edits count as its parent's).</summary>
    public bool Edited { get; init; }

    /// <summary>Credits the call itself spent (a sub-agent's model calls).</summary>
    public decimal Credits { get; init; }

    public static ToolOutcome Error(string content, string kind) => new(content, true, kind);
}

/// <summary>What one tool call is aimed at: the paths it touches and the command it runs.</summary>
public sealed record ToolTargets(IReadOnlyList<WorkspacePath> Paths, string? Command)
{
    public static readonly ToolTargets None = new([], null);
}

/// <summary>One of the agent's tools. It executes inside the workspace, never beside the harness.</summary>
public interface ITool
{
    string Name { get; }

    /// <summary>What the model reads to decide when to call it.</summary>
    string Description { get; }

    /// <summary>JSON Schema for the arguments.</summary>
    JsonObject Parameters { get; }

    ToolEffect Effect { get; }

    /// <summary>The paths and command a call would touch, for the permission check; an error when the arguments cannot be targeted.</summary>
    (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root);

    Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken);
}

/// <summary>One call of a tool, with everything it may use.</summary>
public sealed record ToolCall(string CallId, string Name, JsonObject Arguments, ToolContext Context);

/// <summary>What tools reach: the workspace, the agent's own state, the run's services and its log.</summary>
public sealed record ToolContext(IWorkspace Workspace, AgentState State, AgentServices Services, AgentEventWriter Events, AgentDefinition Agent);

/// <summary>Builds the JSON Schema the chat format expects.</summary>
public static class Schema
{
    public static JsonObject Function(ITool tool)
    {
        ArgumentNullException.ThrowIfNull(tool);
        return new JsonObject
        {
            ["type"] = "function",
            ["function"] = new JsonObject
            {
                ["name"] = tool.Name,
                ["description"] = tool.Description,
                ["parameters"] = tool.Parameters.DeepClone(),
            },
        };
    }

    public static JsonObject Object(JsonObject properties, params string[] required) => new()
    {
        ["type"] = "object",
        ["properties"] = properties,
        ["required"] = Json.Array(required),
        ["additionalProperties"] = false,
    };

    public static JsonObject Str(string description) => new() { ["type"] = "string", ["description"] = description };

    public static JsonObject Int(string description) => new() { ["type"] = "integer", ["description"] = description };

    public static JsonObject Bool(string description) => new() { ["type"] = "boolean", ["description"] = description };

    public static JsonObject Enum(string description, params string[] values) => new() { ["type"] = "string", ["description"] = description, ["enum"] = Json.Array(values) };

    public static JsonObject Strings(string description) => new() { ["type"] = "array", ["description"] = description, ["items"] = new JsonObject { ["type"] = "string" } };
}

/// <summary>The tools one agent has, by name. A sub-agent gets a subset of its parent's.</summary>
public sealed class ToolRegistry
{
    private readonly Dictionary<string, ITool> tools = new(StringComparer.Ordinal);

    public ToolRegistry(IEnumerable<ITool> tools)
    {
        ArgumentNullException.ThrowIfNull(tools);
        foreach (var tool in tools)
        {
            this.tools[tool.Name] = tool;
        }
    }

    public IReadOnlyCollection<string> Names => tools.Keys.Order(StringComparer.Ordinal).ToList();

    public bool TryGet(string name, out ITool tool) => tools.TryGetValue(name, out tool!);

    public ToolRegistry Subset(IEnumerable<string> names) => new(names.Where(tools.ContainsKey).Distinct(StringComparer.Ordinal).Select(n => tools[n]));

    public ToolRegistry Without(params string[] names) => new(tools.Values.Where(t => !names.Contains(t.Name)));

    public ToolRegistry With(params ITool[] more) => new(tools.Values.Concat(more));

    public JsonArray Schemas() => new(tools.Values.OrderBy(t => t.Name, StringComparer.Ordinal).Select(t => (JsonNode)Schema.Function(t)).ToArray());
}
