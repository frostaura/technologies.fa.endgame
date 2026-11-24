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

/// <summary>E-mail from apps (PLATFORM-API §3.4): validated, queued in the outbox, delivered by <see cref="EmailDispatcher"/>.</summary>
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
            Status = "queued",
            NextAttemptAt = now,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return EmailId(id);
    }

    public static string EmailId(Guid id) => "eml_" + id.ToString("N");
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

    /// <summary>Expected monthly credits for each running choice, from the app's measured hosting over the last seven days. Null before any was measured.</summary>
    public async Task<(decimal Sleep, decimal AlwaysOn)?> RunningCostAsync(Guid organisationId, Guid appId, CancellationToken cancellationToken)
    {
        var since = clock.GetUtcNow().AddDays(-7);
        session.UseOrganisation(organisationId);
        await using var command = await db.CommandAsync("""
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (period_end - period_start))), 0), COALESCE(SUM(awake_seconds), 0), COALESCE(SUM(credits), 0),
                   COALESCE(MAX(memory_bytes), 0), COALESCE(MAX(storage_bytes), 0), COALESCE(SUM(requests), 0), COUNT(*)
            FROM hosting_samples WHERE organisation_id = @org AND app_id = @app AND period_end >= @since
            """, cancellationToken, P("org", organisationId), P("app", appId), P("since", since));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        if (reader.GetInt64(6) == 0)
        {
            return null;
        }

        var period = reader.GetDecimal(0);
        var charged = reader.GetDecimal(2);
        var memory = reader.GetInt64(3);
        var storage = reader.GetInt64(4);
        var requests = reader.GetDecimal(5);
        var month = 30m * 86400m;
        var sleep = period <= 0 ? 0 : charged / period * month;
        var o = options.Value;
        var alwaysOnUsd = (month / 3600m * (o.UsdPerAwakeHour + (memory / Gigabyte * o.UsdPerGbHourMemory)))
                          + (storage / Gigabyte * o.UsdPerGbMonthStorage)
                          + (period <= 0 ? 0 : requests / period * month / 1_000_000m * o.UsdPerMillionRequests);
        return (decimal.Round(sleep, 2), decimal.Round(credits.ToCredits(alwaysOnUsd), 2));
    }
}

// ------------------------------------------------------------------------------------ edge

/// <summary>
/// Tells Edge its routing table changed (<c>POST {EdgeControl}/internal/routes/refresh</c>), best
/// effort and in the background: Edge polls the table anyway, this only makes a top-up, a pause or
/// a new webhook take effect at once. Switched off when <c>Services:EdgeControl</c> is empty.
/// </summary>
public sealed class EdgeNotifier(IHttpClientFactory http, IOptions<ServiceAddresses> addresses, IConfiguration configuration, ILogger<EdgeNotifier> logger)
{
    public const string ClientName = "edge-control";

    public void RoutesChanged()
    {
        var control = addresses.Value.EdgeControl;
        if (string.IsNullOrWhiteSpace(control) || !Uri.TryCreate(control, UriKind.Absolute, out var root))
        {
            return;
        }

        var token = configuration["ENDGAME_SERVICE_TOKEN"];
        _ = Task.Run(async () =>
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(root, "/internal/routes/refresh"));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var response = await http.CreateClient(ClientName).SendAsync(request, timeout.Token);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or OperationCanceledException)
            {
                logger.LogDebug("Edge was not told about a routing change ({Message}); it will see it on its next poll.", ex.Message);
            }
        });
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
