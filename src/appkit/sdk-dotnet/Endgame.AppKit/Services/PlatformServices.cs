using System.Text.Json.Serialization;

namespace Endgame.AppKit;

// ---------------------------------------------------------------------------------------------
// Models — chat completion through the platform gateway. The app never holds a provider key.
// ---------------------------------------------------------------------------------------------

/// <summary>Chat completion through the platform's model gateway, charged to the app's credit budget.</summary>
public interface IEndgameModels
{
    /// <summary>
    /// Ask a model. The platform picks the model for <see cref="ChatRequest.TaskType"/> under its
    /// price ceiling. Throws <see cref="EndgameBudgetExhaustedException"/> when the budget is spent.
    /// </summary>
    Task<ChatResult> CompleteAsync(ChatRequest request, CancellationToken ct = default);
}

/// <summary>One message in a conversation.</summary>
/// <param name="Role"><c>system</c>, <c>user</c> or <c>assistant</c>.</param>
/// <param name="Content">The text.</param>
public sealed record ChatMessage(string Role, string Content)
{
    /// <summary>A system instruction.</summary>
    public static ChatMessage System(string content) => new("system", content);

    /// <summary>What the person said.</summary>
    public static ChatMessage User(string content) => new("user", content);

    /// <summary>What the model said earlier.</summary>
    public static ChatMessage Assistant(string content) => new("assistant", content);
}

/// <summary>A chat completion request.</summary>
/// <param name="Messages">The conversation so far.</param>
/// <param name="TaskType">What kind of work this is — <c>chat</c>, <c>classify</c>, <c>summarise</c> or <c>extract</c>. Cheap models take these.</param>
/// <param name="MaxTokens">Upper bound on the reply length.</param>
/// <param name="Temperature">0 for repeatable answers, up to 1 for varied ones.</param>
public sealed record ChatRequest(IReadOnlyList<ChatMessage> Messages, string TaskType = "chat", int? MaxTokens = null, double? Temperature = null);

/// <summary>Token counts for one call.</summary>
public sealed record ChatUsage(int InputTokens, int OutputTokens);

/// <summary>The model's reply.</summary>
/// <param name="Content">The reply text.</param>
/// <param name="Model">Which model answered.</param>
/// <param name="Usage">Tokens in and out.</param>
/// <param name="Credits">Credits charged for the call.</param>
public sealed record ChatResult(string Content, string Model, ChatUsage Usage, decimal Credits);

internal sealed class EndgameModels(PlatformClient platform) : IEndgameModels
{
    public Task<ChatResult> CompleteAsync(ChatRequest request, CancellationToken ct = default)
    {
        if (request.Messages.Count == 0)
        {
            throw new ArgumentException("A chat request needs at least one message.", nameof(request));
        }

        return platform.SendAsync<ChatResult>(HttpMethod.Post, "platform/v1/models/chat", request, ct);
    }
}

// ---------------------------------------------------------------------------------------------
// Secrets — resolved by the platform through the cascade.
// ---------------------------------------------------------------------------------------------

/// <summary>Secrets from the platform vault, set at any cascade level above the app.</summary>
public interface IEndgameSecrets
{
    /// <summary>The secret's value. Throws <see cref="EndgameSecretNotFoundException"/> when no level sets it.</summary>
    Task<string> GetAsync(string name, CancellationToken ct = default);
}

internal sealed class EndgameSecrets(PlatformClient platform) : IEndgameSecrets
{
    public async Task<string> GetAsync(string name, CancellationToken ct = default)
    {
        Names.RequireSecretName(name);
        var secret = await platform.SendAsync<SecretValue>(HttpMethod.Get, $"platform/v1/secrets/{Uri.EscapeDataString(name)}", null, ct);
        return secret.Value;
    }

    private sealed record SecretValue(string Name, string Value, string? Scope);
}

// ---------------------------------------------------------------------------------------------
// Email — transactional mail from the app.
// ---------------------------------------------------------------------------------------------

/// <summary>Transactional email, sent by the platform on the organisation's behalf.</summary>
public interface IEndgameEmail
{
    /// <summary>Queue an email. Returns the platform's id for it.</summary>
    Task<string> SendAsync(EmailMessage message, CancellationToken ct = default);
}

/// <summary>An email.</summary>
/// <param name="To">Recipients.</param>
/// <param name="Subject">Subject line.</param>
/// <param name="Text">Plain-text body. Always required; HTML is optional.</param>
/// <param name="Html">Optional HTML body.</param>
/// <param name="ReplyTo">Optional reply-to address.</param>
public sealed record EmailMessage(IReadOnlyList<string> To, string Subject, string Text, string? Html = null, string? ReplyTo = null);

internal sealed class EndgameEmail(PlatformClient platform) : IEndgameEmail
{
    public async Task<string> SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        if (message.To.Count == 0 || message.To.Any(a => !a.Contains('@', StringComparison.Ordinal)))
        {
            throw new ArgumentException("An email needs at least one recipient, and every recipient must be an address.", nameof(message));
        }

        if (string.IsNullOrWhiteSpace(message.Subject) || string.IsNullOrWhiteSpace(message.Text))
        {
            throw new ArgumentException("An email needs a subject and a plain-text body.", nameof(message));
        }

        var queued = await platform.SendAsync<QueuedEmail>(HttpMethod.Post, "platform/v1/email", message, ct);
        return queued.Id;
    }

    private sealed record QueuedEmail(string Id);
}

// ---------------------------------------------------------------------------------------------
// Schedules and webhooks — declarations. The endpoints themselves come from MapSchedule/MapWebhook.
// ---------------------------------------------------------------------------------------------

/// <summary>A recurring job the platform calls back on. Declare with <c>app.MapSchedule(...)</c>.</summary>
/// <param name="Name">Lowercase slug, unique in the app.</param>
/// <param name="Cron">Five-field cron expression: minute hour day-of-month month day-of-week.</param>
/// <param name="TimeZone">IANA time zone the cron is read in.</param>
/// <param name="Path">Where the platform POSTs, relative to the app's address.</param>
public sealed record ScheduleDeclaration(string Name, string Cron, string TimeZone, string Path);

/// <summary>Tells the platform which recurring jobs this app has. The kit calls it at start.</summary>
public interface IEndgameSchedules
{
    /// <summary>Replace the app's whole set of schedules with <paramref name="schedules"/>.</summary>
    Task DeclareAsync(IReadOnlyList<ScheduleDeclaration> schedules, CancellationToken ct = default);
}

internal sealed class EndgameSchedules(PlatformClient platform) : IEndgameSchedules
{
    public Task DeclareAsync(IReadOnlyList<ScheduleDeclaration> schedules, CancellationToken ct = default) =>
        platform.SendAsync(HttpMethod.Put, "platform/v1/schedules", new { schedules }, ct);
}

/// <summary>An inbound endpoint outside callers may post to even when the app is private. Declare with <c>app.MapWebhook(...)</c>.</summary>
/// <param name="Name">Lowercase slug, unique in the app.</param>
/// <param name="Path">Where callers POST, relative to the app's address: <c>hooks/&lt;name&gt;</c>.</param>
public sealed record WebhookDeclaration(string Name, string Path);

/// <summary>Tells the platform which inbound endpoints to let through. The kit calls it at start.</summary>
public interface IEndgameWebhooks
{
    /// <summary>Replace the app's whole set of webhooks with <paramref name="webhooks"/>.</summary>
    Task DeclareAsync(IReadOnlyList<WebhookDeclaration> webhooks, CancellationToken ct = default);
}

internal sealed class EndgameWebhooks(PlatformClient platform) : IEndgameWebhooks
{
    public Task DeclareAsync(IReadOnlyList<WebhookDeclaration> webhooks, CancellationToken ct = default) =>
        platform.SendAsync(HttpMethod.Put, "platform/v1/webhooks", new { webhooks }, ct);
}

// ---------------------------------------------------------------------------------------------
// Telemetry — custom events on top of what the kit records by default.
// ---------------------------------------------------------------------------------------------

/// <summary>
/// Custom product events (e.g. <c>note.created</c>). Health, traffic, errors and latency are
/// recorded without this; use it for what the app itself means.
/// </summary>
public interface IEndgameTelemetry
{
    /// <summary>Record an event. Never blocks and never throws; events are sent in batches.</summary>
    void Track(string name, IReadOnlyDictionary<string, object?>? properties = null, string? userId = null);
}

/// <summary>One custom event as sent to the platform.</summary>
public sealed record TelemetryEvent(
    string Name,
    DateTimeOffset At,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] IReadOnlyDictionary<string, object?>? Properties,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? UserId);
