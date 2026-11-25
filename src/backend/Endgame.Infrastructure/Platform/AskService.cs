using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Endgame.Infrastructure.Platform;

public sealed record AskPoint(JsonNode? X, double? Y);

public sealed record AskSeries(string Name, IReadOnlyList<AskPoint> Points);

/// <param name="Kind"><c>line</c>, <c>bar</c>, <c>number</c> or <c>table</c>.</param>
/// <param name="X">The column on the horizontal axis; null for a number or a table.</param>
/// <param name="Y">The columns plotted, one series each.</param>
public sealed record AskChart(string Kind, string? X, IReadOnlyList<string> Y, IReadOnlyList<AskSeries> Series);

public sealed record AskCredits(decimal Estimate, decimal Charged);

/// <param name="Sql">The query that answered it. The console shows it in technical mode only.</param>
public sealed record AskAnswer(string Question, string Answer, AskChart Chart, string Sql, IReadOnlyList<string> Columns, IReadOnlyList<JsonObject> Rows, bool Truncated, AskCredits Credits);

public sealed record AskEstimate(decimal Credits, string Basis);

/// <param name="Error">Why the saved query could not be re-run now; null when it ran.</param>
public sealed record SavedQuestionView(Guid Id, string Question, string Answer, string Sql, AskChart? Chart, IReadOnlyList<string> Columns, IReadOnlyList<JsonObject> Rows, bool Truncated,
    DateTimeOffset AskedAt, DateTimeOffset RanAt, string? Error);

/// <summary>
/// "Ask about this app" (spec: natural-language dashboards). A model — through the gateway, charged
/// to the app — writes one read-only query over the app's telemetry views; the guard and the runner
/// fence it; a second call puts the rows into words. A query the guard refuses gets one repair,
/// not charged (CLAUDE.md rule 9). The most it can cost is shown first (rule 11).
/// </summary>
public sealed class AskService(
    EndgameDbContext db,
    TenantSession session,
    ModelGateway gateway,
    ModelGatewayOptions routes,
    CreditOptions credits,
    TelemetryQueryRunner runner,
    IOptions<AskOptions> options,
    TimeProvider clock)
{
    public const int MaxQuestion = 500;

    /// <summary>Writing the query, one repair, and the answer.</summary>
    public const int MaxCalls = 3;

    public const string Schema = """
        Four views, each holding this one app's telemetry only (UTC times):
        requests(at timestamptz, method text, route text, path text, status integer, duration_ms double precision, failed boolean)
          -- every server request the app answered, health checks excluded; latency is duration_ms
        errors(at timestamptz, source text ('request' or 'log'), status integer, route text, message text)
          -- failed requests (5xx or error status) and error logs
        events(at timestamptz, name text, user_id text, properties jsonb)
          -- custom events the app recorded, e.g. note.created; properties ->> 'key' reads a property
        metrics(at timestamptz, name text, unit text, type text, value double precision, count bigint, sum double precision)
          -- metric data points (gauge, sum or histogram)
        Rules: one SELECT (WITH is allowed), only these views, no comments, no semicolons.
        Functions: count, sum, avg, min, max, percentile_cont(…) within group (order by …), date_trunc, date_bin, extract, to_char,
        now, coalesce, nullif, greatest, least, round, floor, ceil, abs, lower, upper, length, row_number, rank, lag, lead.
        Times: now() - interval '7 days'. Cast with ::numeric, ::int, ::text, ::date.
        """;

    public AskEstimate Estimate(ResolvedScope app, string? question)
    {
        ArgumentNullException.ThrowIfNull(app);
        var q = Question(question);
        var route = Route();
        var perCall = ModelGateway.Prepare(routes, credits, new ChatRequest { TaskType = options.Value.TaskType, Messages = WriteMessages(q, null) }, route, stream: false).ReservedCredits;
        var total = Math.Ceiling(perCall * MaxCalls * 100m) / 100m;
        return new AskEstimate(total,
            $"Up to {MaxCalls.ToString(CultureInfo.InvariantCulture)} model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost. It is charged at what it actually costs.");
    }

    public async Task<AskAnswer> AskAsync(ResolvedScope app, string? question, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var q = Question(question);
        var estimate = Estimate(app, q).Credits;
        var charged = 0m;

        var written = await CallAsync(app, WriteMessages(q, null), repair: false, cancellationToken);
        charged += written.Charged;
        var plan = ParsePlan(written.Content);
        var verdict = TelemetrySqlGuard.Check(plan.Sql);
        QueryResult? result = null;
        string? failure = verdict.Allowed ? null : verdict.Reason;
        if (verdict.Allowed)
        {
            try
            {
                result = await runner.RunAsync(app.OrganisationId, app.AppId!.Value, verdict.Sql, cancellationToken);
            }
            catch (EndgameProblem p) when (p.Code is "query_failed" or "query_refused")
            {
                failure = p.Detail;
            }
        }

        if (result is null)
        {
            // The model's own mistake: one repair, recorded and never charged.
            var repaired = await CallAsync(app, WriteMessages(q, (plan.Sql, failure ?? "it could not run")), repair: true, cancellationToken);
            plan = ParsePlan(repaired.Content);
            verdict = TelemetrySqlGuard.Check(plan.Sql);
            if (!verdict.Allowed)
            {
                throw new EndgameProblem(422, "ask_unanswerable", "That question could not be turned into a safe query",
                    $"The query written for it was refused: {verdict.Reason} Try asking it another way.");
            }

            result = await runner.RunAsync(app.OrganisationId, app.AppId!.Value, verdict.Sql, cancellationToken);
        }

        var chart = Chart(plan.Chart, result);
        var sample = new JsonArray(result.Rows.Take(Math.Max(1, options.Value.RowsForAnswer)).Select(r => (JsonNode)r.DeepClone()).ToArray());
        var explained = await CallAsync(app,
        [
            new JsonObject
            {
                ["role"] = "system",
                ["content"] = "You explain an app's own telemetry to its owner in one to three plain sentences: no jargon, no SQL, no infrastructure words, exact numbers from the rows. Reply as JSON {\"answer\": \"...\"}.",
            },
            new JsonObject
            {
                ["role"] = "user",
                ["content"] = $"Question: {q}\nRows ({result.Rows.Count}{(result.Truncated ? "+, truncated" : "")}): {sample.ToJsonString()}",
            },
        ], repair: false, cancellationToken);
        charged += explained.Charged;
        var answer = Text(JsonObjectOf(explained.Content)?["answer"]) ?? explained.Content.Trim();
        if (answer.Length > 2000)
        {
            answer = answer[..2000];
        }

        return new AskAnswer(q, answer, chart, verdict.Sql, result.Columns, result.Rows, result.Truncated, new AskCredits(estimate, decimal.Round(charged, 6)));
    }

    // ------------------------------------------------------------------ the dashboard

    public async Task<IReadOnlyList<SavedQuestionView>> DashboardAsync(ResolvedScope app, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        session.UseOrganisation(app.OrganisationId);
        var saved = await db.SavedQuestions.AsNoTracking().Where(q => q.OrganisationId == app.OrganisationId && q.AppId == app.AppId)
            .OrderBy(q => q.CreatedAt).ToListAsync(cancellationToken);
        var views = new List<SavedQuestionView>();
        foreach (var q in saved)
        {
            var spec = JsonObjectOf(q.ChartJson);
            var verdict = TelemetrySqlGuard.Check(q.Sql);
            if (!verdict.Allowed)
            {
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, null, [], [], false, q.CreatedAt, clock.GetUtcNow(), verdict.Reason));
                continue;
            }

            try
            {
                var result = await runner.RunAsync(app.OrganisationId, app.AppId!.Value, verdict.Sql, cancellationToken);
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, Chart(spec, result), result.Columns, result.Rows, result.Truncated, q.CreatedAt, clock.GetUtcNow(), null));
            }
            catch (EndgameProblem p) when (p.Status == 422)
            {
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, null, [], [], false, q.CreatedAt, clock.GetUtcNow(), p.Detail ?? p.Title));
            }
        }

        return views;
    }

    public async Task<SavedQuestionView> SaveAsync(ResolvedScope app, string? question, string? sql, JsonObject? chart, string? answer, Guid by, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var q = Question(question);
        var verdict = TelemetrySqlGuard.Check(sql);
        if (!verdict.Allowed)
        {
            throw new EndgameProblem(400, "query_refused", "That query cannot be saved", verdict.Reason);
        }

        session.UseOrganisation(app.OrganisationId);
        if (await db.SavedQuestions.CountAsync(x => x.OrganisationId == app.OrganisationId && x.AppId == app.AppId, cancellationToken) >= options.Value.MaxSavedQuestions)
        {
            throw EndgameProblem.Conflict($"A dashboard holds at most {options.Value.MaxSavedQuestions} questions; remove one first.");
        }

        var spec = new JsonObject
        {
            ["kind"] = Text(chart?["kind"]) is { } k && ChartKinds.Contains(k) ? k : "table",
            ["x"] = Text(chart?["x"]),
            ["y"] = new JsonArray((chart?["y"] as JsonArray ?? []).Select(Text).Where(t => t is not null).Select(t => (JsonNode)JsonValue.Create(t)!).ToArray()),
        };
        var record = new SavedQuestionRecord
        {
            Id = Guid.NewGuid(),
            OrganisationId = app.OrganisationId,
            AppId = app.AppId!.Value,
            Question = q,
            Sql = verdict.Sql,
            ChartJson = spec.ToJsonString(),
            Answer = Clip((answer ?? "").Trim(), 2000),
            CreatedBy = by,
            CreatedAt = clock.GetUtcNow(),
        };
        db.SavedQuestions.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        var result = await runner.RunAsync(app.OrganisationId, record.AppId, record.Sql, cancellationToken);
        return new SavedQuestionView(record.Id, record.Question, record.Answer, record.Sql, Chart(spec, result), result.Columns, result.Rows, result.Truncated, record.CreatedAt, clock.GetUtcNow(), null);
    }

    public async Task<bool> RemoveAsync(ResolvedScope app, Guid id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        session.UseOrganisation(app.OrganisationId);
        return await db.SavedQuestions.Where(q => q.OrganisationId == app.OrganisationId && q.AppId == app.AppId && q.Id == id).ExecuteDeleteAsync(cancellationToken) > 0;
    }

    // ------------------------------------------------------------------ the parts

    private static readonly IReadOnlySet<string> ChartKinds = new HashSet<string>(StringComparer.Ordinal) { "line", "bar", "number", "table" };

    private sealed record Plan(string? Sql, JsonObject? Chart);

    private sealed record Called(string Content, decimal Charged);

    private ModelRoute Route() =>
        routes.Routes.TryGetValue(options.Value.TaskType, out var route)
            ? route
            : throw new EndgameProblem(503, "ask_unavailable", "Questions about apps cannot be answered yet",
                $"There is no '{options.Value.TaskType}' route in the model routing table.");

    private static string Question(string? question)
    {
        var q = question?.Trim() ?? "";
        return q.Length is >= 3 and <= MaxQuestion ? q : throw EndgameProblem.Invalid($"Ask a question of 3 to {MaxQuestion} characters.");
    }

    private static JsonArray WriteMessages(string question, (string? Sql, string Why)? previous)
    {
        var messages = new JsonArray
        {
            new JsonObject
            {
                ["role"] = "system",
                ["content"] = "You write one PostgreSQL query that answers an owner's question about their app.\n" + Schema +
                              "\nReply as JSON only: {\"sql\": \"...\", \"chart\": {\"kind\": \"line|bar|number|table\", \"x\": \"<column or null>\", \"y\": [\"<column>\", ...]}}. " +
                              "Use line for a value over time (x is the time bucket), bar for categories, number for a single value.",
            },
            new JsonObject { ["role"] = "user", ["content"] = question },
        };
        if (previous is { } p)
        {
            messages.Add(new JsonObject { ["role"] = "assistant", ["content"] = new JsonObject { ["sql"] = p.Sql }.ToJsonString() });
            messages.Add(new JsonObject { ["role"] = "user", ["content"] = $"That query was refused: {p.Why} Write it again within the rules." });
        }

        return messages;
    }

    private async Task<Called> CallAsync(ResolvedScope app, JsonArray messages, bool repair, CancellationToken cancellationToken)
    {
        _ = Route();
        var result = await gateway.CompleteAsync(new ChatRequest
        {
            TaskType = options.Value.TaskType,
            Scope = app.Path.ToString(),
            Messages = messages,
            ResponseFormat = new JsonObject { ["type"] = "json_object" },
            Temperature = 0,
            Repair = repair,
        }, cancellationToken);
        var content = JsonObjectOf(result.Body)?["choices"]?[0]?["message"]?["content"] is JsonValue c && c.GetValueKind() == JsonValueKind.String ? c.GetValue<string>() : "";
        return new Called(content, result.Settlement.Billable ? result.Settlement.SettledCredits : 0m);
    }

    private static Plan ParsePlan(string content)
    {
        var parsed = JsonObjectOf(content);
        return new Plan(Text(parsed?["sql"]), parsed?["chart"] as JsonObject);
    }

    /// <summary>The chart the model asked for, checked against the columns the query returned; a table when it does not fit.</summary>
    public static AskChart Chart(JsonObject? spec, QueryResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var kind = Text(spec?["kind"]) is { } k && ChartKinds.Contains(k) ? k : "table";
        var x = Text(spec?["x"]);
        var y = (spec?["y"] as JsonArray ?? []).Select(Text).Where(c => c is not null && result.Columns.Contains(c)).Select(c => c!).Distinct().ToList();
        if (kind == "number")
        {
            var column = y.FirstOrDefault() ?? result.Columns.FirstOrDefault(c => result.Rows.Count > 0 && Number(result.Rows[0][c]) is not null);
            return column is null || result.Rows.Count == 0
                ? new AskChart("table", null, [], [])
                : new AskChart("number", null, [column], [new AskSeries(column, [new AskPoint(null, Number(result.Rows[0][column]))])]);
        }

        if (kind is "line" or "bar" && x is not null && result.Columns.Contains(x))
        {
            if (y.Count == 0)
            {
                y = result.Columns.Where(c => c != x && result.Rows.Any(r => Number(r[c]) is not null)).ToList();
            }

            y.Remove(x);
            if (y.Count > 0)
            {
                return new AskChart(kind, x, y, y.Select(c => new AskSeries(c, result.Rows.Select(r => new AskPoint(r[x]?.DeepClone(), Number(r[c]))).ToList())).ToList());
            }
        }

        return new AskChart("table", null, [], []);
    }

    private static string Clip(string text, int max) => text.Length > max ? text[..max] : text;

    private static double? Number(JsonNode? node) =>
        node is JsonValue v && v.GetValueKind() == JsonValueKind.Number && double.TryParse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;

    private static string? Text(JsonNode? node) => node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    private static JsonObject? JsonObjectOf(string text)
    {
        var trimmed = text.Trim();
        // A model sometimes fences its JSON; take the object inside.
        var start = trimmed.IndexOf('{', StringComparison.Ordinal);
        var end = trimmed.LastIndexOf('}');
        if (start < 0 || end <= start)
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(trimmed[start..(end + 1)]) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
