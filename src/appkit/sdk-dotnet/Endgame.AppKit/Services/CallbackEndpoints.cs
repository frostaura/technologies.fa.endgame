using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Endgame.AppKit;

/// <summary>A schedule run, handed to the handler given to <c>MapSchedule</c>.</summary>
/// <param name="Name">The schedule's name.</param>
/// <param name="ScheduledFor">The time the run was due, as the platform saw it.</param>
/// <param name="Services">Request services: resolve your DbContext and other services here.</param>
/// <param name="CancellationToken">Cancelled if the platform gives up on the run.</param>
public sealed record ScheduleRun(string Name, DateTimeOffset ScheduledFor, IServiceProvider Services, CancellationToken CancellationToken);

/// <summary>An inbound webhook call that has passed verification.</summary>
/// <param name="Name">The webhook's name.</param>
/// <param name="Body">The raw body, exactly as signed.</param>
/// <param name="Headers">The request headers.</param>
/// <param name="Services">Request services: resolve your DbContext and other services here.</param>
/// <param name="CancellationToken">Cancelled if the caller goes away.</param>
public sealed record WebhookRequest(string Name, byte[] Body, IHeaderDictionary Headers, IServiceProvider Services, CancellationToken CancellationToken)
{
    /// <summary>The body parsed as JSON (web defaults: camelCase, case-insensitive).</summary>
    public T ReadJson<T>() =>
        JsonSerializer.Deserialize<T>(Body, PlatformClient.Json)
        ?? throw new BadHttpRequestException($"The {Name} webhook body was empty or null.");

    /// <summary>The body as UTF-8 text.</summary>
    public string ReadText() => Encoding.UTF8.GetString(Body);
}

/// <summary>How an inbound webhook proves it came from who it claims. There is deliberately no "none".</summary>
public sealed record WebhookVerification
{
    private WebhookVerification(string kind, string header, string secretName, string prefix)
    {
        Kind = kind;
        Header = header;
        SecretName = secretName;
        Prefix = prefix;
    }

    internal string Kind { get; }

    internal string Header { get; }

    internal string SecretName { get; }

    internal string Prefix { get; }

    /// <summary>
    /// The caller sends <c>hex(HMAC-SHA256(secret, body))</c> in <paramref name="header"/>, optionally
    /// after <paramref name="prefix"/> (GitHub-style <c>sha256=</c>). The secret comes from the vault.
    /// </summary>
    public static WebhookVerification HmacSha256(string header, string secretName, string prefix = "sha256=")
    {
        Names.RequireSecretName(secretName);
        return new("hmac-sha256", header, secretName, prefix);
    }

    /// <summary>The caller sends the vault secret itself in <paramref name="header"/> (simple devices).</summary>
    public static WebhookVerification SharedToken(string header, string secretName)
    {
        Names.RequireSecretName(secretName);
        return new("shared-token", header, secretName, "");
    }

    internal async Task<bool> VerifyAsync(HttpRequest request, byte[] body, IEndgameSecrets secrets, CancellationToken ct)
    {
        var given = request.Headers[Header].ToString();
        if (string.IsNullOrEmpty(given))
        {
            return false;
        }

        var secret = await secrets.GetAsync(SecretName, ct);
        if (Kind == "shared-token")
        {
            return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(given), Encoding.UTF8.GetBytes(secret));
        }

        if (!given.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        try
        {
            var mac = Convert.FromHexString(given[Prefix.Length..]);
            return CryptographicOperations.FixedTimeEquals(mac, HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body));
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

internal sealed record ScheduleMetadata(ScheduleDeclaration Declaration);

internal sealed record WebhookMetadata(WebhookDeclaration Declaration);

/// <summary><c>app.MapSchedule(...)</c> and <c>app.MapWebhook(...)</c>.</summary>
public static partial class CallbackEndpointExtensions
{
    /// <summary>The path prefix the platform calls the app on. Edge never lets the public reach it.</summary>
    public const string PlatformCallbackPrefix = "_platform";

    /// <summary>The path prefix of inbound webhooks: <c>hooks/&lt;name&gt;</c>.</summary>
    public const string WebhookPrefix = "hooks";

    [GeneratedRegex(@"^[0-9*/,\-]+$")]
    private static partial Regex CronField();

    /// <summary>
    /// A recurring job. The platform POSTs to <c>_platform/schedules/&lt;name&gt;</c> on the cron; the
    /// call is signed with the app token and anything unsigned is refused. The kit tells the platform
    /// about every schedule when the app starts.
    /// </summary>
    /// <param name="endpoints">The app.</param>
    /// <param name="name">Lowercase slug, unique in the app, e.g. <c>nightly-digest</c>.</param>
    /// <param name="cron">Five fields, e.g. <c>0 7 * * *</c> for 07:00 every day.</param>
    /// <param name="handler">The work. Throwing marks the run failed.</param>
    /// <param name="timeZone">IANA zone the cron is read in. UTC by default.</param>
    public static IEndpointConventionBuilder MapSchedule(this IEndpointRouteBuilder endpoints, string name, string cron, Func<ScheduleRun, Task> handler, string timeZone = "UTC")
    {
        Names.RequireSlug("Schedule", name);
        RequireCron(name, cron);
        var path = $"{PlatformCallbackPrefix}/schedules/{name}";
        return endpoints.MapPost(path, async (HttpContext context) =>
            {
                var body = await ReadBodyAsync(context.Request);
                var settings = context.RequestServices.GetRequiredService<IOptions<EndgameSettings>>().Value;
                var now = context.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow();
                if (!CallbackSignature.Verify(settings.RequiredAppToken, context.Request.Headers[CallbackSignature.Header], body, now))
                {
                    return Results.Problem(statusCode: 401, title: "Unsigned schedule call", detail: "Only the platform may run schedules.");
                }

                var scheduledFor = now;
                if (body.Length > 0 && JsonSerializer.Deserialize<ScheduleCall>(body, PlatformClient.Json) is { ScheduledFor: { } due })
                {
                    scheduledFor = due;
                }

                await handler(new ScheduleRun(name, scheduledFor, context.RequestServices, context.RequestAborted));
                return Results.NoContent();
            })
            .ExcludeFromDescription()
            .WithMetadata(new ScheduleMetadata(new ScheduleDeclaration(name, cron, timeZone, path)));
    }

    /// <summary>
    /// An inbound endpoint at <c>hooks/&lt;name&gt;</c> that outside callers (a device, another service)
    /// may POST to even while the app is private. Every call is verified before the handler runs.
    /// </summary>
    /// <param name="endpoints">The app.</param>
    /// <param name="name">Lowercase slug, unique in the app, e.g. <c>court-sensor</c>.</param>
    /// <param name="verification">How callers prove who they are.</param>
    /// <param name="handler">The work. Return e.g. <c>Results.Accepted()</c>.</param>
    public static IEndpointConventionBuilder MapWebhook(this IEndpointRouteBuilder endpoints, string name, WebhookVerification verification, Func<WebhookRequest, Task<IResult>> handler)
    {
        Names.RequireSlug("Webhook", name);
        ArgumentNullException.ThrowIfNull(verification);
        var path = $"{WebhookPrefix}/{name}";
        return endpoints.MapPost(path, async (HttpContext context) =>
            {
                var body = await ReadBodyAsync(context.Request);
                var secrets = context.RequestServices.GetRequiredService<IEndgameSecrets>();
                if (!await verification.VerifyAsync(context.Request, body, secrets, context.RequestAborted))
                {
                    return Results.Problem(statusCode: 401, title: "Webhook verification failed", detail: $"The {verification.Header} header did not verify.");
                }

                return await handler(new WebhookRequest(name, body, context.Request.Headers, context.RequestServices, context.RequestAborted));
            })
            .ExcludeFromDescription()
            .WithMetadata(new WebhookMetadata(new WebhookDeclaration(name, path)));
    }

    private static async Task<byte[]> ReadBodyAsync(HttpRequest request)
    {
        using var buffer = new MemoryStream();
        await request.Body.CopyToAsync(buffer, request.HttpContext.RequestAborted);
        return buffer.ToArray();
    }

    private static void RequireCron(string name, string cron)
    {
        var fields = cron.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (fields.Length != 5 || fields.Any(f => !CronField().IsMatch(f)))
        {
            throw new ArgumentException(
                $"Schedule '{name}' has cron '{cron}'. Use five fields — minute hour day-of-month month day-of-week — with digits, *, /, ',' and '-' only, e.g. '0 7 * * *'.",
                nameof(cron));
        }
    }

    private sealed record ScheduleCall(DateTimeOffset? ScheduledFor);
}
