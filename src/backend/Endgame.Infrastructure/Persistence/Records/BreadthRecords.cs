namespace Endgame.Infrastructure.Persistence.Records;

/// <summary>
/// A personal access token a person made in the console for an MCP client: scoped to one
/// organisation and a role no higher than their own there, stored only as a SHA-256 hash, revocable.
/// </summary>
public sealed class AccessTokenRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Name { get; set; } = "";

    /// <summary>The role the token acts with at most. The person's own role caps it further, on every call.</summary>
    public string Role { get; set; } = "";

    /// <summary>The first characters of the token, so a person can tell their tokens apart. Never enough to use.</summary>
    public string Prefix { get; set; } = "";

    /// <summary>Hex SHA-256 of the whole token.</summary>
    public string TokenHash { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? ExpiresAt { get; set; }

    public DateTimeOffset? LastUsedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>Something that needs a person: a verdict, an approval, a hire, a budget or the balance, an app, a security finding.</summary>
public sealed class NotificationRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public string Kind { get; set; } = "";

    /// <summary><c>info</c> or <c>urgent</c>. Urgent ones are also e-mailed when mail is configured.</summary>
    public string Severity { get; set; } = "";

    public string Title { get; set; } = "";

    public string Detail { get; set; } = "";

    /// <summary>What it is about, for the console to link to: <c>{ kind, id }</c>.</summary>
    public string SubjectJson { get; set; } = "{}";

    /// <summary>One notification per episode: the same key is never raised twice in an organisation.</summary>
    public string DedupeKey { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? EmailedAt { get; set; }
}

/// <summary>That one person has read one notification.</summary>
public sealed class NotificationReadRecord
{
    public Guid OrganisationId { get; set; }

    public Guid NotificationId { get; set; }

    public Guid UserId { get; set; }

    public DateTimeOffset ReadAt { get; set; }
}

/// <summary>An idea the platform proposed from what the organisation already holds.</summary>
public sealed class IdeaSuggestionRecord : IScopedRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid? DivisionId { get; set; }

    public Guid? ProjectId { get; set; }

    public Guid? AppId { get; set; }

    public Guid RunId { get; set; }

    public string Title { get; set; } = "";

    /// <summary>The idea itself, as it would be typed into the console.</summary>
    public string Idea { get; set; } = "";

    /// <summary>The gap it fills.</summary>
    public string Gap { get; set; } = "";

    /// <summary>Why this organisation is placed to build it.</summary>
    public string WhyUs { get; set; } = "";

    /// <summary>What it would reuse of what the organisation holds.</summary>
    public string[] Reuses { get; set; } = [];

    /// <summary><c>open</c>, <c>taken</c> (it became an idea) or <c>dismissed</c>.</summary>
    public string Status { get; set; } = "";

    public Guid? IdeaId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public Guid? DecidedBy { get; set; }
}

/// <summary>A question saved on an app's dashboard: its SQL re-runs on every read, at no model cost.</summary>
public sealed class SavedQuestionRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public Guid AppId { get; set; }

    public string Question { get; set; } = "";

    public string Sql { get; set; } = "";

    public string ChartJson { get; set; } = "{}";

    public string Answer { get; set; } = "";

    public Guid? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>An Owner asking FrostAura for a top-up. No payment is taken; an operator tops up by hand.</summary>
public sealed class TopUpRequestRecord
{
    public Guid OrganisationId { get; set; }

    public Guid Id { get; set; }

    public decimal Credits { get; set; }

    public string Note { get; set; } = "";

    /// <summary><c>open</c>, <c>fulfilled</c> or <c>declined</c>.</summary>
    public string Status { get; set; } = "";

    public Guid RequestedBy { get; set; }

    public DateTimeOffset RequestedAt { get; set; }

    public Guid? ClosedBy { get; set; }

    public DateTimeOffset? ClosedAt { get; set; }

    public string? CloseNote { get; set; }

    /// <summary>The top-up that answered it, when one did.</summary>
    public Guid? TopUpEntryId { get; set; }
}

/// <summary>A platform-wide settings document (one row per key): the prices are the first.</summary>
public sealed class PlatformSettingRecord
{
    public string Key { get; set; } = "";

    public string ValueJson { get; set; } = "{}";

    public DateTimeOffset UpdatedAt { get; set; }

    public Guid? UpdatedBy { get; set; }
}

/// <summary>Every change to a platform setting, append-only: what it was, what it became, who and when.</summary>
public sealed class PlatformSettingChangeRecord
{
    public Guid Id { get; set; }

    public string Key { get; set; } = "";

    public string BeforeJson { get; set; } = "null";

    public string AfterJson { get; set; } = "{}";

    public Guid ChangedBy { get; set; }

    public DateTimeOffset ChangedAt { get; set; }
}

/// <summary>
/// A model call FrostAura made for itself, charged to no organisation — screening an organisation
/// against the red lines before it exists (OP-03). Kept so every platform cost can be explained.
/// </summary>
public sealed class PlatformCostRecord
{
    public Guid Id { get; set; }

    /// <summary>What the call was for, e.g. <c>organisation.screening</c>.</summary>
    public string Purpose { get; set; } = "";

    public string? Model { get; set; }

    public string? GenerationId { get; set; }

    public decimal CostUsd { get; set; }

    public string DetailJson { get; set; } = "{}";

    public Guid? By { get; set; }

    public DateTimeOffset At { get; set; }
}
