using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Email;
using Endgame.Domain.Access;
using Endgame.Domain.Platform;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Platform;

public sealed class NotificationOptions
{
    public const string SectionName = "Notifications";

    /// <summary>Whether the background derivation runs. Tests drive it directly instead.</summary>
    public bool Enabled { get; set; } = true;

    public int IntervalSeconds { get; set; } = 30;

    /// <summary>How far back a security review's finding is still news.</summary>
    public int SecurityLookbackDays { get; set; } = 7;
}

public sealed record NotificationSubject(string Kind, Guid Id);

public sealed record NotificationView(Guid Id, string Kind, string Severity, string Title, string Detail, string Scope, NotificationSubject? Subject, DateTimeOffset CreatedAt, bool Read, DateTimeOffset? EmailedAt);

public sealed record NotificationFeed(string Organisation, int Unread, IReadOnlyList<NotificationView> Notifications);

/// <summary>
/// The owner's notification feed (spec: owners are warned; things that need a person). Notifications
/// are raised once per episode (a dedupe key per organisation) and shown to the Admins and Owner whose
/// grant covers the node. Urgent ones are also e-mailed through the outbox, but only when a mail
/// server is configured, so nothing piles up unsent.
/// </summary>
public sealed class NotificationService(
    EndgameDbContext db,
    TenantSession session,
    ScopeResolver scopes,
    AccessService access,
    IEmailSender sender,
    TimeProvider clock)
{
    public const int MaxFeed = 200;

    /// <summary>Raises one notification unless its key was raised before. True when it is new.</summary>
    public async Task<bool> RaiseAsync(ResolvedScope at, string kind, string title, string detail, NotificationSubject? subject, string dedupeKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(at);
        session.UseOrganisation(at.OrganisationId);
        var severity = NotificationKinds.SeverityOf(kind);
        var id = Guid.NewGuid();
        var subjectJson = subject is null ? "{}" : new JsonObject { ["kind"] = subject.Kind, ["id"] = subject.Id.ToString() }.ToJsonString();
        await using var command = await db.CommandAsync("""
            INSERT INTO notifications (id, organisation_id, division_id, project_id, app_id, kind, severity, title, detail, subject, dedupe_key, created_at)
            VALUES (@id, @org, @division, @project, @app, @kind, @severity, @title, @detail, @subject, @key, @now)
            ON CONFLICT (organisation_id, dedupe_key) DO NOTHING
            """, cancellationToken,
            P("id", id), P("org", at.OrganisationId), P("division", at.DivisionId), P("project", at.ProjectId), P("app", at.AppId), P("kind", kind),
            P("severity", severity), P("title", Clip(title, 300)), P("detail", Clip(detail, 2000)), Json("subject", subjectJson), P("key", Clip(dedupeKey, 200)), P("now", clock.GetUtcNow()));
        var inserted = await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        if (inserted && severity == NotificationKinds.Urgent && sender.IsConfigured)
        {
            await EmailAsync(at, id, title, detail, cancellationToken);
        }

        return inserted;
    }

    /// <summary>The feed for one person in one organisation, newest first: what their grants make theirs to act on.</summary>
    public async Task<NotificationFeed> FeedAsync(Guid userId, string? organisation, bool unreadOnly, int limit, CancellationToken cancellationToken)
    {
        var org = await OrganisationAsync(userId, organisation, cancellationToken);
        var grants = await access.GrantsInOrganisationAsync(userId, org.OrganisationId, cancellationToken);
        var covering = grants.Where(g => g.Role >= MemberRole.Admin).ToList();
        if (covering.Count == 0 && !await access.IsOperatorAsync(userId, cancellationToken))
        {
            return new NotificationFeed(org.Path.ToString(), 0, []);
        }

        session.UseOrganisation(org.OrganisationId);
        var everything = covering.Any(g => g.Level == NodeLevel.Organisation) || covering.Count == 0;
        var nodes = covering.Select(g => g.NodeId).ToHashSet();
        var rows = await db.Notifications.AsNoTracking().Where(n => n.OrganisationId == org.OrganisationId).OrderByDescending(n => n.CreatedAt).Take(1000).ToListAsync(cancellationToken);
        var visible = rows.Where(n => everything || new[] { n.DivisionId, n.ProjectId, n.AppId }.Any(id => id is { } x && nodes.Contains(x))).ToList();
        var ids = visible.Select(n => n.Id).ToList();
        var read = (await db.NotificationReads.AsNoTracking().Where(r => r.OrganisationId == org.OrganisationId && r.UserId == userId && ids.Contains(r.NotificationId))
            .Select(r => r.NotificationId).ToListAsync(cancellationToken)).ToHashSet();
        var paths = new Dictionary<(Guid?, Guid?, Guid?), string>();
        var views = new List<NotificationView>();
        foreach (var n in visible.Where(n => !unreadOnly || !read.Contains(n.Id)).Take(Math.Clamp(limit, 1, MaxFeed)))
        {
            if (!paths.TryGetValue((n.DivisionId, n.ProjectId, n.AppId), out var path))
            {
                path = (await scopes.ForRowAsync(n.OrganisationId, n.DivisionId, n.ProjectId, n.AppId, cancellationToken)).Path.ToString();
                paths[(n.DivisionId, n.ProjectId, n.AppId)] = path;
            }

            var subject = JsonNode.Parse(n.SubjectJson);
            views.Add(new NotificationView(n.Id, n.Kind, n.Severity, n.Title, n.Detail, path,
                subject?["kind"] is JsonValue k && Guid.TryParse(subject["id"]?.GetValue<string>(), out var sid) ? new NotificationSubject(k.GetValue<string>(), sid) : null,
                n.CreatedAt, read.Contains(n.Id), n.EmailedAt));
        }

        session.UseOrganisation(org.OrganisationId);
        return new NotificationFeed(org.Path.ToString(), visible.Count(n => !read.Contains(n.Id)), views);
    }

    public async Task MarkReadAsync(Guid userId, Guid notificationId, CancellationToken cancellationToken)
    {
        var org = await scopes.OrganisationOfAsync(db.Notifications, q => q.Where(n => n.Id == notificationId).Select(n => n.OrganisationId), cancellationToken)
            ?? throw EndgameProblem.NotFound("The notification");
        var feed = await FeedAsync(userId, (await scopes.ForRowAsync(org, null, null, null, cancellationToken)).Path.ToString(), false, MaxFeed, cancellationToken);
        if (feed.Notifications.All(n => n.Id != notificationId))
        {
            throw EndgameProblem.NotFound("The notification");
        }

        await InsertReadsAsync(org, userId, [notificationId], cancellationToken);
    }

    public async Task<int> MarkAllReadAsync(Guid userId, string? organisation, CancellationToken cancellationToken)
    {
        var feed = await FeedAsync(userId, organisation, true, MaxFeed, cancellationToken);
        if (feed.Notifications.Count == 0)
        {
            return 0;
        }

        var org = await scopes.RequireAsync(feed.Organisation, cancellationToken);
        await InsertReadsAsync(org.OrganisationId, userId, feed.Notifications.Select(n => n.Id).ToList(), cancellationToken);
        return feed.Notifications.Count;
    }

    private async Task InsertReadsAsync(Guid organisationId, Guid userId, IReadOnlyList<Guid> ids, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        await using var command = await db.CommandAsync("""
            INSERT INTO notification_reads (organisation_id, notification_id, user_id, read_at)
            SELECT @org, id, @user, @now FROM unnest(@ids) AS id
            ON CONFLICT DO NOTHING
            """, cancellationToken, P("org", organisationId), P("user", userId), P("now", clock.GetUtcNow()),
            new Npgsql.NpgsqlParameter("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Uuid) { Value = ids.ToArray() });
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<ResolvedScope> OrganisationAsync(Guid userId, string? organisation, CancellationToken cancellationToken)
    {
        var slug = organisation ?? (await access.MembershipsOfAsync(userId, cancellationToken)).FirstOrDefault()?.OrganisationSlug
            ?? throw new EndgameProblem(409, "no_organisation", "No organisation yet", "Notifications belong to an organisation.");
        var scope = await scopes.RequireAsync(slug, cancellationToken);
        if (scope.Level != NodeLevel.Organisation)
        {
            throw EndgameProblem.Invalid("Pass the organisation's slug.");
        }

        // A role anywhere in the organisation is enough to have a feed; someone with none (and no
        // operator's entry, which is logged) is told it does not exist.
        if ((await access.GrantsInOrganisationAsync(userId, scope.OrganisationId, cancellationToken)).Count == 0)
        {
            await access.RequireAsync(userId, scope, MemberRole.Viewer, cancellationToken);
        }

        return scope;
    }

    /// <summary>An urgent notification, queued to the organisation's Owner and Admins (at the organisation) through the outbox.</summary>
    private async Task EmailAsync(ResolvedScope at, Guid notificationId, string title, string detail, CancellationToken cancellationToken)
    {
        var recipients = await (from m in db.Memberships.AsNoTracking()
                                join u in db.Users.AsNoTracking() on m.UserId equals u.Id
                                where m.OrganisationId == at.OrganisationId && m.DivisionId == null && (m.Role == "owner" || m.Role == "admin") && u.Email != null
                                select u.Email!).Distinct().ToListAsync(cancellationToken);
        if (recipients.Count == 0)
        {
            return;
        }

        var now = clock.GetUtcNow();
        db.EmailMessages.Add(new EmailMessageRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = at.OrganisationId,
            AppId = null,
            Recipients = recipients.ToArray(),
            Subject = Clip($"{at.Nodes[0].Name}: {title}", 300),
            TextBody = $"{title}\n\n{detail}\n\n({at.Path})",
            Status = "queued",
            NextAttemptAt = now,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        await db.Notifications.Where(n => n.OrganisationId == at.OrganisationId && n.Id == notificationId)
            .ExecuteUpdateAsync(u => u.SetProperty(n => n.EmailedAt, now), cancellationToken);
    }

    private static string Clip(string text, int max) => text.Length > max ? text[..max] : text;
}

/// <summary>
/// Derives the feed from what is true, every <see cref="NotificationOptions.IntervalSeconds"/>: a
/// verdict or approval or hire proposal waiting, a budget at 80 % and at its cap, the balance at zero,
/// halfway to the overdraft limit and at it, an app that crashed, a security review's finding. Each
/// episode has its own key, so it is raised once; a top-up starts a new episode for the balance.
/// </summary>
public sealed class NotificationSweep(IServiceScopeFactory scopeFactory, IOptions<NotificationOptions> options, TimeProvider clock, ILogger<NotificationSweep> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(5, options.Value.IntervalSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "The notification sweep failed; it runs again shortly.");
            }
        }
    }

    /// <summary>One pass over every organisation. Returns how many notifications were new.</summary>
    public async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        await using var outer = scopeFactory.CreateAsyncScope();
        var db = outer.ServiceProvider.GetRequiredService<EndgameDbContext>();
        outer.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var organisations = await db.Organisations.AsNoTracking().Select(o => o.Id).ToListAsync(cancellationToken);
        var raised = 0;
        foreach (var org in organisations)
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            raised += await OrganisationAsync(scope.ServiceProvider, org, cancellationToken);
        }

        return raised;
    }

    private async Task<int> OrganisationAsync(IServiceProvider services, Guid organisationId, CancellationToken cancellationToken)
    {
        var db = services.GetRequiredService<EndgameDbContext>();
        var session = services.GetRequiredService<TenantSession>();
        var scopes = services.GetRequiredService<ScopeResolver>();
        var notifications = services.GetRequiredService<NotificationService>();
        var ledger = services.GetRequiredService<CreditLedger>();
        var now = clock.GetUtcNow();
        var raised = 0;
        var root = await scopes.ForRowAsync(organisationId, null, null, null, cancellationToken);
        session.UseOrganisation(organisationId);

        async Task Raise(Guid? division, Guid? project, Guid? app, string kind, string title, string detail, NotificationSubject? subject, string key)
        {
            var at = division is null ? root : await scopes.ForRowAsync(organisationId, division, project, app, cancellationToken);
            raised += await notifications.RaiseAsync(at, kind, title, detail, subject, key, cancellationToken) ? 1 : 0;
            session.UseOrganisation(organisationId);
        }

        foreach (var idea in await db.Ideas.AsNoTracking().Where(i => i.OrganisationId == organisationId && i.Status == IdeaStatuses.AwaitingDecision).ToListAsync(cancellationToken))
        {
            await Raise(idea.DivisionId, idea.ProjectId, idea.AppId, NotificationKinds.Verdict, $"A verdict is waiting: {ReadModels.IdeaTitle(idea.Text)}",
                idea.VerdictSummary ?? "Research has finished; build, change, overrule or drop it.", new NotificationSubject("idea", idea.Id), $"verdict:{idea.Id:N}");
        }

        var approvals = await (from a in db.Approvals.AsNoTracking()
                               join r in db.Runs.AsNoTracking() on new { a.OrganisationId, Id = a.RunId } equals new { r.OrganisationId, r.Id }
                               where a.OrganisationId == organisationId && a.Status == ApprovalStatuses.Pending
                               select new { a.Id, a.Title, a.Detail, a.RunId, r.DivisionId, r.ProjectId, r.AppId }).ToListAsync(cancellationToken);
        foreach (var a in approvals)
        {
            await Raise(a.DivisionId, a.ProjectId, a.AppId, NotificationKinds.Approval, $"Approval needed: {a.Title}", a.Detail.Length == 0 ? "Work is waiting for your sign-off." : a.Detail,
                new NotificationSubject("run", a.RunId), $"approval:{a.Id:N}");
        }

        foreach (var h in await db.HireProposals.AsNoTracking().Where(h => h.OrganisationId == organisationId && h.Status == Domain.Workforce.HireStatuses.Proposed).ToListAsync(cancellationToken))
        {
            await Raise(h.DivisionId, h.ProjectId, h.AppId, NotificationKinds.Hire, $"Hire {h.Name} as {h.Role}?", h.Reason, new NotificationSubject("hire", h.Id), $"hire:{h.Id:N}");
        }

        // Budgets: every monthly cap on a node, against this month's spend at it.
        var month = now.UtcDateTime.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var spend = await ledger.SpendThisMonthByNodeAsync(organisationId, cancellationToken);
        session.UseOrganisation(organisationId);
        var caps = await db.CascadeEntries.AsNoTracking().Where(e => e.OrganisationId == organisationId && e.Kind == "budget" && e.Key == Domain.Cascade.CascadeKeys.MonthlyCredits).ToListAsync(cancellationToken);
        foreach (var cap in caps)
        {
            if (CascadeService.NumberOf(JsonNode.Parse(cap.ValueJson)) is not { } limit || limit <= 0)
            {
                continue;
            }

            var spent = spend.Where(s => (cap.DivisionId == null || s.DivisionId == cap.DivisionId) && (cap.ProjectId == null || s.ProjectId == cap.ProjectId) && (cap.AppId == null || s.AppId == cap.AppId)).Sum(s => s.Credits);
            var node = cap.NodeId();
            var at = await scopes.ForRowAsync(organisationId, cap.DivisionId, cap.ProjectId, cap.AppId, cancellationToken);
            session.UseOrganisation(organisationId);
            var figures = $"{Credits(spent)} of {Credits(limit)} credits spent this month at {at.Path}.";
            if (spent >= limit)
            {
                await Raise(cap.DivisionId, cap.ProjectId, cap.AppId, NotificationKinds.BudgetCap, $"{at.Node.Name} reached its monthly budget",
                    figures + " Work there stops until the budget is raised or the month turns.", null, $"budget.cap:{node:N}:{month}");
            }
            else if (spent >= limit * 0.8m)
            {
                await Raise(cap.DivisionId, cap.ProjectId, cap.AppId, NotificationKinds.Budget80, $"{at.Node.Name} has used 80% of its monthly budget", figures, null, $"budget.80:{node:N}:{month}");
            }
        }

        foreach (var e in await db.Employees.AsNoTracking().Where(e => e.OrganisationId == organisationId && e.MonthlyCreditLimit != null && e.MonthlyCreditLimit > 0 && e.Status != EmployeeStatuses.Released).ToListAsync(cancellationToken))
        {
            var spent = spend.Where(s => s.EmployeeId == e.Id).Sum(s => s.Credits);
            var limit = e.MonthlyCreditLimit!.Value;
            var figures = $"{Credits(spent)} of {Credits(limit)} credits spent this month.";
            if (spent >= limit)
            {
                await Raise(e.DivisionId, e.ProjectId, e.AppId, NotificationKinds.BudgetCap, $"{e.Name} reached their monthly budget", figures + " They stop until it is raised or the month turns.",
                    new NotificationSubject("employee", e.Id), $"budget.cap:{e.Id:N}:{month}");
            }
            else if (spent >= limit * 0.8m)
            {
                await Raise(e.DivisionId, e.ProjectId, e.AppId, NotificationKinds.Budget80, $"{e.Name} has used 80% of their monthly budget", figures,
                    new NotificationSubject("employee", e.Id), $"budget.80:{e.Id:N}:{month}");
            }
        }

        // The balance: at zero, halfway to the overdraft limit, at it. A top-up starts a new episode.
        var position = await ledger.PositionAsync(root, now, cancellationToken);
        session.UseOrganisation(organisationId);
        var lastTopUp = await db.CreditEntries.AsNoTracking().Where(c => c.OrganisationId == organisationId && c.Kind == "top_up")
            .OrderByDescending(c => c.CreatedAt).Select(c => (Guid?)c.Id).FirstOrDefaultAsync(cancellationToken);
        var episode = lastTopUp?.ToString("N") ?? "start";
        var limitDepth = position.OverdraftLimit;
        if (position.Balance <= 0 && (lastTopUp is not null || position.Balance < 0))
        {
            await Raise(null, null, null, NotificationKinds.CreditsZero, "Credits have run out",
                $"The balance is {Credits(position.Balance)} credits. Work goes on into the overdraft of up to {Credits(limitDepth)} credits; ask FrostAura for a top-up.",
                null, $"credits.zero:{episode}");
        }

        if (limitDepth > 0 && position.Balance <= -limitDepth / 2m && position.Balance > -limitDepth)
        {
            await Raise(null, null, null, NotificationKinds.OverdraftHalf, "Halfway to the overdraft limit",
                $"The balance is {Credits(position.Balance)} credits, of an overdraft limit of {Credits(limitDepth)}. At the limit, work stops and apps pause until a top-up.",
                null, $"overdraft.half:{episode}");
        }

        if ((lastTopUp is not null || position.Balance < 0) && position.Balance <= -limitDepth)
        {
            await Raise(null, null, null, NotificationKinds.OverdraftLimit, "The overdraft limit is reached: work has stopped and apps are paused",
                $"The balance is {Credits(position.Balance)} credits. Nothing is deleted; a top-up restores everything at once.", null, $"overdraft.limit:{episode}");
        }

        // Security reviews that found problems.
        var since = now.AddDays(-Math.Max(1, options.Value.SecurityLookbackDays));
        await using (var command = await db.CommandAsync("""
            SELECT e.run_id, e.seq, r.division_id, r.project_id, r.app_id, r.title, jsonb_array_length(COALESCE(e.payload -> 'findings', '[]'::jsonb))
            FROM run_events e JOIN runs r ON r.organisation_id = e.organisation_id AND r.id = e.run_id
            WHERE e.organisation_id = @org AND e.type = 'message' AND e.at >= @since
              AND e.payload ->> 'kind' = 'security.review' AND e.payload ->> 'passed' = 'false'
              AND jsonb_typeof(COALESCE(e.payload -> 'findings', '[]'::jsonb)) = 'array'
            """, cancellationToken, P("org", organisationId), P("since", since)))
        {
            var findings = new List<(Guid Run, long Seq, Guid? D, Guid? P, Guid? A, string Title, int Count)>();
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    findings.Add((reader.GetGuid(0), reader.GetInt64(1), reader.GuidOrNull("division_id"), reader.GuidOrNull("project_id"), reader.GuidOrNull("app_id"), reader.GetString(5), reader.GetInt32(6)));
                }
            }

            foreach (var f in findings)
            {
                await Raise(f.D, f.P, f.A, NotificationKinds.SecurityFinding, $"The security review found {f.Count} problem{(f.Count == 1 ? "" : "s")}",
                    $"In \"{f.Title}\". Publishing waits until they are fixed.", new NotificationSubject("run", f.Run), $"security:{f.Run:N}:{f.Seq}");
            }
        }

        return raised;
    }

    private static string Credits(decimal value) => decimal.Round(value, 2).ToString("0.##", CultureInfo.InvariantCulture);
}
