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

/// <summary>What went wrong underneath, for technical mode only: the last query tried and what refused it (the guard's reason or the database's message).</summary>
public sealed record AskTechnical(string? Sql, string Error);

/// <param name="Error">Why the saved question could not be worked out now, in plain words; null when it ran.</param>
/// <param name="Technical">The query and the guard's or database's message behind <paramref name="Error"/>; technical mode only.</param>
public sealed record SavedQuestionView(Guid Id, string Question, string Answer, string Sql, AskChart? Chart, IReadOnlyList<string> Columns, IReadOnlyList<JsonObject> Rows, bool Truncated,
    DateTimeOffset AskedAt, DateTimeOffset RanAt, string? Error, AskTechnical? Technical);

/// <summary>
/// "Ask about this app" (spec: natural-language dashboards). A model — through the gateway, charged
/// to the app — writes one read-only query over the app's telemetry views, told their exact columns
/// by <see cref="AskViewCatalog"/>; the guard and the runner fence it; a second call puts the rows
/// into words. A query the guard refuses or the database cannot run goes back to the model once, with
/// the reason, and that repair is not charged (CLAUDE.md rule 9). A question that still cannot be
/// answered, or that the model declines, is <c>422 ask_unanswerable</c> in plain words, the query and
/// the database's message apart under <c>technical</c>. The most it can cost is shown first (rule 11).
/// </summary>
public sealed class AskService(
    EndgameDbContext db,
    TenantSession session,
    ModelGateway gateway,
    ModelGatewayOptions routes,
    CreditOptions credits,
    TelemetryQueryRunner runner,
    AskViewCatalog catalog,
    IOptions<AskOptions> options,
    TimeProvider clock)
{
    public const int MaxQuestion = 500;

    /// <summary>Writing the query, one repair, and the answer.</summary>
    public const int MaxCalls = 3;

    /// <summary>The query-writing system prompt: the views from the catalog, then the reply format.</summary>
    public async Task<string> WritingPromptAsync(CancellationToken cancellationToken) =>
        "You write one PostgreSQL query that answers an owner's question about their app.\n" + AskViewCatalog.Prompt(await catalog.ViewsAsync(cancellationToken)) +
        "Reply as JSON only: {\"sql\": \"...\", \"chart\": {\"kind\": \"line|bar|number|table\", \"x\": \"<column or null>\", \"y\": [\"<column>\", ...]}}. " +
        "Use line for a value over time (x is the time bucket), bar for categories, number for a single value.\n" +
        "If these views cannot answer the question because the app does not record it, do not guess: reply {\"sql\": null, \"unanswerable\": \"<one plain sentence for the owner saying what the app does not record, with no SQL and no view or column names>\"}.";

    public async Task<AskEstimate> EstimateAsync(ResolvedScope app, string? question, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var q = Question(question);
        return Estimate(q, await WritingPromptAsync(cancellationToken));
    }

    private AskEstimate Estimate(string question, string prompt)
    {
        var route = Route();
        var perCall = ModelGateway.Prepare(routes, credits, new ChatRequest { TaskType = options.Value.TaskType, Messages = WriteMessages(prompt, question, null) }, route, stream: false).ReservedCredits;
        var total = Math.Ceiling(perCall * MaxCalls * 100m) / 100m;
        return new AskEstimate(total,
            $"Up to {MaxCalls.ToString(CultureInfo.InvariantCulture)} model calls (writing the query, one repair that is never charged, and the answer), each priced at the most it could cost. It is charged at what it actually costs.");
    }

    public async Task<AskAnswer> AskAsync(ResolvedScope app, string? question, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        var q = Question(question);
        var prompt = await WritingPromptAsync(cancellationToken);
        var estimate = Estimate(q, prompt).Credits;
        var charged = 0m;

        var written = await CallAsync(app, WriteMessages(prompt, q, null), repair: false, cancellationToken);
        charged += written.Charged;
        var plan = ParsePlan(written.Content);
        if (plan.Unanswerable is { } declined)
        {
            throw Declined(declined, null);
        }

        var attempt = await TryAsync(app, plan, cancellationToken);
        if (attempt.Failure is { } failure)
        {
            // The model's own mistake: it is shown what refused it, once, and the repair is never charged.
            var repaired = await CallAsync(app, WriteMessages(prompt, q, failure), repair: true, cancellationToken);
            plan = ParsePlan(repaired.Content);
            if (plan.Unanswerable is { } gaveUp)
            {
                throw Declined(gaveUp, failure);
            }

            attempt = await TryAsync(app, plan, cancellationToken);
            if (attempt.Failure is { } again)
            {
                throw Unanswerable(again);
            }
        }

        var result = attempt.Result!;
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

        return new AskAnswer(q, answer, chart, attempt.Sql!, result.Columns, result.Rows, result.Truncated, new AskCredits(estimate, decimal.Round(charged, 6)));
    }

    /// <summary>Why a query did not run: refused by the guard before it ran, or by the database when it did.</summary>
    private sealed record Failure(string? Sql, string Error, bool ByDatabase);

    private sealed record Attempt(string? Sql, QueryResult? Result, Failure? Failure);

    /// <summary>Guards and runs one plan. A refusal or a database error is returned for the repair; a timeout ends the question.</summary>
    private async Task<Attempt> TryAsync(ResolvedScope app, Plan plan, CancellationToken cancellationToken)
    {
        var verdict = TelemetrySqlGuard.Check(plan.Sql);
        if (!verdict.Allowed)
        {
            return new Attempt(null, null, new Failure(plan.Sql, verdict.Reason ?? "It is not one plain read of the views.", ByDatabase: false));
        }

        try
        {
            return new Attempt(verdict.Sql, await runner.RunAsync(app.OrganisationId, app.AppId!.Value, verdict.Sql, cancellationToken), null);
        }
        catch (EndgameProblem p) when (p.Code is "query_failed" or "query_refused")
        {
            return new Attempt(verdict.Sql, null, new Failure(verdict.Sql, p.Detail ?? p.Title, ByDatabase: true));
        }
        catch (EndgameProblem p) when (p.Code == "query_timeout")
        {
            var timeout = new EndgameProblem(422, "query_timeout", "That question took too long to answer", "Try a narrower one, such as a shorter period or one thing at a time.");
            timeout.Extensions["technical"] = Technical(new Failure(verdict.Sql, p.Detail ?? p.Title, ByDatabase: true));
            throw timeout;
        }
    }

    private static JsonObject Technical(Failure failure) => new() { ["sql"] = failure.Sql, ["error"] = failure.Error };

    /// <summary>The repair did not help: plain words for the owner, what failed underneath apart.</summary>
    private static EndgameProblem Unanswerable(Failure failure)
    {
        var problem = new EndgameProblem(422, "ask_unanswerable", "That question could not be answered",
            "It could not be worked out from what this app records. Try asking it another way, or about its visits, requests, errors, events or measurements.");
        problem.Extensions["technical"] = Technical(failure);
        return problem;
    }

    /// <summary>The model said the app does not record what the question needs; its plain reason is the detail.</summary>
    private static EndgameProblem Declined(string reason, Failure? before)
    {
        var detail = Clip(reason.Trim(), 500);
        var problem = new EndgameProblem(422, "ask_unanswerable", "That question cannot be answered from what this app records",
            detail.Length > 0 ? detail : "The app does not record what this question needs.");
        if (before is not null)
        {
            problem.Extensions["technical"] = Technical(before);
        }

        return problem;
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
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, null, [], [], false, q.CreatedAt, clock.GetUtcNow(), NoLongerRuns,
                    new AskTechnical(q.Sql, verdict.Reason ?? "It is not one plain read of the views.")));
                continue;
            }

            try
            {
                var result = await runner.RunAsync(app.OrganisationId, app.AppId!.Value, verdict.Sql, cancellationToken);
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, Chart(spec, result), result.Columns, result.Rows, result.Truncated, q.CreatedAt, clock.GetUtcNow(), null, null));
            }
            catch (EndgameProblem p) when (p.Status == 422)
            {
                var plain = p.Code == "query_timeout" ? "It took too long to work out this time. It is tried again each time this page opens." : NoLongerRuns;
                views.Add(new SavedQuestionView(q.Id, q.Question, q.Answer, q.Sql, null, [], [], false, q.CreatedAt, clock.GetUtcNow(), plain, new AskTechnical(verdict.Sql, p.Detail ?? p.Title)));
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
        return new SavedQuestionView(record.Id, record.Question, record.Answer, record.Sql, Chart(spec, result), result.Columns, result.Rows, result.Truncated, record.CreatedAt, clock.GetUtcNow(), null, null);
    }

    public async Task<bool> RemoveAsync(ResolvedScope app, Guid id, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        session.UseOrganisation(app.OrganisationId);
        return await db.SavedQuestions.Where(q => q.OrganisationId == app.OrganisationId && q.AppId == app.AppId && q.Id == id).ExecuteDeleteAsync(cancellationToken) > 0;
    }

    // ------------------------------------------------------------------ the parts

    private static readonly IReadOnlySet<string> ChartKinds = new HashSet<string>(StringComparer.Ordinal) { "line", "bar", "number", "table" };

    private const string NoLongerRuns = "It can no longer be worked out from what the app records. Ask it again, and keep the new answer.";

    /// <param name="Unanswerable">The model's plain reason when it declined: the app does not record what the question needs.</param>
    private sealed record Plan(string? Sql, JsonObject? Chart, string? Unanswerable);

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

    private static JsonArray WriteMessages(string prompt, string question, Failure? previous)
    {
        var messages = new JsonArray
        {
            new JsonObject { ["role"] = "system", ["content"] = prompt },
            new JsonObject { ["role"] = "user", ["content"] = question },
        };
        if (previous is { } p)
        {
            var why = p.ByDatabase ? $"That query could not run. The database said: {p.Error}" : $"That query was refused before it ran: {p.Error}";
            messages.Add(new JsonObject { ["role"] = "assistant", ["content"] = new JsonObject { ["sql"] = p.Sql }.ToJsonString() });
            messages.Add(new JsonObject
            {
                ["role"] = "user",
                ["content"] = why + "\nWrite it again within the rules, using only the views and columns listed (there is no id column; count rows with count(*)). " +
                              "If these views cannot answer the question, reply {\"sql\": null, \"unanswerable\": \"<one plain sentence>\"}.",
            });
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
        var sql = Text(parsed?["sql"]);
        var declined = Text(parsed?["unanswerable"]);
        return new Plan(sql, parsed?["chart"] as JsonObject, string.IsNullOrWhiteSpace(sql) && !string.IsNullOrWhiteSpace(declined) ? declined : null);
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
