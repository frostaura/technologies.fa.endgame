using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
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
        // Always the preview: the evaluator's requests never reach the app itself or its data.
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/internal/apps/{appId:D}/probe") { Content = JsonContent.Create(new { method, path, body }, options: Json.Web) };
        request.Headers.TryAddWithoutValidation(Endgame.Hosting.Contracts.HostingConventions.PreviewHeader, "1");
        using var response = await edgeControl.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw await ServiceProblemException.FromAsync(response, cancellationToken);
        }

        var answer = await response.Content.ReadFromJsonAsync<JsonObject>(Json.Web, cancellationToken) ?? [];
        return new PreviewAnswer(Json.Int(answer, "status") ?? 0, Json.Str(answer, "contentType") ?? "", Json.Str(answer, "body") ?? "");
    }
}

/// <summary>One answer of the running app to a signed-in call.</summary>
public sealed record AppCallAnswer(int Status, string ContentType, string Body);

/// <summary>The evaluator calling the running app as a signed-in test member (ARCH-004, <i>Checking the work</i>).</summary>
public interface IAppCaller
{
    Task<AppCallAnswer> CallAsync(Guid appId, string persona, string role, string method, string path, string? body, CancellationToken cancellationToken);
}

/// <summary>
/// A session for the test member from the control plane (<c>POST /internal/apps/{id}/test-session</c>), then the call
/// through Edge's control listener (<c>ANY /internal/apps/{id}/call/{path}</c>), which wakes the app and forwards the
/// session as <c>X-Endgame-Session</c>: the app sees that member as if they had come through its door. The Runner
/// joins no app network and never holds a member's own credentials.
/// </summary>
public sealed class EdgeAppCaller(HttpClient edgeControl, ControlPlaneClient controlPlane) : IAppCaller
{
    public const int MaxBody = 48 * 1024;

    public async Task<AppCallAnswer> CallAsync(Guid appId, string persona, string role, string method, string path, string? body, CancellationToken cancellationToken)
    {
        var session = await controlPlane.TestSessionAsync(appId, persona, role, cancellationToken);
        using var request = new HttpRequestMessage(new HttpMethod(method), $"/internal/apps/{appId:D}/call/{path.TrimStart('/')}");
        request.Headers.TryAddWithoutValidation(Endgame.Hosting.Contracts.HostingConventions.SessionHeader, session);
        // Always the preview being evaluated, with its own throwaway database: test members never write into the app's.
        request.Headers.TryAddWithoutValidation(Endgame.Hosting.Contracts.HostingConventions.PreviewHeader, "1");
        request.Headers.TryAddWithoutValidation("Accept", "application/json, text/html;q=0.8, */*;q=0.5");
        if (!string.IsNullOrEmpty(body) && method is not ("GET" or "DELETE"))
        {
            request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        }

        using var response = await edgeControl.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var type = response.Content.Headers.ContentType?.ToString() ?? "";
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        // Edge's own refusals (the app is paused, cannot be woken, the path is the platform's) are not the app's answer.
        if (response.Headers.TryGetValues(Endgame.Hosting.Contracts.HostingConventions.RefusalHeader, out var refusal))
        {
            throw new ServiceProblemException(response.StatusCode, refusal.First(), Json.Str(JsonNode.Parse(text) as JsonObject, "title") ?? text);
        }

        return new AppCallAnswer((int)response.StatusCode, type, text.Length > MaxBody ? text[..MaxBody] : text);
    }
}

/// <summary>
/// <c>call_app</c>: the evaluator's signed-in view of the running app. Every call is logged as its result, whose first
/// line (<c>HTTP 200 … — GET api/books as member-a (member)</c>) is what the evaluation gate reads to see which calls were made.
/// </summary>
public sealed partial class CallAppTool(IAppCaller caller, Guid appId) : ITool
{
    public const string ToolName = "call_app";

    public string Name => ToolName;

    public string Description => "Call the running app as a SIGNED-IN test member, exactly as a person using it would: any method, a path relative to the app (for example 'api/bookings' or 'api/courts/2/bookings?date=2026-11-25'), an optional JSON body. 'as' names the test member (the same name is the same person every time, so ownership can be checked with two names); 'role' is member (an ordinary member), admin, or viewer. Use it to show each requirement working in the running app.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["method"] = Schema.Enum("The HTTP method.", "GET", "POST", "PUT", "PATCH", "DELETE"),
        ["path"] = Schema.Str("The path under the app's address, without a leading slash."),
        ["body"] = Schema.Str("A JSON body, for POST, PUT and PATCH."),
        ["as"] = Schema.Str("The test member: a lowercase name such as member-a, member-b or club-admin. Default member-a."),
        ["role"] = Schema.Enum("The test member's role in the organisation. Default member.", "member", "admin", "viewer"),
    }, "method", "path");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var method = (Json.Str(call.Arguments, "method") ?? "GET").ToUpperInvariant();
        var path = (Json.Str(call.Arguments, "path") ?? "").Trim().TrimStart('/');
        var persona = Json.Str(call.Arguments, "as") is { Length: > 0 } p ? p.Trim().ToLowerInvariant() : "member-a";
        var role = Json.Str(call.Arguments, "role") ?? "member";
        var platformRole = role switch { "admin" => "admin", "viewer" => "viewer", _ => "builder" };
        try
        {
            var answer = await caller.CallAsync(appId, persona, platformRole, method, path, Json.Str(call.Arguments, "body"), cancellationToken);
            return new ToolOutcome(string.Create(CultureInfo.InvariantCulture, $"HTTP {answer.Status} {answer.ContentType} — {method} {path} as {persona} ({role})\n\n{OutputText.Truncate(answer.Body, 8000)}"));
        }
        catch (Exception e) when (e is ServiceProblemException or HttpRequestException)
        {
            return ToolOutcome.Error($"The running app could not be called: {e.Message}. A requirement you cannot show working in the running app is not met.", "app_unreachable");
        }
    }

    /// <summary>The calls the agent made that the app answered (signed in, or to a webhook as its device), as <c>"GET api/books"</c> (query dropped), read back from the run log.</summary>
    public static IReadOnlyList<string> CallsIn(IEnumerable<RunEvent> log, string agentId) =>
        log.Where(e => e.Type == HarnessEvents.ToolResult && Json.Str(e.Payload, HarnessEvents.AgentField) == agentId
                && Json.Str(e.Payload, "name") is ToolName or CallWebhookTool.ToolName && Json.Bool(e.Payload, "isError") != true)
            .Select(e => CallLine().Match((Json.Str(e.Payload, "content") ?? "").Split('\n')[0]))
            .Where(m => m.Success)
            .Select(m => $"{m.Groups[1].Value} {m.Groups[2].Value.Split('?')[0]}")
            .Distinct(StringComparer.Ordinal)
            .ToList();

    [System.Text.RegularExpressions.GeneratedRegex(@"^HTTP \d{3} .*? — (GET|POST|PUT|PATCH|DELETE) (\S*) as ")]
    private static partial System.Text.RegularExpressions.Regex CallLine();
}

/// <summary>
/// <c>call_webhook</c>: one of the app's declared webhooks called the way its device would — the control plane signs it
/// with the vault's secret (and makes the secret at the app when nobody has set it), so the evaluator never holds one.
/// Its result's first line has <c>call_app</c>'s shape, so the gate counts it as a call to the running app.
/// </summary>
public sealed class CallWebhookTool(ControlPlaneClient controlPlane, Guid appId) : ITool
{
    public const string ToolName = "call_webhook";

    public string Name => ToolName;

    public string Description => "Call one of the app's declared webhooks (an incoming endpoint for a device or another service, at hooks/<name>) exactly as the device would: the platform signs the request with the vault secret the app verifies with. Read the app's code for the webhook's name, the header it checks, its scheme (MapWebhook with WebhookVerification.HmacSha256(header, secretName, prefix) or SharedToken(header, secretName)) and the body it expects.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["name"] = Schema.Str("The webhook's declared name, as in MapWebhook(\"name\", …)."),
        ["header"] = Schema.Str("The header the app verifies, for example X-Court-Signature."),
        ["scheme"] = Schema.Enum("How it is verified.", "hmac-sha256", "shared-token"),
        ["secret_name"] = Schema.Str("The vault secret the app verifies with, in UPPER_SNAKE_CASE."),
        ["prefix"] = Schema.Str("For hmac-sha256: what comes before the hex signature (the kit's default is sha256=)."),
        ["body"] = Schema.Str("The JSON body the device sends."),
    }, "name", "header", "scheme", "secret_name", "body");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var name = (Json.Str(call.Arguments, "name") ?? "").Trim();
        var scheme = Json.Str(call.Arguments, "scheme") ?? "hmac-sha256";
        try
        {
            var answer = await controlPlane.TestWebhookAsync(appId, new JsonObject
            {
                ["name"] = name,
                ["header"] = Json.Str(call.Arguments, "header"),
                ["scheme"] = scheme,
                ["secretName"] = Json.Str(call.Arguments, "secret_name"),
                ["prefix"] = Json.Str(call.Arguments, "prefix") ?? (scheme == "hmac-sha256" ? "sha256=" : ""),
                ["body"] = Json.Str(call.Arguments, "body") ?? "",
                ["preview"] = true, // the evaluator only ever calls the preview it is evaluating
            }, cancellationToken);
            var made = Json.Bool(answer, "secretCreated") == true ? $" (the secret {Json.Str(answer, "secretName")} was not set, so the platform made one at the app)" : "";
            return new ToolOutcome(string.Create(CultureInfo.InvariantCulture, $"HTTP {Json.Int(answer, "status")} {Json.Str(answer, "contentType")} — POST hooks/{name} as device (signed){made}\n\n{OutputText.Truncate(Json.Str(answer, "body") ?? "", 8000)}"));
        }
        catch (Exception e) when (e is ServiceProblemException or HttpRequestException)
        {
            return ToolOutcome.Error($"The webhook could not be called: {e.Message}.", "app_unreachable");
        }
    }
}

/// <summary><c>sent_emails</c>: the e-mail the running app asked the platform to send, newest first — the evidence for an e-mail requirement.</summary>
public sealed class SentEmailsTool(ControlPlaneClient controlPlane, Guid appId) : ITool
{
    public string Name => "sent_emails";

    public string Description => "List the e-mail the running app has asked the platform to send, newest first: recipients, subject, text and delivery status. Mail the preview sends is held, never delivered, and still counts as sent by the app. Use it after the call_app call that should send one.";

    public JsonObject Parameters => Schema.Object(new JsonObject { ["limit"] = Schema.Int("At most this many (1-20).") });

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        try
        {
            var mails = await controlPlane.SentEmailsAsync(appId, Math.Clamp(Json.Int(call.Arguments, "limit") ?? 10, 1, 20), cancellationToken);
            return new ToolOutcome(mails.Count == 0
                ? "The app has sent no e-mail."
                : string.Join("\n\n", mails.OfType<JsonObject>().Select(m => $"To: {string.Join(", ", Json.Strings(m, "to"))}\nSubject: {Json.Str(m, "subject")}\nStatus: {StatusLine(Json.Str(m, "status"))} at {Json.Str(m, "createdAt")}\n{OutputText.Truncate(Json.Str(m, "text") ?? "", 1500)}")));
        }
        catch (ServiceProblemException e)
        {
            return ToolOutcome.Error($"The sent e-mail could not be read: {e.Detail}. Count an e-mail requirement as not shown.", "unavailable");
        }
    }

    /// <summary>A preview's mail is held: the app sent it, and nobody received it.</summary>
    public static string StatusLine(string? status) => status == "held" ? "held (sent by the preview, kept here and never delivered)" : status ?? "unknown";
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
public sealed class StartIdeaTool(ControlPlaneClient controlPlane, string scope) : ITool, IApprovalTitle
{
    public string ApprovalTitle(JsonObject arguments) => $"Start researching an idea: {Json.Str(arguments, "text")}";

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

public sealed class AdjustSettingTool(ControlPlaneClient controlPlane, string scope) : ITool, IApprovalTitle
{
    /// <summary>What approving the change does, in the words the autonomy and app screens use; never the setting's key.</summary>
    public string ApprovalTitle(JsonObject arguments)
    {
        var raw = (Json.Str(arguments, "value") ?? "").Trim().Trim('"');
        var on = raw is "true" or "on";
        var where = "here";
        return Json.Str(arguments, "key") switch
        {
            "autonomy" => raw == "checkpoints" ? $"Stop for your sign-off at checkpoints {where}" : $"Switch {where} to auto-mode",
            "checkpoint.start" => $"Turn {(on ? "on" : "off")} the “Before work starts” checkpoint {where}",
            "checkpoint.plan" => $"Turn {(on ? "on" : "off")} the “Before the plan is carried out” checkpoint {where}",
            "checkpoint.hire" => $"Turn {(on ? "on" : "off")} the “Before anyone is hired” checkpoint {where}",
            "sleep.mode" => raw == "always_on" ? $"Keep the apps {where} always on" : $"Let the apps {where} sleep when nobody is using them",
            "sleep.idle_minutes" => $"Let the apps {where} sleep after {raw} minutes without a visitor",
            "workforce.idle_days" => $"Flag employees {where} who have had no work for {raw} days",
            _ => $"Change a setting {where}",
        };
    }

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

/// <summary>
/// <c>change_app</c>: asks the factory to change an app that is already built (CHG-01), through
/// <c>POST /internal/apps/changes</c> — the estimate is shown first in the change's own run, then a plan, the build, the checks
/// and the new version. The owner confirms first.
/// </summary>
public sealed class ChangeAppTool(ControlPlaneClient controlPlane, string scope) : ITool, IApprovalTitle
{
    public string Name => "change_app";

    public string Description => "Ask the factory to change an app that is already built: a plan for the change, the change built and checked in the running app, everything it did before checked again, then the new version published. The owner is asked to confirm first.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["request"] = Schema.Str("The change, in the owner's words."),
        ["app"] = Schema.Str("The app's scope path, if the conversation is not already about one app (for example 'acme/labs/bookings/web')."),
    }, "request");

    public ToolEffect Effect => ToolEffect.External;

    public string ApprovalTitle(JsonObject arguments) => $"Change the app: {Json.Str(arguments, "request")}";

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        if (string.IsNullOrWhiteSpace(Json.Str(arguments, "request")))
        {
            return (ToolTargets.None, "change_app needs the change, in the owner's words.");
        }

        var app = Json.Str(arguments, "app") is { Length: > 0 } a ? a : scope;
        return app == scope || app.StartsWith(scope + "/", StringComparison.Ordinal)
            ? (new ToolTargets([], $"{app}: {Json.Str(arguments, "request")}"), null)
            : (ToolTargets.None, $"'{app}' is outside {scope}, the scope this conversation is about.");
    }

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var app = Json.Str(call.Arguments, "app") is { Length: > 0 } a ? a : scope;
        using var response = await controlPlane.Http.PostAsJsonAsync("/internal/apps/changes", new { scope = app, request = Json.Str(call.Arguments, "request") }, Json.Web, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode
            ? new ToolOutcome($"The change has started; its estimate is shown first in its own work: {OutputText.Truncate(text, 2000)}")
            : ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The change could not be started ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it did not start."), "tool_error");
    }
}

/// <summary>
/// <c>try_again</c>: starts a failed, cancelled or budget-stopped piece of work again (CHG-03) through
/// <c>POST /internal/runs/{id}/retry</c>, picking up what was already built and agreed. The owner confirms first.
/// </summary>
public sealed class TryAgainTool(ControlPlaneClient controlPlane, string scope) : ITool, IApprovalTitle
{
    public string Name => "try_again";

    public string Description => "Start again a research, a build or a change that failed, was cancelled or stopped for budget, picking up what was already built and agreed (read 'runs' to find it). The owner is asked to confirm first.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["run_id"] = Schema.Str("The id of the run that stopped, from read_organisation 'runs'."),
        ["title"] = Schema.Str("That run's title, as read, so the owner sees what is being tried again."),
    }, "run_id", "title");

    public ToolEffect Effect => ToolEffect.External;

    public string ApprovalTitle(JsonObject arguments) => $"Try again: {Json.Str(arguments, "title")}";

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        Guid.TryParse(Json.Str(arguments, "run_id"), out _) ? (new ToolTargets([], Json.Str(arguments, "run_id")), null) : (ToolTargets.None, "try_again needs the run's id, from read_organisation 'runs'.");

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var id = Guid.Parse(Json.Str(call.Arguments, "run_id")!);
        using var response = await controlPlane.Http.PostAsJsonAsync($"/internal/runs/{id:D}/retry", new { scope }, Json.Web, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode
            ? new ToolOutcome($"Started again: {OutputText.Truncate(text, 2000)}")
            : ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"It could not be started again ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it did not start."), "tool_error");
    }
}
