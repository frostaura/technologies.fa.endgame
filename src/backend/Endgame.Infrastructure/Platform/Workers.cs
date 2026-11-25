using System.Net;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using Endgame.Application.Email;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Platform;

// ------------------------------------------------------------------------------------ SMTP

/// <summary>
/// The one <see cref="IEmailSender"/>: SMTP, configured entirely from the environment
/// (<see cref="SmtpOptions"/>). Unconfigured, it reports so and sends nothing. Values are never logged.
/// </summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    public bool IsConfigured => options.Value.IsConfigured;

    public async Task SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(email);
        var o = options.Value;
        if (!o.IsConfigured)
        {
            throw new InvalidOperationException("SMTP is not configured; nothing is sent.");
        }

        using var message = new MailMessage
        {
            From = new MailAddress(o.From, email.FromDisplayName),
            Subject = email.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            Body = email.Text,
            IsBodyHtml = false,
        };
        foreach (var to in email.To)
        {
            message.To.Add(new MailAddress(to));
        }

        if (email.ReplyTo is { } replyTo)
        {
            message.ReplyToList.Add(new MailAddress(replyTo));
        }

        if (email.Html is { } html)
        {
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(html, Encoding.UTF8, "text/html"));
        }

        message.Headers.Add("Message-ID", $"<{email.MessageId}@endgame>");
        using var client = new SmtpClient(o.Host, o.Port)
        {
            EnableSsl = o.StartTls,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = o.TimeoutSeconds * 1000,
            Credentials = o.Username.Length > 0 ? new NetworkCredential(o.Username, o.Password) : null,
        };
        await client.SendMailAsync(message, cancellationToken);
    }
}

/// <summary>
/// Delivers the outbox through <see cref="IEmailSender"/>: claims due messages with a lease
/// (<c>FOR UPDATE SKIP LOCKED</c>, so two control planes never send one twice in the same window),
/// sends each, and retries failures with back-off up to <see cref="EmailOptions.MaxAttempts"/>. With
/// SMTP unconfigured it does nothing at all.
/// </summary>
public sealed class EmailDispatcher(IServiceScopeFactory scopes, IEmailSender sender, IOptions<EmailOptions> options, ILogger<EmailDispatcher> logger, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.DispatchEnabled)
        {
            return;
        }

        if (!sender.IsConfigured)
        {
            logger.LogInformation("SMTP is not configured (Smtp__Host, Smtp__From); app e-mail stays queued and nothing is sent.");
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.DispatchSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await DispatchOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "The e-mail dispatcher failed a pass; it runs again on the next tick.");
            }
        }
    }

    /// <summary>One pass over the outbox. Returns how many messages were sent.</summary>
    public async Task<int> DispatchOnceAsync(CancellationToken cancellationToken)
    {
        if (!sender.IsConfigured)
        {
            return 0;
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var now = clock.GetUtcNow();
        var claimed = new List<(Guid Id, Guid Org, Guid? App, string[] To, string Subject, string Text, string? Html, string? ReplyTo, int Attempts)>();
        await using (var command = await db.CommandAsync("""
            UPDATE email_messages m SET status = 'sending', lease_until = @lease, attempts = m.attempts + 1
            WHERE m.id IN (SELECT id FROM email_messages
                           WHERE (status = 'queued' AND next_attempt_at <= @now) OR (status = 'sending' AND lease_until < @now)
                           ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
            RETURNING m.id, m.organisation_id, m.app_id, m.recipients, m.subject, m.text_body, m.html_body, m.reply_to, m.attempts
            """, cancellationToken, P("now", now), P("lease", now.AddMinutes(2))))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                claimed.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GuidOrNull("app_id"), reader.GetFieldValue<string[]>(3), reader.GetString(4), reader.GetString(5),
                    reader.TextOrNull("html_body"), reader.TextOrNull("reply_to"), reader.GetInt32(8)));
            }
        }

        var sent = 0;
        foreach (var m in claimed)
        {
            var appName = m.App is { } app
                ? await db.Apps.AsNoTracking().Where(a => a.OrganisationId == m.Org && a.Id == app).Select(a => a.Name).SingleOrDefaultAsync(cancellationToken) ?? "Endgame"
                : "Endgame";
            string status;
            string? error = null;
            try
            {
                await sender.SendAsync(new OutgoingEmail(m.To, m.Subject, m.Text, m.Html, m.ReplyTo, appName, m.Id.ToString("N")), cancellationToken);
                status = "sent";
                sent++;
            }
            catch (Exception ex) when (ex is SmtpException or InvalidOperationException or IOException or FormatException)
            {
                status = m.Attempts >= options.Value.MaxAttempts ? "failed" : "queued";
                error = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
                logger.LogWarning("E-mail {Id} was not delivered (attempt {Attempt}): {Error}", m.Id, m.Attempts, error);
            }

            var next = clock.GetUtcNow().AddSeconds(Math.Min(3600, 30 * Math.Pow(2, m.Attempts)));
            await using var update = await db.CommandAsync("""
                UPDATE email_messages SET status = @status, lease_until = NULL, last_error = @error, sent_at = CASE WHEN @status = 'sent' THEN @now ELSE NULL END,
                       next_attempt_at = @next
                WHERE id = @id
                """, cancellationToken, P("status", status), P("error", error), P("now", clock.GetUtcNow()), P("next", next), P("id", m.Id));
            await update.ExecuteNonQueryAsync(cancellationToken);
        }

        return sent;
    }
}

// ------------------------------------------------------------------------------------ the scheduler

/// <summary>
/// The scheduler: a leased polling loop, not Quartz.NET. Due schedules are claimed with one
/// conditional update (<c>FOR UPDATE SKIP LOCKED</c>, and a lease that a crashed control plane's
/// successor takes over once it lapses), each app is called back signed, and the row moves to its
/// next occurrence. Missed runs while the platform was down are run once, not replayed. Chosen over
/// Quartz because it is a page of code over a table the platform already has, under the same
/// row-level security, with no second schema or package to carry.
/// </summary>
public sealed class Scheduler(IServiceScopeFactory scopes, IOptions<SchedulerOptions> options, ILogger<Scheduler> logger, TimeProvider clock) : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string holder = $"{(Environment.MachineName.Length > 100 ? Environment.MachineName[..100] : Environment.MachineName)}:{Guid.NewGuid():N}";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.PollSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await RunDueOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "The scheduler failed a pass; it runs again on the next tick.");
            }
        }
    }

    /// <summary>One pass: runs every schedule that is due. Returns how many runs were attempted.</summary>
    public async Task<int> RunDueOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<EndgameDbContext>();
        var session = services.GetRequiredService<TenantSession>();
        var tokens = services.GetRequiredService<AppTokenService>();
        var callbacks = services.GetRequiredService<AppCallbackClient>();
        var now = clock.GetUtcNow();
        session.UseSystem();
        var due = new List<(Guid Id, Guid Org, Guid App, string Name, string Cron, string Zone, string Path, DateTimeOffset ScheduledFor)>();
        await using (var command = await db.CommandAsync("""
            UPDATE app_schedules s SET lease_holder = @holder, lease_expires_at = @lease
            WHERE s.id IN (SELECT id FROM app_schedules
                           WHERE next_run_at <= @now AND (lease_expires_at IS NULL OR lease_expires_at < @now)
                           ORDER BY next_run_at LIMIT 50 FOR UPDATE SKIP LOCKED)
            RETURNING s.id, s.organisation_id, s.app_id, s.name, s.cron, s.time_zone, s.path, s.next_run_at
            """, cancellationToken, P("holder", holder), P("lease", now.AddSeconds(options.Value.LeaseSeconds)), P("now", now)))
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                due.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.GetString(6), reader.GetFieldValue<DateTimeOffset>(7)));
            }
        }

        foreach (var run in due)
        {
            int? status = null;
            string? error = null;
            try
            {
                var token = await tokens.CurrentTokenAsync(run.Org, run.App, cancellationToken);
                if (token is null)
                {
                    error = "The app has no platform token yet (it has not been started).";
                }
                else
                {
                    var body = JsonSerializer.SerializeToUtf8Bytes(new { scheduledFor = run.ScheduledFor }, Json);
                    status = await callbacks.PostAsync(run.App, run.Path, body, token, clock.GetUtcNow(), cancellationToken);
                    error = status == 204 ? null : $"The app answered {status}.";
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or UriFormatException)
            {
                error = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
            }

            DateTimeOffset? next;
            try
            {
                next = CronSchedule.Parse(run.Cron).NextAfter(clock.GetUtcNow(), CronSchedule.Zone(run.Zone));
            }
            catch (Endgame.Domain.DomainException)
            {
                next = null;
            }

            session.UseSystem();
            await using var update = await db.CommandAsync("""
                UPDATE app_schedules SET lease_holder = NULL, lease_expires_at = NULL, next_run_at = @next, last_run_at = @now,
                       last_scheduled_for = @for, last_status = @status, last_error = @error
                WHERE id = @id AND lease_holder = @holder
                """, cancellationToken, P("next", next), P("now", clock.GetUtcNow()), P("for", run.ScheduledFor),
                new NpgsqlParameter("status", NpgsqlTypes.NpgsqlDbType.Integer) { Value = (object?)status ?? DBNull.Value }, P("error", error), P("id", run.Id), P("holder", holder));
            await update.ExecuteNonQueryAsync(cancellationToken);
            if (error is not null)
            {
                logger.LogInformation("Schedule {Name} of app {AppId} did not succeed: {Error}", run.Name, run.App, error);
            }
        }

        return due.Count;
    }
}
