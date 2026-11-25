namespace Endgame.Domain.Tree;

/// <summary>The four levels of the cascade, shallowest first. The numeric value is the depth.</summary>
public enum NodeLevel
{
    Organisation = 0,
    Division = 1,
    Project = 2,
    App = 3,
}

public static class NodeLevels
{
    public static string ToWire(this NodeLevel level) => level switch
    {
        NodeLevel.Organisation => "organisation",
        NodeLevel.Division => "division",
        NodeLevel.Project => "project",
        NodeLevel.App => "app",
        _ => throw new DomainException($"Unknown level {level}."),
    };

    /// <summary>The level with its article, as a sentence says it: "an organisation", "a division", "a project", "an app".</summary>
    public static string WithArticle(this NodeLevel level) =>
        level is NodeLevel.Organisation or NodeLevel.App ? $"an {level.ToWire()}" : $"a {level.ToWire()}";

    /// <summary>A sentence's first word: "An app is created …".</summary>
    public static string Capitalised(string text) => text.Length == 0 ? text : char.ToUpperInvariant(text[0]) + text[1..];

    public static NodeLevel FromWire(string value) => value switch
    {
        "organisation" => NodeLevel.Organisation,
        "division" => NodeLevel.Division,
        "project" => NodeLevel.Project,
        "app" => NodeLevel.App,
        _ => throw new DomainException($"'{value}' is not a level of the cascade."),
    };

    public static readonly IReadOnlyList<string> All = ["organisation", "division", "project", "app"];
}

/// <summary>
/// The status a node may hold, per level. These sets are also the database's check constraints, so a
/// status outside them cannot be written by any route.
/// </summary>
public static class NodeStatuses
{
    public const string Active = "active";
    public const string Suspended = "suspended";
    public const string Archived = "archived";

    public const string Draft = "draft";
    public const string Building = "building";
    public const string Running = "running";
    public const string Sleeping = "sleeping";
    public const string Stopped = "stopped";
    public const string Failed = "failed";

    public static readonly IReadOnlyList<string> Organisation = [Active, Suspended];

    public static readonly IReadOnlyList<string> DivisionOrProject = [Active, Archived];

    public static readonly IReadOnlyList<string> App = [Draft, Building, Running, Sleeping, Stopped, Failed, Archived];

    public static IReadOnlyList<string> For(NodeLevel level) => level switch
    {
        NodeLevel.Organisation => Organisation,
        NodeLevel.Division or NodeLevel.Project => DivisionOrProject,
        _ => App,
    };

    public static string Require(NodeLevel level, string? status) =>
        status is not null && For(level).Contains(status)
            ? status
            : throw new DomainException($"'{status}' is not a status {level.WithArticle()} can have: use {string.Join(", ", For(level))}.");
}
