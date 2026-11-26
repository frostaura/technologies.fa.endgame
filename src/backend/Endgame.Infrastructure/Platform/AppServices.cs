using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Platform;

// ------------------------------------------------------------------------------------ models

public sealed record AppChatMessage(string? Role, string? Content);

public sealed record AppChatRequest(IReadOnlyList<AppChatMessage>? Messages, string? TaskType, int? MaxTokens, double? Temperature);

public sealed record AppChatUsage(long InputTokens, long OutputTokens);

public sealed record AppChatReply(string Content, string Model, AppChatUsage Usage, decimal Credits);

/// <summary>
/// An app's model call (PLATFORM-API §3.2): the same gateway and the same reservation as an agent's,
/// charged to the app's whole cascade, on an app-safe route fixed by the task type (cheap models, no
/// tools, no web search), and held to the app's own monthly allowance in the transaction that admits it.
/// </summary>
public sealed class AppModelService(ModelGateway gateway, CascadeService cascade, IOptions<AppModelOptions> options)
{
    private static readonly string[] Roles = ["system", "user", "assistant"];

    public async Task<AppChatReply> ChatAsync(AppCaller caller, AppChatRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(request);
        var o = options.Value;
        var taskType = request.TaskType ?? "chat";
        if (!o.Routes.TryGetValue(taskType, out var route))
        {
            throw EndgameProblem.Invalid($"taskType is one of {string.Join(", ", o.Routes.Keys)}.");
        }

        if (request.Messages is not { Count: > 0 } messages || messages.Count > o.MaxMessages)
        {
            throw EndgameProblem.Invalid($"messages is a list of 1 to {o.MaxMessages} messages.");
        }

        var array = new JsonArray();
        foreach (var m in messages)
        {
            if (m?.Role is null || !Roles.Contains(m.Role) || string.IsNullOrEmpty(m.Content))
            {
                throw EndgameProblem.Invalid("Each message has a role (system, user or assistant) and non-empty content.");
            }

            array.Add(new JsonObject { ["role"] = m.Role, ["content"] = m.Content });
        }

        if (request.MaxTokens is <= 0)
        {
            throw EndgameProblem.Invalid("maxTokens is a positive number.");
        }

        var settings = await cascade.ChainEntriesAsync(caller.Scope, CascadeKind.Setting, cancellationToken);
        var capEntry = CascadeResolver.ResolveKey(CascadeKind.Setting, CascadeKeys.AppModelMonthlyCredits, settings);
        var cap = capEntry is null ? o.DefaultMonthlyCredits : CascadeService.NumberOf(JsonNode.Parse(capEntry.Entry.ValueJson)) ?? o.DefaultMonthlyCredits;

        var result = await gateway.CompleteAsync(new ChatRequest
        {
            TaskType = route,
            Scope = caller.Path,
            Messages = array,
            Limits = new ChatLimits { MaxTokens = request.MaxTokens },
            Temperature = request.Temperature,
            AppMonthlyCap = cap,
        }, cancellationToken);

        var body = JsonNode.Parse(result.Body);
        var content = body?["choices"]?[0]?["message"]?["content"] is JsonValue c && c.GetValueKind() == JsonValueKind.String ? c.GetValue<string>() : "";
        var model = body?["model"]?.GetValue<string>() ?? result.Settlement.Model ?? route;
        var usage = new AppChatUsage(Long(body?["usage"]?["prompt_tokens"]), Long(body?["usage"]?["completion_tokens"]));
        return new AppChatReply(content, model, usage, result.Settlement.SettledCredits);
    }

    private static long Long(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var n) ? n : 0;
}

// ------------------------------------------------------------------------------------ secrets

public sealed record SecretView(string Name, string Value, string Scope);

/// <summary>Secrets for apps (PLATFORM-API §3.3): resolved by the cascade resolver from the app upwards.</summary>
public sealed class AppSecretService(CascadeService cascade)
{
    public async Task<SecretView> GetAsync(AppCaller caller, string name, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        if (!SecretNames.IsValid(name))
        {
            throw EndgameProblem.Invalid("A secret name is UPPER_SNAKE_CASE, for example STRIPE_API_KEY.");
        }

        var found = await cascade.RevealSecretAsync(caller.Scope, name, cancellationToken);
        if (found is null)
        {
            var levels = string.Join(", ", caller.Scope.Nodes.Reverse().Select(n => $"{n.Level.ToString().ToLowerInvariant()} {n.Path}"));
            throw new EndgameProblem(404, "secret_not_found", "No such secret", $"No secret named {name} is set at any level searched: {levels}.");
        }

        return new SecretView(name, found.Value.Value, found.Value.SetAtPath);
    }
}

// ------------------------------------------------------------------------------------ email

public sealed record AppEmailRequest(IReadOnlyList<string>? To, string? Subject, string? Text, string? Html, string? ReplyTo);

/// <summary>
/// E-mail from apps (PLATFORM-API §3.4): validated, queued in the outbox, delivered by <see cref="EmailDispatcher"/>. A
/// preview's mail (an unpublished build under check) is validated the same way and held: kept to be read, never sent.
/// </summary>
public sealed class AppEmailService(EndgameDbContext db, TenantSession session, IOptions<EmailOptions> options, TimeProvider clock)
{
    public const int MaxTextBytes = 256 * 1024;
    public const int MaxHtmlBytes = 512 * 1024;

    public async Task<string> QueueAsync(AppCaller caller, AppEmailRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(request);
        if (request.To is not { Count: > 0 } to || to.Count > options.Value.MaxRecipients)
        {
            throw EndgameProblem.Invalid($"to is a list of 1 to {options.Value.MaxRecipients} addresses.");
        }

        var recipients = to.Select(a => AccountService.NormaliseEmail(a)).Distinct(StringComparer.Ordinal).ToArray();
        var subject = request.Subject?.Trim();
        if (string.IsNullOrEmpty(subject) || subject.Length > 300 || subject.Any(char.IsControl))
        {
            throw EndgameProblem.Invalid("subject is one line of 1 to 300 characters.");
        }

        if (string.IsNullOrWhiteSpace(request.Text) || Encoding.UTF8.GetByteCount(request.Text) > MaxTextBytes)
        {
            throw EndgameProblem.Invalid("text is required, at most 256 KB.");
        }

        if (request.Html is { } html && Encoding.UTF8.GetByteCount(html) > MaxHtmlBytes)
        {
            throw EndgameProblem.Invalid("html is at most 512 KB.");
        }

        var replyTo = request.ReplyTo is null ? null : AccountService.NormaliseEmail(request.ReplyTo);
        var now = clock.GetUtcNow();
        var id = Guid.NewGuid();
        session.UseOrganisation(caller.OrganisationId);
        db.EmailMessages.Add(new EmailMessageRecord
        {
            Id = id,
            OrganisationId = caller.OrganisationId,
            AppId = caller.AppId,
            Recipients = recipients,
            Subject = subject,
            TextBody = request.Text,
            HtmlBody = request.Html,
            ReplyTo = replyTo,
            Status = caller.Preview ? EmailStatuses.Held : EmailStatuses.Queued,
            NextAttemptAt = now,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return EmailId(id);
    }

    public static string EmailId(Guid id) => "eml_" + id.ToString("N");
}

public static class EmailStatuses
{
    public const string Queued = "queued";

    /// <summary>Sent by an app's preview: kept for the evaluator to read, never delivered.</summary>
    public const string Held = "held";
}

// ------------------------------------------------------------------------------------ schedules and webhooks

public sealed record ScheduleInput(string? Name, string? Cron, string? TimeZone, string? Path);

public sealed record SchedulesInput(IReadOnlyList<ScheduleInput>? Schedules);

public sealed record ScheduleView(string Name, string Cron, string TimeZone, string Path, DateTimeOffset? NextRunAt);

public sealed record SchedulesView(IReadOnlyList<ScheduleView> Schedules);

public sealed record WebhookInput(string? Name, string? Path);

public sealed record WebhooksInput(IReadOnlyList<WebhookInput>? Webhooks);

public sealed record WebhookView(string Name, string Path);

public sealed record WebhooksView(IReadOnlyList<WebhookView> Webhooks);

/// <summary>What an app declares on every start (PLATFORM-API §3.5–3.6): its recurring jobs and inbound hooks. Each PUT replaces the whole set.</summary>
public sealed class AppDeclarationService(EndgameDbContext db, TenantSession session, IOptions<SchedulerOptions> options, EdgeNotifier edge, TimeProvider clock)
{
    public async Task<SchedulesView> ReplaceSchedulesAsync(AppCaller caller, SchedulesInput input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        var items = input?.Schedules ?? throw EndgameProblem.Invalid("Send { schedules: [...] }; an empty list removes them all.");
        if (items.Count > options.Value.MaxPerApp)
        {
            throw EndgameProblem.Invalid($"An app declares at most {options.Value.MaxPerApp} schedules.");
        }

        var now = clock.GetUtcNow();
        var parsed = new List<(string Name, CronSchedule Cron, string Zone, string Path, DateTimeOffset Next)>();
        foreach (var item in items)
        {
            try
            {
                var name = PlatformNames.RequireSlug("Schedule", item?.Name);
                var cron = CronSchedule.Parse(item!.Cron);
                var zoneId = item.TimeZone ?? "UTC";
                var zone = CronSchedule.Zone(zoneId);
                var path = item.Path ?? $"_platform/schedules/{name}";
                if (path != $"_platform/schedules/{name}")
                {
                    throw new DomainException($"A schedule's path is _platform/schedules/{name}.");
                }

                parsed.Add((name, cron, zoneId, path, cron.NextAfter(now, zone)!.Value));
            }
            catch (DomainException ex)
            {
                throw EndgameProblem.Invalid(ex.Message);
            }
        }

        if (parsed.Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != parsed.Count)
        {
            throw EndgameProblem.Invalid("Two schedules have the same name.");
        }

        session.UseOrganisation(caller.OrganisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        var existing = await db.AppSchedules.Where(s => s.OrganisationId == caller.OrganisationId && s.AppId == caller.AppId).ToListAsync(cancellationToken);
        db.AppSchedules.RemoveRange(existing.Where(e => parsed.All(p => p.Name != e.Name)));
        foreach (var p in parsed)
        {
            var row = existing.FirstOrDefault(e => e.Name == p.Name);
            if (row is null)
            {
                row = new AppScheduleRecord { Id = Guid.NewGuid(), OrganisationId = caller.OrganisationId, AppId = caller.AppId, Name = p.Name };
                db.AppSchedules.Add(row);
            }

            if (row.Cron != p.Cron.Expression || row.TimeZone != p.Zone || row.NextRunAt is null)
            {
                row.NextRunAt = p.Next;
            }

            row.Cron = p.Cron.Expression;
            row.TimeZone = p.Zone;
            row.Path = p.Path;
            row.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return await SchedulesAsync(caller.OrganisationId, caller.AppId, cancellationToken);
    }

    public async Task<SchedulesView> SchedulesAsync(Guid organisationId, Guid appId, CancellationToken cancellationToken)
    {
        session.UseOrganisation(organisationId);
        var rows = await db.AppSchedules.AsNoTracking().Where(s => s.OrganisationId == organisationId && s.AppId == appId).OrderBy(s => s.Name).ToListAsync(cancellationToken);
        return new SchedulesView(rows.Select(s => new ScheduleView(s.Name, s.Cron, s.TimeZone, s.Path, s.NextRunAt)).ToList());
    }

    public async Task<WebhooksView> ReplaceWebhooksAsync(AppCaller caller, WebhooksInput input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        var items = input?.Webhooks ?? throw EndgameProblem.Invalid("Send { webhooks: [...] }; an empty list removes them all.");
        if (items.Count > options.Value.MaxPerApp)
        {
            throw EndgameProblem.Invalid($"An app declares at most {options.Value.MaxPerApp} webhooks.");
        }

        var parsed = new List<WebhookView>();
        foreach (var item in items)
        {
            string name;
            try
            {
                name = PlatformNames.RequireSlug("Webhook", item?.Name);
            }
            catch (DomainException ex)
            {
                throw EndgameProblem.Invalid(ex.Message);
            }

            var path = item!.Path ?? $"hooks/{name}";
            if (path != $"hooks/{name}")
            {
                throw EndgameProblem.Invalid($"A webhook's path is hooks/{name}.");
            }

            parsed.Add(new WebhookView(name, path));
        }

        if (parsed.Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != parsed.Count)
        {
            throw EndgameProblem.Invalid("Two webhooks have the same name.");
        }

        var now = clock.GetUtcNow();
        session.UseOrganisation(caller.OrganisationId);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await session.ApplyAsync(db, cancellationToken);
        await db.AppWebhooks.Where(w => w.OrganisationId == caller.OrganisationId && w.AppId == caller.AppId).ExecuteDeleteAsync(cancellationToken);
        db.AppWebhooks.AddRange(parsed.Select(p => new AppWebhookRecord { Id = Guid.NewGuid(), OrganisationId = caller.OrganisationId, AppId = caller.AppId, Name = p.Name, Path = p.Path, UpdatedAt = now }));
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
        edge.RoutesChanged();
        return new WebhooksView(parsed.OrderBy(p => p.Name, StringComparer.Ordinal).ToList());
    }
}

// ------------------------------------------------------------------------------------ hosting

public sealed record HostingSampleInput(string? SampleId, Guid AppId, DateTimeOffset From, DateTimeOffset To, long AwakeSeconds, long MemoryBytes, long StorageBytes, long Requests);

public sealed record HostingUsageRequest(IReadOnlyList<HostingSampleInput>? Samples);

public sealed record HostingUsageResult(int Recorded, int Duplicates, decimal Credits);

/// <summary>
/// Hosting is metered (spec: credits meter AI and hosting both): Dock reports per-app usage samples —
/// awake time, memory while awake, storage, requests — and each becomes one <c>hosting</c> ledger
/// entry through the same cost-to-credits conversion as a model call. Budgets and the overdraft count it.
/// </summary>
public sealed class HostingMeter(EndgameDbContext db, TenantSession session, ScopeResolver scopes, CreditLedger ledger, CreditOptions credits, IOptions<HostingOptions> options, EdgeNotifier edge, TimeProvider clock)
{
    private const decimal Gigabyte = 1024m * 1024m * 1024m;

    public async Task<HostingUsageResult> RecordAsync(HostingUsageRequest request, CancellationToken cancellationToken)
    {
        var samples = request?.Samples ?? throw EndgameProblem.Invalid("Send { samples: [...] }.");
        if (samples.Count > 1000)
        {
            throw EndgameProblem.Invalid("At most 1000 samples per report.");
        }

        var o = options.Value;
        int recorded = 0, duplicates = 0;
        decimal total = 0;
        foreach (var s in samples)
        {
            if (string.IsNullOrWhiteSpace(s.SampleId) || s.SampleId.Length > 150)
            {
                throw EndgameProblem.Invalid("Every sample has a sampleId (1-150 characters) so reporting it twice charges once.");
            }

            var seconds = (decimal)(s.To - s.From).TotalSeconds;
            if (seconds <= 0 || seconds > o.MaxSampleHours * 3600m || s.AwakeSeconds < 0 || s.AwakeSeconds > seconds + 1 || s.MemoryBytes < 0 || s.StorageBytes < 0 || s.Requests < 0)
            {
                throw EndgameProblem.Invalid($"Sample {s.SampleId}: from is before to, covers at most {o.MaxSampleHours} hours, and every amount is non-negative with awake time inside the period.");
            }

            var app = await scopes.FindNodeAsync(Domain.Tree.NodeLevel.App, s.AppId, cancellationToken) ?? throw EndgameProblem.NotFound($"The app of sample {s.SampleId}");
            var usd = (s.AwakeSeconds / 3600m * (o.UsdPerAwakeHour + (s.MemoryBytes / Gigabyte * o.UsdPerGbHourMemory)))
                      + (s.StorageBytes / Gigabyte * o.UsdPerGbMonthStorage * (seconds / (30m * 86400m)))
                      + (s.Requests / 1_000_000m * o.UsdPerMillionRequests);
            usd = decimal.Round(usd, 10, MidpointRounding.AwayFromZero);
            var charge = credits.ToCredits(usd);

            session.UseOrganisation(app.OrganisationId);
            if (await db.HostingSamples.AsNoTracking().AnyAsync(h => h.OrganisationId == app.OrganisationId && h.SampleId == s.SampleId, cancellationToken))
            {
                duplicates++;
                continue;
            }

            var entry = ledger.HostingEntry(app, charge, usd, s.SampleId,
                string.Create(CultureInfo.InvariantCulture, $"hosting {s.From:O}..{s.To:O}: {s.AwakeSeconds}s awake, {s.MemoryBytes / 1048576} MB, {s.StorageBytes / 1048576} MB stored, {s.Requests} requests"));
            db.CreditEntries.Add(entry);
            db.HostingSamples.Add(new HostingSampleRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = app.OrganisationId,
                AppId = s.AppId,
                SampleId = s.SampleId,
                PeriodStart = s.From,
                PeriodEnd = s.To,
                AwakeSeconds = s.AwakeSeconds,
                MemoryBytes = s.MemoryBytes,
                StorageBytes = s.StorageBytes,
                Requests = s.Requests,
                CostUsd = usd,
                Credits = charge,
                CreditEntryId = entry.Id,
                ReceivedAt = clock.GetUtcNow(),
            });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                recorded++;
                total += charge;
            }
            catch (DbUpdateException)
            {
                duplicates++;
            }

            db.ChangeTracker.Clear();
        }

        if (recorded > 0)
        {
            // A charge can carry an organisation past its overdraft limit; Edge should see it now.
            edge.RoutesChanged();
        }

        return new HostingUsageResult(recorded, duplicates, total);
    }

    /// <summary>The window of measured hosting a running-cost estimate reads.</summary>
    public const int RunningCostWindowDays = 14;

    /// <summary>Less measured time than this and there is no estimate: "not enough history yet".</summary>
    public const int RunningCostMinimumHours = 24;

    private const decimal HoursInMonth = 720m;

    /// <summary>
    /// What each running choice would cost a month (UC-107), from this app's own measured hosting over the
    /// last <see cref="RunningCostWindowDays"/> days and the current hosting prices. The measured time runs
    /// from the start of the first sample in the window to the end of the last; with less than
    /// <see cref="RunningCostMinimumHours"/> of it there is no estimate. "Sleeps when unused" keeps the
    /// measured share of time awake; "always on" is awake all 720 hours of a month; both at the mean memory
    /// while awake, the latest storage, and the measured requests a month.
    /// </summary>
    public async Task<RunningCostView> RunningCostAsync(Guid organisationId, Guid appId, CancellationToken cancellationToken)
    {
        var since = clock.GetUtcNow().AddDays(-RunningCostWindowDays);
        session.UseOrganisation(organisationId);
        await using var command = await db.CommandAsync("""
            SELECT COALESCE(EXTRACT(EPOCH FROM (MAX(period_end) - MIN(period_start))), 0)::numeric,
                   COALESCE(SUM(awake_seconds), 0)::numeric,
                   COALESCE(SUM(awake_seconds::numeric * memory_bytes), 0)::numeric,
                   COALESCE((SELECT storage_bytes FROM hosting_samples l
                             WHERE l.organisation_id = @org AND l.app_id = @app AND l.period_start >= @since AND l.storage_bytes > 0
                             ORDER BY l.period_end DESC, l.received_at DESC LIMIT 1), 0)::numeric,
                   COALESCE(SUM(requests), 0)::numeric
            FROM hosting_samples WHERE organisation_id = @org AND app_id = @app AND period_start >= @since
            """, cancellationToken, P("org", organisationId), P("app", appId), P("since", since));
        decimal observedSeconds, awakeSeconds, memorySeconds, storage, requests;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            (observedSeconds, awakeSeconds, memorySeconds, storage, requests) = (reader.GetDecimal(0), reader.GetDecimal(1), reader.GetDecimal(2), reader.GetDecimal(3), reader.GetDecimal(4));
        }

        var o = options.Value;
        var prices = string.Create(CultureInfo.InvariantCulture,
            $"Today's prices: {Figure(credits.ToCredits(o.UsdPerAwakeHour))} credits an awake hour, {Figure(credits.ToCredits(o.UsdPerGbHourMemory))} per GB of memory an awake hour, {Figure(credits.ToCredits(o.UsdPerGbMonthStorage))} per GB stored a month and {Figure(credits.ToCredits(o.UsdPerMillionRequests))} per million requests.");
        var observedHours = decimal.Round(observedSeconds / 3600m, 1);
        if (observedSeconds < RunningCostMinimumHours * 3600m)
        {
            var basis = observedSeconds <= 0
                ? $"Nothing measured yet. An estimate needs at least {RunningCostMinimumHours} hours of this app's own use in the last {RunningCostWindowDays} days."
                : string.Create(CultureInfo.InvariantCulture, $"Only {Figure(observedHours)} hours measured so far. An estimate needs at least {RunningCostMinimumHours} hours of this app's own use in the last {RunningCostWindowDays} days.");
            return new RunningCostView(RunningCostStates.NotEnoughHistory, RunningCostWindowDays, RunningCostMinimumHours, observedHours, basis, prices, null, null, null);
        }

        var month = HoursInMonth * 3600m;
        var memory = awakeSeconds > 0 ? memorySeconds / awakeSeconds : 0;
        var memoryGb = memory / Gigabyte;
        var requestsPerMonth = requests / observedSeconds * month;
        var perAwakeHour = o.UsdPerAwakeHour + (memoryGb * o.UsdPerGbHourMemory);
        var fixedUsd = (storage / Gigabyte * o.UsdPerGbMonthStorage) + (requestsPerMonth / 1_000_000m * o.UsdPerMillionRequests);
        var sleepHours = awakeSeconds / observedSeconds * HoursInMonth;
        var sleepCredits = decimal.Round(credits.ToCredits((sleepHours * perAwakeHour) + fixedUsd), 2, MidpointRounding.AwayFromZero);
        var alwaysOnCredits = decimal.Round(credits.ToCredits((HoursInMonth * perAwakeHour) + fixedUsd), 2, MidpointRounding.AwayFromZero);

        var memoryMb = decimal.Round(memory / (1024m * 1024m), 0);
        var awakeHours = decimal.Round(awakeSeconds / 3600m, 1);
        var stored = Size(storage);
        var perMonth = decimal.Round(requestsPerMonth, 0);
        var measured = string.Create(CultureInfo.InvariantCulture,
            $"Measured over the last {RunningCostWindowDays} days: awake {Figure(awakeHours)} of the {Figure(observedHours)} hours measured, using {Figure(memoryMb)} MB while awake, {stored} stored and about {perMonth:N0} requests a month.");
        var sleep = new RunningChoiceCost(sleepCredits, decimal.Round(sleepHours, 1),
            string.Create(CultureInfo.InvariantCulture,
                $"Awake about {Figure(decimal.Round(sleepHours, 0))} hours a month, as it was {Figure(awakeHours)} of the {Figure(observedHours)} hours measured in the last {RunningCostWindowDays} days, using {Figure(memoryMb)} MB while awake, with {stored} stored and about {perMonth:N0} requests a month."));
        var alwaysOn = new RunningChoiceCost(alwaysOnCredits, HoursInMonth,
            string.Create(CultureInfo.InvariantCulture,
                $"Awake all 720 hours of a month at the {Figure(memoryMb)} MB it uses while awake, with the same {stored} stored and about {perMonth:N0} requests a month."));
        return new RunningCostView(RunningCostStates.Estimated, RunningCostWindowDays, RunningCostMinimumHours, observedHours, measured, prices, sleep, alwaysOn,
            new RunningCostMeasured(awakeHours, memoryMb, decimal.Round(storage / (1024m * 1024m), 0), perMonth));
    }

    private static string Figure(decimal value) => value.ToString("0.####", CultureInfo.InvariantCulture);

    private static string Size(decimal bytes) => bytes >= Gigabyte
        ? string.Create(CultureInfo.InvariantCulture, $"{Figure(decimal.Round(bytes / Gigabyte, 1))} GB")
        : string.Create(CultureInfo.InvariantCulture, $"{Figure(decimal.Round(bytes / (1024m * 1024m), 0))} MB");
}

public static class RunningCostStates
{
    public const string Estimated = "estimated";
    public const string NotEnoughHistory = "not-enough-history";
}

/// <param name="Credits">Expected credits a month for this choice.</param>
/// <param name="AwakeHoursPerMonth">The awake hours a month it assumes.</param>
/// <param name="Basis">What it assumes, in one plain sentence.</param>
public sealed record RunningChoiceCost(decimal Credits, decimal AwakeHoursPerMonth, string Basis);

/// <param name="AwakeHours">Hours awake in the measured time.</param>
/// <param name="MemoryMb">Mean memory while awake.</param>
/// <param name="StorageMb">The latest stored size.</param>
/// <param name="RequestsPerMonth">Measured requests, stretched to a month.</param>
public sealed record RunningCostMeasured(decimal AwakeHours, decimal MemoryMb, decimal StorageMb, decimal RequestsPerMonth);

/// <summary>
/// <c>runningCost</c> of <c>GET /api/apps/{id}</c>: what each running choice would cost a month, or why
/// there is no estimate yet (<c>state: not-enough-history</c>, with <c>sleep</c> and <c>alwaysOn</c> null).
/// </summary>
/// <param name="State"><c>estimated</c> or <c>not-enough-history</c>.</param>
/// <param name="WindowDays">How far back the measured use is read.</param>
/// <param name="MinimumHours">How much measured time an estimate needs.</param>
/// <param name="MeasuredHours">Measured time in the window: from the first sample's start to the last one's end.</param>
/// <param name="Basis">What was measured, or why there is no estimate yet.</param>
/// <param name="Prices">The hosting prices it uses, in credits, as they stand now.</param>
public sealed record RunningCostView(string State, int WindowDays, int MinimumHours, decimal MeasuredHours, string Basis, string Prices,
    RunningChoiceCost? Sleep, RunningChoiceCost? AlwaysOn, RunningCostMeasured? Measured);

// ------------------------------------------------------------------------------------ edge

/// <summary>
/// Tells Edge its routing table changed (<c>POST {EdgeControl}/internal/routes/refresh</c>). Edge polls the
/// table anyway; this makes a top-up, a budget or overdraft change, a pause, a new app or a new webhook take
/// effect at once. <see cref="RoutesChangedAsync"/> waits for Edge to have read the new table (its refresh
/// endpoint answers after reading), so a person who changes a budget and opens the app sees the change
/// (D67); a failure is logged and never fails the change. Switched off when <c>Services:EdgeControl</c> is empty.
/// </summary>
public sealed class EdgeNotifier(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IConfiguration configuration, ILogger<EdgeNotifier> logger)
{
    public const string ClientName = "edge-control";

    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    /// <summary>In the background, for work that is not a person's request.</summary>
    public void RoutesChanged() => _ = Task.Run(() => RoutesChangedAsync(CancellationToken.None));

    /// <summary>Tells Edge and waits, at most <see cref="Timeout"/>, until it has read the new table.</summary>
    public async Task RoutesChangedAsync(CancellationToken cancellationToken)
    {
        var control = addresses.Value.EdgeControl;
        if (string.IsNullOrWhiteSpace(control) || !Uri.TryCreate(control, UriKind.Absolute, out var root))
        {
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "/internal/routes/refresh"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["ENDGAME_SERVICE_TOKEN"]);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(Timeout);
            using var response = await http.CreateClient(ClientName).SendAsync(request, timeout.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            logger.LogDebug("Edge was not told about a routing change ({Message}); it will see it on its next poll.", ex.Message);
        }
    }
}

// ------------------------------------------------------------------------------------ callbacks

/// <summary>
/// Calls an app back (PLATFORM-API §4) — a schedule run — signed with the app's token exactly as
/// <c>Endgame.AppKit.CallbackSignature</c> checks: <c>X-Endgame-Signature: t=&lt;unix&gt;,v1=&lt;hex
/// HMAC-SHA256(token, "&lt;t&gt;." + body)&gt;</c>. By default through Edge's control listener, which
/// wakes the app and forwards; never through Edge's public side, which refuses <c>_platform/*</c>.
/// </summary>
public sealed class AppCallbackClient(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IOptions<SchedulerOptions> options, IConfiguration configuration)
{
    public const string ClientName = "app-callbacks";
    public const string SignatureHeader = "X-Endgame-Signature";

    public async Task<int> PostAsync(Guid appId, string path, byte[] body, string appToken, DateTimeOffset at, CancellationToken cancellationToken)
    {
        var o = options.Value;
        Uri target;
        var viaEdge = !string.Equals(o.Transport, "direct", StringComparison.OrdinalIgnoreCase);
        if (viaEdge)
        {
            var rest = path.StartsWith("_platform/", StringComparison.Ordinal) ? path["_platform/".Length..] : path;
            target = new Uri(new Uri(addresses.Value.EdgeControl), $"/internal/apps/{appId:D}/platform/{rest}");
        }
        else
        {
            target = new Uri($"http://app-{appId:N}:8080/{path}");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, target) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Headers.TryAddWithoutValidation(SignatureHeader, Sign(appToken, body, at));
        if (viaEdge)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration["ENDGAME_SERVICE_TOKEN"]);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, o.TimeoutSeconds)));
        using var response = await http.CreateClient(ClientName).SendAsync(request, timeout.Token);
        return (int)response.StatusCode;
    }

    public static string Sign(string appToken, byte[] body, DateTimeOffset at)
    {
        var t = at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var prefix = Encoding.UTF8.GetBytes(t + ".");
        var mac = System.Security.Cryptography.HMACSHA256.HashData(Encoding.UTF8.GetBytes(appToken), (byte[])[.. prefix, .. body]);
        return $"t={t},v1={Convert.ToHexStringLower(mac)}";
    }
}
