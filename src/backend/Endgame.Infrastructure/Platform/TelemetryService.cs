using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.Extensions.Options;
using static Endgame.Infrastructure.Persistence.Db;

namespace Endgame.Infrastructure.Platform;

public sealed record TelemetryEventInput(string? Name, DateTimeOffset? At, JsonObject? Properties, string? UserId);

public sealed record TelemetryEventsInput(IReadOnlyList<TelemetryEventInput>? Events);

/// <summary>An app's measured traffic today (UTC) and its health over the last fifteen minutes, from its own telemetry.</summary>
public sealed record AppTelemetrySummary(
    long VisitsToday,
    long RequestsToday,
    long ErrorsToday,
    double? LatencyP50Ms,
    double? LatencyP95Ms,
    DateTimeOffset? LastVisitAt,
    string Health,
    long RecentRequests,
    long RecentErrors,
    DateTimeOffset LastSeenAt);

/// <summary>
/// Telemetry intake and its read side. Default telemetry belongs to the app's organisation and is
/// used only to run that tenant's service (CLAUDE.md rule 2): every row carries the organisation and
/// is under its row-level security, and nothing here reads across organisations except the sweep's
/// pruning by age.
/// </summary>
public sealed class TelemetryService(EndgameDbContext db, TenantSession session, IOptions<TelemetryOptions> options, TimeProvider clock)
{
    /// <summary>The share of server responses that may fail in fifteen minutes before an app is called degraded.</summary>
    public const double DegradedErrorRate = 0.05;

    public async Task<int> IngestEventsAsync(AppCaller caller, TelemetryEventsInput input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        var events = input?.Events ?? throw EndgameProblem.Invalid("Send { events: [...] }.");
        if (events.Count > options.Value.MaxEventsPerRequest)
        {
            throw EndgameProblem.Invalid($"At most {options.Value.MaxEventsPerRequest} events per request.");
        }

        var now = clock.GetUtcNow();
        var rows = new List<TelemetryEventRecord>();
        foreach (var e in events)
        {
            string name;
            try
            {
                name = PlatformNames.RequireEventName(e?.Name);
            }
            catch (DomainException ex)
            {
                throw EndgameProblem.Invalid(ex.Message);
            }

            var properties = e!.Properties?.ToJsonString() ?? "{}";
            if (Encoding.UTF8.GetByteCount(properties) > options.Value.MaxPropertiesBytes)
            {
                throw EndgameProblem.Invalid($"An event's properties are at most {options.Value.MaxPropertiesBytes} bytes.");
            }

            if (e.UserId is { Length: > 100 })
            {
                throw EndgameProblem.Invalid("userId is at most 100 characters.");
            }

            rows.Add(new TelemetryEventRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = caller.OrganisationId,
                AppId = caller.AppId,
                Name = name,
                At = e.At ?? now,
                UserId = e.UserId,
                PropertiesJson = properties,
                ReceivedAt = now,
            });
        }

        session.UseOrganisation(caller.OrganisationId);
        db.TelemetryEvents.AddRange(rows);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return rows.Count;
    }

    /// <summary>One OTLP/HTTP export: <c>traces</c>, <c>metrics</c> or <c>logs</c>, protobuf or JSON, optionally gzipped.</summary>
    public async Task<int> IngestOtlpAsync(AppCaller caller, string signal, string? contentType, string? contentEncoding, byte[] body, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(caller);
        ArgumentNullException.ThrowIfNull(body);
        if (string.Equals(contentEncoding, "gzip", StringComparison.OrdinalIgnoreCase))
        {
            body = Gunzip(body, options.Value.MaxBodyBytes);
        }

        var json = contentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true;
        var now = clock.GetUtcNow();
        session.UseOrganisation(caller.OrganisationId);
        int count;
        try
        {
            switch (signal)
            {
                case "traces":
                    var spans = OtlpDecoder.Traces(body, json);
                    db.TelemetrySpans.AddRange(spans.Select(s => new TelemetrySpanRecord
                    {
                        Id = Guid.NewGuid(),
                        OrganisationId = caller.OrganisationId,
                        AppId = caller.AppId,
                        TraceId = s.TraceId,
                        SpanId = s.SpanId,
                        ParentSpanId = s.ParentSpanId,
                        Name = s.Name,
                        Kind = s.Kind,
                        StartAt = s.Start,
                        DurationMs = s.DurationMs,
                        StatusCode = s.StatusCode,
                        HttpMethod = s.HttpMethod,
                        HttpRoute = s.HttpRoute,
                        UrlPath = s.UrlPath,
                        HttpStatus = s.HttpStatus,
                        ReceivedAt = now,
                    }));
                    count = spans.Count;
                    break;
                case "metrics":
                    var points = OtlpDecoder.Metrics(body, json);
                    db.TelemetryMetrics.AddRange(points.Select(p => new TelemetryMetricRecord
                    {
                        Id = Guid.NewGuid(),
                        OrganisationId = caller.OrganisationId,
                        AppId = caller.AppId,
                        Name = p.Name.Length > 200 ? p.Name[..200] : p.Name,
                        Unit = p.Unit is { Length: > 50 } u ? u[..50] : p.Unit,
                        Type = p.Type,
                        At = p.At,
                        Value = p.Value is { } v && double.IsFinite(v) ? v : null,
                        Count = p.Count,
                        Sum = p.Sum is { } s && double.IsFinite(s) ? s : null,
                        ReceivedAt = now,
                    }));
                    count = points.Count;
                    break;
                case "logs":
                    var max = options.Value.MaxLogBodyChars;
                    var logs = OtlpDecoder.Logs(body, json);
                    db.TelemetryLogs.AddRange(logs.Select(l => new TelemetryLogRecord
                    {
                        Id = Guid.NewGuid(),
                        OrganisationId = caller.OrganisationId,
                        AppId = caller.AppId,
                        At = l.At,
                        SeverityNumber = l.SeverityNumber,
                        SeverityText = l.SeverityText is { Length: > 20 } t ? t[..20] : l.SeverityText,
                        Body = l.Body.Length > max ? l.Body[..max] : l.Body,
                        Category = l.Category is { Length: > 300 } c ? c[..300] : l.Category,
                        TraceId = l.TraceId is { Length: > 32 } tr ? tr[..32] : l.TraceId,
                        SpanId = l.SpanId is { Length: > 16 } sp ? sp[..16] : l.SpanId,
                        ReceivedAt = now,
                    }));
                    count = logs.Count;
                    break;
                default:
                    throw new EndgameProblem(404, "not_found", "Not found", "The OTLP signals are traces, metrics and logs.");
            }
        }
        catch (Exception ex) when (ex is FormatException or JsonException or InvalidOperationException or ArgumentOutOfRangeException)
        {
            throw EndgameProblem.Invalid($"The {signal} export could not be read: {ex.Message}");
        }

        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        return count;
    }

    private static byte[] Gunzip(byte[] body, int max)
    {
        try
        {
            using var input = new GZipStream(new MemoryStream(body), CompressionMode.Decompress);
            using var output = new MemoryStream();
            var buffer = new byte[81920];
            int read;
            while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
            {
                output.Write(buffer, 0, read);
                if (output.Length > max)
                {
                    throw new EndgameProblem(413, "too_large", "Too large", $"An export is at most {max} bytes once decompressed.");
                }
            }

            return output.ToArray();
        }
        catch (InvalidDataException)
        {
            throw EndgameProblem.Invalid("The body is not valid gzip.");
        }
    }

    /// <summary>
    /// A server span that is a visit: a page load, not an API call, an asset, a health poll, a
    /// platform callback or a webhook.
    /// </summary>
    private const string VisitSql = """
        (http_method = 'GET'
         AND COALESCE(url_path, http_route, '/') !~* '(^|/)(api|health|_platform|_endgame|hooks|openapi)(/|$)'
         AND COALESCE(url_path, '/') !~ '\.[A-Za-z0-9]{1,8}$')
        """;

    /// <summary>
    /// The measured summary of every app of an organisation that has sent anything yet. An app with
    /// no row has measured nothing: its numbers are unknown, never zero.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, AppTelemetrySummary>> SummariesAsync(Guid organisationId, Guid? appId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var today = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var recent = now.AddMinutes(-15);
        session.UseOrganisation(organisationId);
        await using var command = await db.CommandAsync($"""
            WITH seen AS (
                SELECT app_id, MAX(received_at) AS last_seen FROM (
                    SELECT app_id, received_at FROM telemetry_spans WHERE organisation_id = @org AND (@app IS NULL OR app_id = @app)
                    UNION ALL SELECT app_id, received_at FROM telemetry_events WHERE organisation_id = @org AND (@app IS NULL OR app_id = @app)
                    UNION ALL SELECT app_id, received_at FROM telemetry_metrics WHERE organisation_id = @org AND (@app IS NULL OR app_id = @app)
                    UNION ALL SELECT app_id, received_at FROM telemetry_logs WHERE organisation_id = @org AND (@app IS NULL OR app_id = @app)
                ) everything GROUP BY app_id
            ),
            server AS (
                SELECT app_id, start_at, duration_ms, (COALESCE(http_status, 0) >= 500 OR (http_status IS NULL AND status_code = 2)) AS failed, {VisitSql} AS visit
                FROM telemetry_spans
                WHERE organisation_id = @org AND (@app IS NULL OR app_id = @app) AND kind = 2 AND start_at >= LEAST(@today, @recent)
                  AND COALESCE(url_path, http_route, '/') !~* '(^|/)health(/|$)'
            )
            SELECT seen.app_id, seen.last_seen,
                   COUNT(*) FILTER (WHERE s.visit AND s.start_at >= @today),
                   COUNT(*) FILTER (WHERE s.start_at >= @today),
                   COUNT(*) FILTER (WHERE s.failed AND s.start_at >= @today),
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_ms) FILTER (WHERE s.start_at >= @today),
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY s.duration_ms) FILTER (WHERE s.start_at >= @today),
                   MAX(s.start_at) FILTER (WHERE s.visit),
                   COUNT(*) FILTER (WHERE s.start_at >= @recent),
                   COUNT(*) FILTER (WHERE s.failed AND s.start_at >= @recent)
            FROM seen LEFT JOIN server s ON s.app_id = seen.app_id
            GROUP BY seen.app_id, seen.last_seen
            """, cancellationToken, P("org", organisationId), P("app", appId), P("today", today), P("recent", recent));
        var result = new Dictionary<Guid, AppTelemetrySummary>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var recentRequests = reader.GetInt64(8);
            var recentErrors = reader.GetInt64(9);
            var health = recentRequests == 0 ? "healthy" : (double)recentErrors / recentRequests > DegradedErrorRate ? "degraded" : "healthy";
            result[reader.GetGuid(0)] = new AppTelemetrySummary(
                reader.GetInt64(2), reader.GetInt64(3), reader.GetInt64(4),
                reader.IsDBNull(5) ? null : Math.Round(reader.GetDouble(5), 1),
                reader.IsDBNull(6) ? null : Math.Round(reader.GetDouble(6), 1),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
                health, recentRequests, recentErrors, reader.GetFieldValue<DateTimeOffset>(1));
        }

        return result;
    }

    /// <summary>Deletes telemetry older than the retention period, across organisations. Part of the sweep; returns rows removed.</summary>
    public async Task<int> PruneAsync(CancellationToken cancellationToken)
    {
        session.UseSystem();
        var cutoff = clock.GetUtcNow().AddDays(-Math.Max(1, options.Value.RetentionDays));
        var removed = 0;
        foreach (var table in new[] { "telemetry_spans", "telemetry_events", "telemetry_metrics", "telemetry_logs" })
        {
            await using var command = await db.CommandAsync($"DELETE FROM {table} WHERE received_at < @cutoff", cancellationToken, P("cutoff", cutoff));
            removed += await command.ExecuteNonQueryAsync(cancellationToken);
        }

        session.Clear();
        return removed;
    }
}
