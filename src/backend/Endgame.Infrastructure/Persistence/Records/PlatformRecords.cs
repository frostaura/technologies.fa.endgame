namespace Endgame.Infrastructure.Persistence.Records;

// The platform API's records (PLATFORM-API.md): everything an app is given or tells the platform.
// Every row carries its organisation and its app; row-level security admits only the organisation's.

/// <summary>
/// One issued app token. The token itself is never stored: it is derived from <see cref="Salt"/> and
/// the vault's master key, so the control plane can sign callbacks with it while the database alone
/// cannot produce it. Lookups go by <see cref="TokenHash"/>.
/// </summary>
public sealed class AppTokenRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public byte[] Salt { get; set; } = [];

    /// <summary>SHA-256 of the token, hex.</summary>
    public string TokenHash { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Null while it is the current token; set to a short grace period when a newer one is issued.</summary>
    public DateTimeOffset? ValidUntil { get; set; }

    /// <summary>The token of the app's preview (an unpublished build under check): its e-mail is held, never sent.</summary>
    public bool Preview { get; set; }
}

/// <summary>A person registered to use one app. No role in the organisation; never reaches the console or another app.</summary>
public sealed class AppEndUserRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    /// <summary>Lower-case. Unique within the app.</summary>
    public string Email { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LastSignInAt { get; set; }
}

/// <summary>An end user's passkey: the fields of Identity's <c>UserPasskeyInfo</c>, one row per credential.</summary>
public sealed class AppEndUserPasskeyRecord
{
    public Guid OrganisationId { get; set; }

    public byte[] CredentialId { get; set; } = [];

    public Guid AppId { get; set; }

    public Guid EndUserId { get; set; }

    public byte[] PublicKey { get; set; } = [];

    public string? Name { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public long SignCount { get; set; }

    public string[]? Transports { get; set; }

    public bool IsUserVerified { get; set; }

    public bool IsBackupEligible { get; set; }

    public bool IsBackedUp { get; set; }

    public byte[] AttestationObject { get; set; } = [];

    public byte[] ClientDataJson { get; set; } = [];
}

/// <summary>
/// A browser's signed-in session at one app, on one host. Its cookie holds a token stored only as a
/// hash. Exactly one of <see cref="EndUserId"/> (an end user) and <see cref="UserId"/> (a member whose
/// console session was handed off to the organisation-subdomain host) is set.
/// </summary>
public sealed class AppSessionRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public Guid? EndUserId { get; set; }

    public Guid? UserId { get; set; }

    public string TokenHash { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>An e-mail address an app is shared with. The person registers as an end user with the one-time code.</summary>
public sealed class AppShareRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Email { get; set; } = "";

    /// <summary>SHA-256 of the one-time invitation code, hex; null once it was used to register.</summary>
    public string? InvitationCodeHash { get; set; }

    public DateTimeOffset? InvitationExpiresAt { get; set; }

    public Guid InvitedBy { get; set; }

    public DateTimeOffset InvitedAt { get; set; }
}

/// <summary>A recurring job an app declared. The scheduler leases due rows, calls the app, and moves them on.</summary>
public sealed class AppScheduleRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Name { get; set; } = "";

    public string Cron { get; set; } = "";

    public string TimeZone { get; set; } = "UTC";

    public string Path { get; set; } = "";

    public DateTimeOffset? NextRunAt { get; set; }

    public string? LeaseHolder { get; set; }

    public DateTimeOffset? LeaseExpiresAt { get; set; }

    public DateTimeOffset? LastRunAt { get; set; }

    public DateTimeOffset? LastScheduledFor { get; set; }

    public int? LastStatus { get; set; }

    public string? LastError { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>An inbound endpoint an app declared; Edge lets <c>POST hooks/&lt;name&gt;</c> through for it even when the app is private.</summary>
public sealed class AppWebhookRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Name { get; set; } = "";

    public string Path { get; set; } = "";

    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>The outbox: one e-mail an app asked the platform to send, and how its delivery went.</summary>
public sealed class EmailMessageRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    /// <summary>The app that sent it; null for the platform's own mail to members (an urgent notification, an invitation).</summary>
    public Guid? AppId { get; set; }

    public string[] Recipients { get; set; } = [];

    public string Subject { get; set; } = "";

    public string TextBody { get; set; } = "";

    public string? HtmlBody { get; set; }

    public string? ReplyTo { get; set; }

    public string Status { get; set; } = "";

    public int Attempts { get; set; }

    public DateTimeOffset NextAttemptAt { get; set; }

    public DateTimeOffset? LeaseUntil { get; set; }

    public string? LastError { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? SentAt { get; set; }
}

/// <summary>A custom product event an app recorded (PLATFORM-API §3.7).</summary>
public sealed class TelemetryEventRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Name { get; set; } = "";

    public DateTimeOffset At { get; set; }

    public string? UserId { get; set; }

    public string PropertiesJson { get; set; } = "{}";

    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>One span from an app's OTLP traces, reduced to what the read side measures.</summary>
public sealed class TelemetrySpanRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string TraceId { get; set; } = "";

    public string SpanId { get; set; } = "";

    public string? ParentSpanId { get; set; }

    public string Name { get; set; } = "";

    /// <summary>OTLP span kind: 1 internal, 2 server, 3 client, 4 producer, 5 consumer.</summary>
    public int Kind { get; set; }

    public DateTimeOffset StartAt { get; set; }

    public double DurationMs { get; set; }

    /// <summary>OTLP status: 0 unset, 1 ok, 2 error.</summary>
    public int StatusCode { get; set; }

    public string? HttpMethod { get; set; }

    public string? HttpRoute { get; set; }

    public string? UrlPath { get; set; }

    public int? HttpStatus { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>One metric data point from an app's OTLP metrics.</summary>
public sealed class TelemetryMetricRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Name { get; set; } = "";

    public string? Unit { get; set; }

    /// <summary>gauge, sum or histogram.</summary>
    public string Type { get; set; } = "";

    public DateTimeOffset At { get; set; }

    public double? Value { get; set; }

    public long? Count { get; set; }

    public double? Sum { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>One log record from an app's OTLP logs, its body truncated.</summary>
public sealed class TelemetryLogRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public DateTimeOffset At { get; set; }

    public int SeverityNumber { get; set; }

    public string? SeverityText { get; set; }

    public string Body { get; set; } = "";

    public string? Category { get; set; }

    public string? TraceId { get; set; }

    public string? SpanId { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>One hosting usage sample Dock reported for an app, and the credits it was charged as.</summary>
public sealed class HostingSampleRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    /// <summary>Dock's own id for the sample: reporting it twice charges once.</summary>
    public string SampleId { get; set; } = "";

    public DateTimeOffset PeriodStart { get; set; }

    public DateTimeOffset PeriodEnd { get; set; }

    public long AwakeSeconds { get; set; }

    public long MemoryBytes { get; set; }

    public long StorageBytes { get; set; }

    public long Requests { get; set; }

    public decimal CostUsd { get; set; }

    public decimal Credits { get; set; }

    public Guid CreditEntryId { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }
}

/// <summary>
/// A one-time, short-lived hand-off: a session established on the platform's path-form host,
/// carried to the organisation-subdomain host without sharing a cookie across hosts. Edge redeems
/// the code on the subdomain and sets that host's own cookie.
/// </summary>
public sealed class AppHandoffRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public Guid? EndUserId { get; set; }

    public Guid? UserId { get; set; }

    /// <summary>SHA-256 of the code, hex.</summary>
    public string CodeHash { get; set; } = "";

    public string ReturnTo { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? UsedAt { get; set; }
}
