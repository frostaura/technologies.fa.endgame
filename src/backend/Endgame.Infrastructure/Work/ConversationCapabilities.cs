using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Application.Gateway;
using Endgame.Domain.Cascade;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Work;

/// <summary>Who answers a conversation: Endgame's own assistant, or one employee, and the model tier it thinks with.</summary>
public sealed record AnswererView(string Kind, string? Name, string? Role, Guid? EmployeeId, string Tier);

/// <summary>A skill the builders or reviewers here load: its name, the line that says when, and who loads it.</summary>
public sealed record SkillUseView(string Name, string Trigger, string UsedBy);

/// <summary>A platform service the apps here have, with a fact about it read from the database where one is cheap to read.</summary>
public sealed record ServiceUseView(string Id, string? Detail);

/// <param name="Rule"><c>may</c>, <c>asks</c> or <c>may-not</c>, under the autonomy rules for <c>web_search</c> at the conversation stage.</param>
/// <param name="SetAtPath">Where the rule that decided it was set; null for the default.</param>
public sealed record WebSearchUseView(bool Available, string Rule, string? SetAtPath);

/// <summary>An AI assistant key (MCP) of the organisation; never its secret.</summary>
public sealed record AssistantView(Guid Id, string Name, string Role, string Prefix, DateTimeOffset? LastUsedAt);

public sealed record NarrowingView(bool NoWebSearch, bool AnswerOnly);

public sealed record AttachmentLimitsView(int MaxFiles, long MaxFileBytes, long MaxMessageBytes, bool Images, IReadOnlyList<string> Extensions);

/// <summary><c>GET /api/conversations/capabilities</c>: what whoever answers here can use (ARCH-012; <c>ConversationCapabilities</c> in types.ts).</summary>
public sealed record ConversationCapabilitiesView(
    string Scope,
    AnswererView Answerer,
    IReadOnlyList<string> Tools,
    IReadOnlyList<string> Asks,
    IReadOnlyList<string> Actions,
    IReadOnlyList<SkillUseView> Skills,
    IReadOnlyList<ServiceUseView> Services,
    int Apps,
    WebSearchUseView WebSearch,
    IReadOnlyList<AssistantView> Assistants,
    NarrowingView Narrowing,
    AttachmentLimitsView Attachments);

/// <summary>
/// The skills the Runner's agents load, read from the Runner's own skill files (embedded here from the same files, never a
/// copy): the name, the trigger and the <c>used-by</c> line of each one's front matter.
/// </summary>
public static class SkillIndex
{
    private static readonly Lazy<IReadOnlyList<SkillUseView>> Loaded = new(Load);

    public static IReadOnlyList<SkillUseView> All => Loaded.Value;

    private static IReadOnlyList<SkillUseView> Load()
    {
        var assembly = typeof(SkillIndex).Assembly;
        return assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith("Endgame.Skills.", StringComparison.Ordinal) && n.EndsWith(".md", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .Select(n => Parse(Read(assembly, n), n))
            .ToList();
    }

    private static string Read(Assembly assembly, string name)
    {
        using var stream = assembly.GetManifestResourceStream(name) ?? throw new InvalidOperationException($"The skill {name} is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    /// <summary>A skill's front matter: <c>name:</c>, <c>trigger:</c> and <c>used-by:</c>, all three required.</summary>
    public static SkillUseView Parse(string text, string source)
    {
        ArgumentNullException.ThrowIfNull(text);
        var normalised = text.Replace("\r\n", "\n", StringComparison.Ordinal);
        var end = normalised.StartsWith("---\n", StringComparison.Ordinal) ? normalised.IndexOf("\n---\n", 4, StringComparison.Ordinal) : -1;
        if (end < 0)
        {
            throw new FormatException($"{source}: a skill starts with front matter between --- lines.");
        }

        var fields = normalised[4..end].Split('\n').Select(l => l.Split(':', 2)).Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim(), p => p[1].Trim(), StringComparer.Ordinal);
        return fields.TryGetValue("name", out var name) && fields.TryGetValue("trigger", out var trigger) && fields.TryGetValue("used-by", out var usedBy)
            ? new SkillUseView(name, trigger, usedBy)
            : throw new FormatException($"{source}: a skill needs name:, trigger: and used-by:.");
    }
}

/// <summary>
/// What whoever answers the conversation at a scope can use, read from what is true there: the tools the Runner gives a
/// conversation turn and the autonomy rules over them, the work that makes sense at that scope (a change only where there is an
/// app, trying again only where something stopped), the skills, the platform services with live facts, web search under the
/// rules, the organisation's assistant keys and the file limits.
/// </summary>
public sealed partial class ConversationCapabilitiesService(EndgameDbContext db, TenantSession session, CascadeService cascade, ReadModels reads, EmployeeService employees,
    ModelGatewayOptions gateway, FactoryEstimateOptions factory, TimeProvider clock)
{
    /// <summary>The conversation's tools, in the order the Runner gives them (<c>ConversationWorkflow</c>).</summary>
    public static readonly IReadOnlyList<string> ConversationTools = ["read_organisation", "start_idea", "change_app", "try_again", "adjust_setting"];

    /// <summary>The tools that act: each asks the person first, in the conversation itself (the Runner's checkpoints).</summary>
    public static readonly IReadOnlyList<string> Checkpoints = ["start_idea", "change_app", "try_again", "adjust_setting"];

    public const string Stage = "conversation";
    public const string WebSearch = "web_search";
    public const string Remember = "remember";

    public async Task<ConversationCapabilitiesView> ForAsync(ResolvedScope scope, Guid? employeeId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        AnswererView answerer;
        if (employeeId is { } id)
        {
            var employee = (await employees.DetailAsync(scope.OrganisationId, id, cancellationToken)).Employee;
            var tier = employee.JobDescription.ModelTier is { Length: > 0 } t && gateway.Routes.ContainsKey(t) ? t : factory.ConversationTaskType;
            answerer = new AnswererView("employee", employee.Name, employee.Role, employee.Id, tier);
        }
        else
        {
            answerer = new AnswererView("assistant", null, null, null, factory.ConversationTaskType);
        }

        var route = gateway.Routes.GetValueOrDefault(answerer.Tier);
        var sets = (await cascade.ResolveAsync(scope, CascadeKind.RuleSet, cancellationToken))
            .Where(r => r.Key is Stage or "all").ToList();
        var search = Decide(sets, WebSearch);
        var searchAvailable = route?.WebSearch is not null;

        var tools = ConversationTools.Concat(employeeId is null ? [] : [Remember])
            .Where(t => Decide(sets, t).Verdict != "may-not").ToList();
        if (searchAvailable && search.Verdict != "may-not")
        {
            tools.Add(WebSearch);
        }

        var asks = tools.Where(t => Checkpoints.Contains(t, StringComparer.Ordinal) || Decide(sets, t).Verdict == "asks").ToList();

        session.UseOrganisation(scope.OrganisationId);
        var contents = await reads.ContentsAsync(scope, cancellationToken);
        var appIds = await AppIdsAsync(scope, cancellationToken);
        var stopped = await db.Runs.AsNoTracking().AnyAsync(r => r.OrganisationId == scope.OrganisationId
            && (scope.DivisionId == null || r.DivisionId == scope.DivisionId)
            && (scope.ProjectId == null || r.ProjectId == scope.ProjectId)
            && (scope.AppId == null || r.AppId == scope.AppId)
            && (r.Kind == RunKinds.Research || r.Kind == RunKinds.Build || r.Kind == RunKinds.Task)
            && (r.Status == RunStatuses.Failed || r.Status == RunStatuses.Cancelled), cancellationToken);
        var actions = new List<string>();
        foreach (var action in Checkpoints.Where(tools.Contains))
        {
            if ((action == "change_app" && appIds.Count == 0) || (action == "try_again" && !stopped))
            {
                continue;
            }

            actions.Add(action);
        }

        var skills = SkillIndex.All.OrderBy(s => s.UsedBy == "builders" ? 0 : 1).ThenBy(s => s.Name, StringComparer.Ordinal).ToList();
        var services = await ServicesAsync(scope, appIds, cancellationToken);
        var now = clock.GetUtcNow();
        session.UseOrganisation(scope.OrganisationId);
        var assistants = await db.AccessTokens.AsNoTracking()
            .Where(t => t.OrganisationId == scope.OrganisationId && t.RevokedAt == null && (t.ExpiresAt == null || t.ExpiresAt > now))
            .OrderByDescending(t => t.CreatedAt).ThenBy(t => t.Id)
            .Select(t => new AssistantView(t.Id, t.Name, t.Role, t.Prefix, t.LastUsedAt))
            .ToListAsync(cancellationToken);

        var webSearch = new WebSearchUseView(searchAvailable, search.Verdict, search.SetAtPath);
        var images = route is not null && gateway.AcceptsImages(route);
        return new ConversationCapabilitiesView(
            scope.Path.ToString(),
            answerer,
            tools,
            asks,
            actions,
            skills,
            services,
            contents.Counts.Apps,
            webSearch,
            assistants,
            new NarrowingView(searchAvailable && search.Verdict != "may-not", actions.Count > 0),
            new AttachmentLimitsView(ConversationAttachments.MaxFiles, ConversationAttachments.MaxFileBytes, ConversationAttachments.MaxMessageBytes, images, ConversationAttachments.Extensions));
    }

    /// <summary>
    /// How the autonomy rule sets decide a tool at the conversation stage, as the Runner's permission check does for a call
    /// with no paths or command: any deny (a malformed one denies everything), then any ask, else allowed — the
    /// conversation's tools and web search are reads or checkpoints, so nothing else refuses them.
    /// </summary>
    public static (string Verdict, string? SetAtPath) Decide(IReadOnlyList<EffectiveValue> sets, string tool)
    {
        ArgumentNullException.ThrowIfNull(sets);
        foreach (var list in new[] { "deny", "ask" })
        {
            foreach (var set in sets)
            {
                var rules = set.Value is JsonObject o && o[list] is JsonArray a ? a : [];
                foreach (var rule in rules)
                {
                    var text = rule is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>().Trim() : "";
                    var match = RuleShape().Match(text);
                    var matches = match.Success
                        ? !match.Groups["pattern"].Success && (match.Groups["tool"].Value == "*" || match.Groups["tool"].Value == tool)
                        : list == "deny";
                    if (matches)
                    {
                        return (list == "deny" ? "may-not" : "asks", set.SetAtPath);
                    }
                }
            }
        }

        return ("may", null);
    }

    [GeneratedRegex(@"^(?<tool>\*|[a-z][a-z0-9_]*)(?:\((?<pattern>.+)\))?$", RegexOptions.CultureInvariant)]
    private static partial Regex RuleShape();

    private async Task<IReadOnlyList<Guid>> AppIdsAsync(ResolvedScope scope, CancellationToken cancellationToken)
    {
        session.UseOrganisation(scope.OrganisationId);
        return await (from a in db.Apps.AsNoTracking()
                      join p in db.Projects.AsNoTracking() on new { a.OrganisationId, a.ProjectId } equals new { p.OrganisationId, ProjectId = p.Id }
                      where a.OrganisationId == scope.OrganisationId
                          && (scope.DivisionId == null || p.DivisionId == scope.DivisionId)
                          && (scope.ProjectId == null || a.ProjectId == scope.ProjectId)
                          && (scope.AppId == null || a.Id == scope.AppId)
                      select a.Id).ToListAsync(cancellationToken);
    }

    /// <summary>The seven platform services, each with a fact counted from the database at this scope, or null where none is cheaply known.</summary>
    private async Task<IReadOnlyList<ServiceUseView>> ServicesAsync(ResolvedScope scope, IReadOnlyList<Guid> apps, CancellationToken cancellationToken)
    {
        var org = scope.OrganisationId;
        var secrets = (await cascade.ResolveAsync(scope, CascadeKind.Secret, cancellationToken)).Count;
        session.UseOrganisation(org);
        var people = apps.Count == 0 ? 0 : await db.AppEndUsers.AsNoTracking().CountAsync(u => u.OrganisationId == org && apps.Contains(u.AppId), cancellationToken);
        var monthStart = new DateTimeOffset(clock.GetUtcNow().Year, clock.GetUtcNow().Month, 1, 0, 0, 0, TimeSpan.Zero);
        var mail = apps.Count == 0 ? 0 : await db.EmailMessages.AsNoTracking().CountAsync(m => m.OrganisationId == org && m.AppId != null && apps.Contains(m.AppId.Value) && m.CreatedAt >= monthStart, cancellationToken);
        var schedules = apps.Count == 0 ? 0 : await db.AppSchedules.AsNoTracking().CountAsync(s => s.OrganisationId == org && apps.Contains(s.AppId), cancellationToken);
        var webhooks = apps.Count == 0 ? 0 : await db.AppWebhooks.AsNoTracking().CountAsync(w => w.OrganisationId == org && apps.Contains(w.AppId), cancellationToken);
        return EmployeeService.PlatformServices.Select(id => new ServiceUseView(id, id switch
        {
            "identity" => Count(people, "person has an account", "people have accounts") is { } p ? $"{p} in the apps here" : null,
            "secrets" => Count(secrets, "secret", "secrets") is { } s ? $"{s} set here" : null,
            "email" => Count(mail, "e-mail", "e-mails") is { } e ? $"{e} sent this month" : null,
            "schedules" => Count(schedules, "scheduled job", "scheduled jobs"),
            "webhooks" => Count(webhooks, "incoming-data address", "incoming-data addresses"),
            _ => null,
        })).ToList();
    }

    private static string? Count(int n, string one, string many) =>
        n <= 0 ? null : $"{n.ToString(CultureInfo.InvariantCulture)} {(n == 1 ? one : many)}";
}
