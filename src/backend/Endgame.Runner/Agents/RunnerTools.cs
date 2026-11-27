using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Platform;
using Endgame.Harness.Tools;
using Endgame.Runner.Execution;

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
            throw new ServiceProblemException(response.StatusCode, refusal.First(), Json.Str(Json.ParseTolerant(text) as JsonObject, "title") ?? (string.IsNullOrWhiteSpace(text) ? refusal.First() : OutputText.Truncate(text, 500)));
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

    public string Description => "Call the running app as a SIGNED-IN test member, exactly as a person using it would: any method, a path relative to the app (for example 'api/bookings' or 'api/courts/2/bookings?date=2026-11-25'), an optional JSON body. 'as' names the test member (the same name is the same person every time, so ownership can be checked with two names); 'role' is member (an ordinary member), admin, or viewer. Every call signs that member in afresh, as a person coming back later would be: the same person, a new session. Use it to show each requirement working in the running app.";

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
            var sent = Json.Str(call.Arguments, "body");
            var answer = await caller.CallAsync(appId, persona, platformRole, method, path, sent, cancellationToken);
            // What was sent is kept on its own line, so the gate can tell the same call made again from a different one (R3-5).
            var sentLine = string.IsNullOrWhiteSpace(sent) ? "" : $"\n{SentPrefix}{OutputText.Truncate(sent.ReplaceLineEndings(" "), 2000)}";
            return new ToolOutcome(string.Create(CultureInfo.InvariantCulture, $"HTTP {answer.Status} {answer.ContentType} — {method} {path} as {persona} ({role}){sentLine}\n\n{OutputText.Truncate(answer.Body, 8000)}"));
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

    public const string SentPrefix = "Sent: ";

    /// <summary>
    /// Every signed-in call the agent made that the app answered, in the order made: method, path (query dropped), who, the
    /// status, what was sent and what came back — read back from the run log, for the gate's check of coming back later (R3-5).
    /// </summary>
    public static IReadOnlyList<AppAttempt> AttemptsIn(IEnumerable<RunEvent> log, string agentId) =>
        log.Where(e => e.Type == HarnessEvents.ToolResult && Json.Str(e.Payload, HarnessEvents.AgentField) == agentId
                && Json.Str(e.Payload, "name") == ToolName && Json.Bool(e.Payload, "isError") != true)
            .Select(e => Json.Str(e.Payload, "content") ?? "")
            .Select(content => (content, head: Attempt().Match(content.Split('\n')[0])))
            .Where(x => x.head.Success)
            .Select(x =>
            {
                var split = x.content.IndexOf("\n\n", StringComparison.Ordinal);
                var header = split < 0 ? x.content : x.content[..split];
                var sent = header.Split('\n').Skip(1).FirstOrDefault(l => l.StartsWith(SentPrefix, StringComparison.Ordinal))?[SentPrefix.Length..];
                return new AppAttempt(x.head.Groups[2].Value, x.head.Groups[3].Value.Split('?')[0], x.head.Groups[4].Value,
                    int.Parse(x.head.Groups[1].Value, CultureInfo.InvariantCulture), sent, split < 0 ? "" : x.content[(split + 2)..]);
            })
            .ToList();

    [System.Text.RegularExpressions.GeneratedRegex(@"^HTTP \d{3} .*? — (GET|POST|PUT|PATCH|DELETE) (\S*) as ")]
    private static partial System.Text.RegularExpressions.Regex CallLine();

    [System.Text.RegularExpressions.GeneratedRegex(@"^HTTP (\d{3}) .*? — (GET|POST|PUT|PATCH|DELETE) (\S*) as (\S+) \(")]
    private static partial System.Text.RegularExpressions.Regex Attempt();
}

/// <summary>One signed-in call to the running app, as the run log holds it: who made it, what was sent, what came back.</summary>
public sealed record AppAttempt(string Method, string Path, string Persona, int Status, string? Sent, string Body)
{
    /// <summary>The call as the gate's other lists name it: <c>"POST api/trips/7/join"</c>.</summary>
    public string Call => $"{Method} {Path}";
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
public sealed partial class CheckPreviewTool(IPreviewProbe probe, Guid appId) : ITool
{
    public string Name => ToolName;

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
            return new ToolOutcome(string.Create(CultureInfo.InvariantCulture, $"HTTP {answer.Status} {answer.ContentType} — {method.ToUpperInvariant()} {path} {SignedOut}\n\n{OutputText.Truncate(answer.Body, 8000)}"));
        }
        catch (Exception e) when (e is ServiceProblemException or HttpRequestException)
        {
            return ToolOutcome.Error($"The preview could not be reached: {e.Message}. Count this check as failed.", "preview_unreachable");
        }
    }

    public const string ToolName = "check_preview";

    /// <summary>How a result's first line says the call was made: as a visitor who is not signed in.</summary>
    public const string SignedOut = "signed out";

    /// <summary>
    /// The calls the agent made signed out that the preview answered, as <c>"GET api/books"</c> (query dropped): what shows a
    /// requirement that needs no sign-in working (R2-11).
    /// </summary>
    public static IReadOnlyList<string> CallsIn(IEnumerable<RunEvent> log, string agentId) =>
        log.Where(e => e.Type == HarnessEvents.ToolResult && Json.Str(e.Payload, HarnessEvents.AgentField) == agentId
                && Json.Str(e.Payload, "name") == ToolName && Json.Bool(e.Payload, "isError") != true)
            .Select(e => CallLine().Match((Json.Str(e.Payload, "content") ?? "").Split('\n')[0]))
            .Where(m => m.Success)
            .Select(m => $"{m.Groups[1].Value} {m.Groups[2].Value.Split('?')[0]}")
            .Distinct(StringComparer.Ordinal)
            .ToList();

    [System.Text.RegularExpressions.GeneratedRegex(@"^HTTP \d{3} .*? — (GET|POST|PUT|PATCH|DELETE) (\S*) signed out$")]
    private static partial System.Text.RegularExpressions.Regex CallLine();
}

/// <summary>
/// The conversation's read tools over the tree: what is at the scope and beneath it (every division, project and app,
/// each app's state, and home's counts), the scope's resolved cascade (levels, context, settings, budgets), its
/// workforce, its tasks, runs and credits.
/// </summary>
public sealed class ReadOrganisationTool(ControlPlaneClient controlPlane, string scope) : ITool
{
    public string Name => "read_organisation";

    public string Description => "Read about the organisation at the scope being discussed (or a scope beneath it): 'contents' (every division, project and app there and beneath it, each app with its state — live, sleeping, building, never built, paused, down, archived — and the counts home shows; read it whenever you are asked how many apps, projects, divisions or employees there are, or which apps are live), 'overview' (the contents, then the levels on the path down to the scope, context, settings, budgets, and needsYou: everything waiting on the owner — approvals, verdicts, hires — so read it whenever you are asked what is waiting), 'workforce', 'tasks', 'runs' (the 20 most recent pieces of work, chats included: never count apps from it) or 'credits'.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["what"] = Schema.Enum("What to read.", "contents", "overview", "workforce", "tasks", "runs", "credits"),
        ["scope"] = Schema.Str("A scope path beneath the one being discussed, such as 'frostaura/technologies'. Default: the one being discussed."),
    }, "what");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) =>
        Json.Str(arguments, "scope") is { Length: > 0 } s && !Within(s) ? (ToolTargets.None, $"'{s}' is outside {scope}, the scope this conversation is about.") : (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var at = Uri.EscapeDataString(Json.Str(call.Arguments, "scope") is { Length: > 0 } s ? s : scope);
        var what = Json.Str(call.Arguments, "what");
        var path = what switch
        {
            "contents" => $"/internal/contents?scope={at}",
            "workforce" => $"/internal/employees?scope={at}",
            "tasks" => $"/internal/tasks?scope={at}",
            "runs" => $"/internal/runs?scope={at}&limit=20",
            "credits" => $"/internal/credits?scope={at}",
            _ => $"/internal/context?scope={at}",
        };
        var (ok, text) = await ReadAsync(path, cancellationToken);
        if (!ok)
        {
            return Failed(text);
        }

        if (what is "workforce" or "tasks" or "runs" or "credits" or "contents")
        {
            return new ToolOutcome(OutputText.Truncate(text, 12_000));
        }

        // The overview leads with what is there (R5-1): its levels are only the path down to the scope, and a model that
        // counted them, or the apps it happened to see in recent runs, said "we run 1 app" of an organisation with three.
        var (contentsOk, contents) = await ReadAsync($"/internal/contents?scope={at}", cancellationToken);
        if (!contentsOk)
        {
            return Failed(contents);
        }

        var overview = new JsonObject { ["contents"] = JsonNode.Parse(contents), ["cascade"] = JsonNode.Parse(text) };
        return new ToolOutcome(OutputText.Truncate(overview.ToJsonString(), 16_000));
    }

    private async Task<(bool Ok, string Text)> ReadAsync(string path, CancellationToken cancellationToken)
    {
        using var response = await controlPlane.Http.GetAsync(path, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode ? (true, text) : (false, string.Create(CultureInfo.InvariantCulture, $"{(int)response.StatusCode}): {OutputText.Truncate(text, 600)}"));
    }

    // A failed read is never an empty answer.
    private static ToolOutcome Failed(string why) =>
        ToolOutcome.Error($"The read failed ({why}. Tell the owner it could not be read; do not say there is nothing.", "read_failed");

    private bool Within(string other) => other == scope || other.StartsWith(scope + "/", StringComparison.Ordinal);
}

/// <summary>
/// Told when a conversation's tool has started a piece of work: the started run's id, what kind of work it is
/// (<c>research</c>, <c>change</c> or <c>retry</c>) and its title, so the conversation can follow it (ARCH-012).
/// </summary>
public delegate Task WorkStarted(Guid runId, string workKind, string title, CancellationToken cancellationToken);

/// <summary>Reads the started run out of what the control plane answered, and passes it on.</summary>
internal static class StartedWork
{
    public static async Task ReportAsync(WorkStarted? started, string answer, Func<JsonObject, JsonObject?> runOf, string workKind, Func<JsonObject, JsonObject, string?> titleOf, CancellationToken cancellationToken)
    {
        if (started is null || Json.ParseTolerant(answer) is not JsonObject body || runOf(body) is not { } run || !Guid.TryParse(Json.Str(run, "id"), out var id))
        {
            return;
        }

        await started(id, workKind, OutputText.Truncate(titleOf(body, run) ?? Json.Str(run, "title") ?? "", 200), cancellationToken);
    }
}

/// <summary><c>POST /internal/ideas</c> {scope, text, constraints} → <c>{ idea, run, estimate }</c>.</summary>
public sealed class StartIdeaTool(ControlPlaneClient controlPlane, string scope, WorkStarted? started = null) : ITool, IApprovalTitle
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
        if (!response.IsSuccessStatusCode)
        {
            return ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The idea could not be started ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}"), "tool_error");
        }

        await StartedWork.ReportAsync(started, text, b => b["run"] as JsonObject, "research", (b, _) => Json.Str(b["idea"] as JsonObject, "title"), cancellationToken);
        return new ToolOutcome($"Research started: {OutputText.Truncate(text, 2000)}");
    }
}

/// <summary>
/// <c>adjust_setting</c>: one of the settings an agent may change (<see cref="Endgame.Domain.Cascade.AgentSettings"/>), the
/// owner confirming first. A key it does not take, or a value that key cannot hold, is refused before anyone is asked, so
/// one request raises one approval, titled with exactly what will change (D45); the result is composed here, with the
/// place's name, so the reply never shows a path (D46).
/// </summary>
public sealed partial class AdjustSettingTool(ControlPlaneClient controlPlane, string scope, PlaceNames? places = null) : ITool, IApprovalTitle
{
    private readonly PlaceNames names = places ?? new PlaceNames([]);

    /// <summary>What approving does, and what is true once it is done, in the words the autonomy and app screens use; never the key.</summary>
    public static (string Title, string Done)? Describe(string? key, string? value, PlaceNames names, string scope)
    {
        ArgumentNullException.ThrowIfNull(names);
        ArgumentNullException.ThrowIfNull(scope);
        return Endgame.Domain.Cascade.SettingWords.Describe(key, value, names.Name(scope), names.Apps(scope));
    }

    private static JsonNode? Parsed(string? raw)
    {
        return Json.ParseTolerant(raw) ?? (raw is null ? null : JsonValue.Create(raw));
    }

    /// <summary>The values each key takes, as the owner would say them, for a refusal.</summary>
    public static string Expected(string key) => key switch
    {
        Endgame.Domain.Cascade.Autonomy.Key => "\"auto\" or \"checkpoints\"",
        Endgame.Domain.Cascade.CascadeKeys.SleepMode => "\"auto\" or \"always_on\"",
        Endgame.Domain.Cascade.CascadeKeys.SleepIdleMinutes or Endgame.Domain.Cascade.AgentSettings.WorkforceIdleDays => "a whole number above 0",
        _ => "true or false",
    };

    public string ApprovalTitle(JsonObject arguments) =>
        Describe(Json.Str(arguments, "key"), Json.Str(arguments, "value"), names, scope)?.Title ?? "Change a setting";

    public string Name => "adjust_setting";

    public string Description => "Change one setting at the scope being discussed: autonomy (\"auto\" or \"checkpoints\"), checkpoint.start, checkpoint.plan or checkpoint.hire (true or false), sleep.mode (\"auto\" or \"always_on\"), sleep.idle_minutes (minutes) or workforce.idle_days (days). The owner is asked to confirm first. Nothing else can be changed here: who may open an app, credits and overdraft are a person's to change on their own screens.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["key"] = Schema.Enum("The setting's key.", [.. Endgame.Domain.Cascade.AgentSettings.Allowed]),
        ["value"] = Schema.Str("The new value, as JSON (a string in quotes, a number, true or false)."),
    }, "key", "value");

    public ToolEffect Effect => ToolEffect.External;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        var key = Json.Str(arguments, "key")?.Trim();
        if (string.IsNullOrEmpty(key))
        {
            return (ToolTargets.None, "adjust_setting needs a key.");
        }

        // Refused before anyone is asked: an approval for a change that cannot be made is a second approval later (D45).
        if (!Endgame.Domain.Cascade.AgentSettings.Allowed.Contains(key, StringComparer.Ordinal))
        {
            return (ToolTargets.None, $"'{key}' is not a setting you can change. The keys are {string.Join(", ", Endgame.Domain.Cascade.AgentSettings.Allowed)}. Who may open an app, credits and the overdraft are changed by a person on their own screens: tell the owner where, and change nothing.");
        }

        if (Describe(key, Json.Str(arguments, "value"), names, scope) is null)
        {
            return (ToolTargets.None, $"'{Json.Str(arguments, "value")}' is not a value {key} takes: it takes {Expected(key)}. Send the call again with one.");
        }

        return (new ToolTargets([], $"{key}={Json.Str(arguments, "value")}"), null);
    }

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var key = (Json.Str(call.Arguments, "key") ?? "").Trim();
        var raw = Json.Str(call.Arguments, "value");
        var described = Describe(key, raw, names, scope);
        // A call that never passed Target (over MCP, or a test of the control plane's own allow-list) is sent as given, and the
        // control plane refuses what it must; a described one is sent in the type its key holds.
        JsonNode? value = described is null ? Parsed(raw) : key switch
        {
            Endgame.Domain.Cascade.CascadeKeys.SleepIdleMinutes or Endgame.Domain.Cascade.AgentSettings.WorkforceIdleDays => JsonValue.Create(int.Parse((raw ?? "").Trim().Trim('"'), System.Globalization.CultureInfo.InvariantCulture)),
            Endgame.Domain.Cascade.Autonomy.Key or Endgame.Domain.Cascade.CascadeKeys.SleepMode => JsonValue.Create((raw ?? "").Trim().Trim('"').Trim().ToLowerInvariant()),
            _ => JsonValue.Create((raw ?? "").Trim().Trim('"').Trim().ToLowerInvariant() is "true" or "on" or "yes"),
        };

        var body = new JsonObject { ["scope"] = scope, ["kind"] = "setting", ["key"] = key, ["value"] = value };
        using var response = await controlPlane.Http.PutAsync("/internal/cascade", new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"), cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        return response.IsSuccessStatusCode
            ? new ToolOutcome(described is { } d ? $"Done. Tell the owner, in these words: {d.Done}" : $"Setting changed in {names.Name(scope)}.")
            : ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The setting could not be changed ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it was not changed, naming the place as {names.Name(scope)}."), "tool_error");
    }
}

/// <summary>
/// <c>change_app</c>: asks the factory to change an app that is already built (CHG-01), through
/// <c>POST /internal/apps/changes</c> — the estimate is shown first in the change's own run, then a plan, the build, the checks
/// and the new version. The owner confirms first.
/// </summary>
public sealed partial class ChangeAppTool(ControlPlaneClient controlPlane, string scope, PlaceNames? places = null, WorkStarted? started = null) : ITool, IApprovalTitle
{
    private readonly PlaceNames names = places ?? new PlaceNames([]);

    /// <summary>
    /// A request that is not a change to what the app does, but something only a person does on a screen (D48): who may open
    /// the app, credits and the overdraft, or taking the app away. Null when the request is a change the factory may make.
    /// </summary>
    public static string? PersonsAct(string? request)
    {
        var text = (request ?? "").ToLowerInvariant();
        if (WhoMayOpen().IsMatch(text))
        {
            return "Who may open an app — public, private, or shared with chosen people — is a person's decision, never a change the factory makes. The owner sets it on the app's page, under “Who can open it”.";
        }

        if (Money().IsMatch(text))
        {
            return "Credits, top-ups and the organisation's overdraft are a person's to change, never a change to an app. The owner does it on the Credits page.";
        }

        if (TakeAway().IsMatch(text))
        {
            return "Downloading or exporting an app is a person's act, never a change the factory makes. The owner does it on the app's page.";
        }

        return null;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(make|set|turn|switch|put|change|open)\b[^.]{0,60}\b(public|private|publicly)\b|\bgo(es|ing)? public\b|\bpublic(ly)? (available|accessible|visible|open)\b|\b(open|available|visible) to (everyone|anyone|the public|the world)\b|\bwho (can|may|is allowed to|gets to) (open|see|use|access)\b|\b(share|sharing) (the|this|that|my|our) app\b|\bvisibility\b|\b(unpublish|publish) (the|this|that|my|our)? ?app\b")]
    private static partial System.Text.RegularExpressions.Regex WhoMayOpen();

    [System.Text.RegularExpressions.GeneratedRegex(@"\btop[- ]?ups?\b|\btop (it|us|the balance) up\b|\boverdraft\b|\b(add|buy|give|grant|more)\b[^.]{0,20}\bcredits?\b|\bcredit (limit|balance)\b")]
    private static partial System.Text.RegularExpressions.Regex Money();

    [System.Text.RegularExpressions.GeneratedRegex(@"\b(export|download)\b[^.]{0,40}\b(app|code|it|everything|source)\b")]
    private static partial System.Text.RegularExpressions.Regex TakeAway();

    public string Name => "change_app";

    public string Description => "Ask the factory to change what an app that is already built does: a plan for the change, the change built and checked in the running app, everything it did before checked again, then the new version published. The owner is asked to confirm first. Never for who may open the app (public, private, shared), credits, the overdraft or exporting it: those are a person's acts on their own screens.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["request"] = Schema.Str("The change, in the owner's words."),
        ["app"] = Schema.Str("The app's scope path, if the conversation is not already about one app (for example 'acme/labs/bookings/web')."),
    }, "request");

    public ToolEffect Effect => ToolEffect.External;

    public string ApprovalTitle(JsonObject arguments) =>
        $"Change {names.Name(Json.Str(arguments, "app") is { Length: > 0 } a ? a : scope)}: {Json.Str(arguments, "request")?.Trim().TrimEnd('.', '?', '!')}";

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        if (string.IsNullOrWhiteSpace(Json.Str(arguments, "request")))
        {
            return (ToolTargets.None, "change_app needs the change, in the owner's words.");
        }

        // Refused before anyone is asked: a person's act is never routed into a build (D48).
        if (PersonsAct(Json.Str(arguments, "request")) is { } act)
        {
            return (ToolTargets.None, $"Not a change to the app, so nothing was started and nobody was asked: {act} Tell the owner exactly that, in plain words.");
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
        if (!response.IsSuccessStatusCode)
        {
            return ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"The change could not be started ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it did not start."), "tool_error");
        }

        await StartedWork.ReportAsync(started, text, b => b["run"] as JsonObject, "change", (_, r) => Json.Str(r, "title"), cancellationToken);
        return new ToolOutcome($"The change to {names.Name(app)} has started; its estimate is shown first in its own work (name it as {names.Name(app)}, never by its path): {OutputText.Truncate(text, 2000)}");
    }
}

/// <summary>
/// <c>try_again</c>: starts a failed, cancelled or budget-stopped piece of work again (CHG-03) through
/// <c>POST /internal/runs/{id}/retry</c>, picking up what was already built and agreed. The owner confirms first.
/// </summary>
public sealed class TryAgainTool(ControlPlaneClient controlPlane, string scope, WorkStarted? started = null) : ITool, IApprovalTitle
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
        if (!response.IsSuccessStatusCode)
        {
            return ToolOutcome.Error(string.Create(CultureInfo.InvariantCulture, $"It could not be started again ({(int)response.StatusCode}): {OutputText.Truncate(text, 600)}. Tell the owner it did not start."), "tool_error");
        }

        // The control plane answers with the new run itself.
        await StartedWork.ReportAsync(started, text, b => b, "retry", (_, r) => Json.Str(r, "title"), cancellationToken);
        return new ToolOutcome($"Started again: {OutputText.Truncate(text, 2000)}");
    }
}
