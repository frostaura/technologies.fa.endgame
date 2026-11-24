using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Platform;
using Endgame.Harness.Tools;

namespace Endgame.Runner.Agents;

/// <summary>An HTTP answer from an app's running preview.</summary>
public sealed record PreviewAnswer(int Status, string ContentType, string Body);

/// <summary>Calls an app's private preview over HTTP, as a signed-in evaluator would.</summary>
public interface IPreviewProbe
{
    Task<PreviewAnswer> SendAsync(Guid appId, string method, string path, string? body, CancellationToken cancellationToken);
}

/// <summary>
/// Proposed: Edge's control listener (which apps cannot reach) proxies one request into a private app
/// as the platform's evaluator: <c>POST /internal/apps/{id}/probe</c> {method, path, body} →
/// {status, contentType, body}. The Runner joins no app network.
/// </summary>
public sealed class EdgePreviewProbe(HttpClient edgeControl) : IPreviewProbe
{
    public async Task<PreviewAnswer> SendAsync(Guid appId, string method, string path, string? body, CancellationToken cancellationToken)
    {
        using var response = await edgeControl.PostAsJsonAsync($"/internal/apps/{appId:D}/probe", new { method, path, body }, Json.Web, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw await ServiceProblemException.FromAsync(response, cancellationToken);
        }

        var answer = await response.Content.ReadFromJsonAsync<JsonObject>(Json.Web, cancellationToken) ?? [];
        return new PreviewAnswer(Json.Int(answer, "status") ?? 0, Json.Str(answer, "contentType") ?? "", Json.Str(answer, "body") ?? "");
    }
}

/// <summary><c>check_preview</c>: the evaluator's view of the running app.</summary>
public sealed class CheckPreviewTool(IPreviewProbe probe, Guid appId) : ITool
{
    public string Name => "check_preview";

    public string Description => "Send one HTTP request to the app's running private preview and get the status and body back. Paths are relative to the app's address, for example 'api/notes' or '' for the home page.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["method"] = Schema.Enum("The HTTP method.", "GET", "POST", "PUT", "PATCH", "DELETE"),
        ["path"] = Schema.Str("The path under the app's address, without a leading slash."),
        ["body"] = Schema.Str("A JSON body, for POST, PUT and PATCH."),
    }, "method", "path");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var method = Json.Str(call.Arguments, "method") ?? "GET";
        var path = (Json.Str(call.Arguments, "path") ?? "").TrimStart('/');
        try
        {
            var answer = await probe.SendAsync(appId, method, path, Json.Str(call.Arguments, "body"), cancellationToken);
            return new ToolOutcome(string.Create(CultureInfo.InvariantCulture, $"HTTP {answer.Status} {answer.ContentType}\n\n{OutputText.Truncate(answer.Body, 8000)}"));
        }
        catch (Exception e) when (e is ServiceProblemException or HttpRequestException)
        {
            return ToolOutcome.Error($"The preview could not be reached: {e.Message}. Count this check as failed.", "preview_unreachable");
        }
    }
}

/// <summary>
/// The conversation's read tools over the tree: the scope's resolved cascade (levels, context,
/// settings, budgets), its workforce, and — through endpoints this lane asks for — its tasks, runs
/// and credits.
/// </summary>
public sealed class ReadOrganisationTool(ControlPlaneClient controlPlane, string scope) : ITool
{
    public string Name => "read_organisation";

    public string Description => "Read about the organisation at the scope being discussed (or a scope beneath it): 'overview' (levels, context, settings, budgets), 'workforce', 'tasks', 'runs' or 'credits'.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["what"] = Schema.Enum("What to read.", "overview", "workforce", "tasks", "runs", "credits"),
        ["scope"] = Schema.Str("A scope path beneath the one being discussed, such as 'frostaura/technologies'. Default: the one being discussed."),
    }, "what");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        Json.Str(arguments, "scope") is { Length: > 0 } s && !Within(s) ? (ToolTargets.None, $"'{s}' is outside {scope}, the scope this conversation is about.") : (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var at = Json.Str(call.Arguments, "scope") is { Length: > 0 } s ? s : scope;
        var path = Json.Str(call.Arguments, "what") switch
        {
            "workforce" => $"/internal/employees?scope={Uri.EscapeDataString(at)}",
            "tasks" => $"/internal/tasks?scope={Uri.EscapeDataString(at)}",
            "runs" => $"/internal/runs?scope={Uri.EscapeDataString(at)}&limit=20",
            "credits" => $"/internal/credits?scope={Uri.EscapeDataString(at)}",
            _ => $"/internal/context?scope={Uri.EscapeDataString(at)}",
        };
        using var response = await controlPlane.Http.GetAsync(path, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            // A failed read is never an empty answer.
            return ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The read failed ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it could not be read; do not say there is nothing."), "read_failed");
        }

        return new ToolOutcome(OutputText.Truncate(text, 12_000));
    }

    private bool Within(string other) => other == scope || other.StartsWith(scope + "/", StringComparison.Ordinal);
}

/// <summary>Proposed endpoints: <c>POST /internal/ideas</c> {scope, text, constraints, by: "conversation"} and <c>PUT /internal/cascade</c> {scope, kind: "setting", key, value}.</summary>
public sealed class StartIdeaTool(ControlPlaneClient controlPlane, string scope) : ITool
{
    public string Name => "start_idea";

    public string Description => "Start research on a new product idea at the scope being discussed. The owner is asked to confirm first.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["text"] = Schema.Str("The idea, in the owner's words."),
        ["constraints"] = Schema.Strings("Constraints the owner stated."),
    }, "text");

    public ToolEffect Effect => ToolEffect.External;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        string.IsNullOrWhiteSpace(Json.Str(arguments, "text")) ? (ToolTargets.None, "start_idea needs the idea's text.") : (new ToolTargets([], Json.Str(arguments, "text")), null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        using var response = await controlPlane.Http.PostAsJsonAsync("/internal/ideas", new { scope, text = Json.Str(call.Arguments, "text"), constraints = Json.Strings(call.Arguments, "constraints") }, Json.Web, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode
            ? new ToolOutcome($"Research started: {OutputText.Truncate(text, 2000)}")
            : ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The idea could not be started ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}"), "tool_error");
    }
}

public sealed class AdjustSettingTool(ControlPlaneClient controlPlane, string scope) : ITool
{
    public string Name => "adjust_setting";

    public string Description => "Change a setting at the scope being discussed (for example sleep after idle, autonomy, checkpoints). The owner is asked to confirm first.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["key"] = Schema.Str("The setting's key."),
        ["value"] = Schema.Str("The new value, as JSON (a string in quotes, a number, true or false)."),
    }, "key", "value");

    public ToolEffect Effect => ToolEffect.External;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        string.IsNullOrWhiteSpace(Json.Str(arguments, "key")) ? (ToolTargets.None, "adjust_setting needs a key.") : (new ToolTargets([], $"{Json.Str(arguments, "key")}={Json.Str(arguments, "value")}"), null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        JsonNode? value;
        try
        {
            value = JsonNode.Parse(Json.Str(call.Arguments, "value") ?? "null");
        }
        catch (System.Text.Json.JsonException)
        {
            value = JsonValue.Create(Json.Str(call.Arguments, "value"));
        }

        var body = new JsonObject { ["scope"] = scope, ["kind"] = "setting", ["key"] = Json.Str(call.Arguments, "key"), ["value"] = value };
        using var response = await controlPlane.Http.PutAsync("/internal/cascade", new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"), cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode
            ? new ToolOutcome($"Setting changed: {OutputText.Truncate(text, 1000)}")
            : ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The setting could not be changed ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}"), "tool_error");
    }
}
