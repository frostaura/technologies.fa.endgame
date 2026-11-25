using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Infrastructure.Platform;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The parser-level fence for "ask about this app": a table of hostile and mistaken queries, each
/// refused, and the ordinary questions a dashboard asks, each allowed (TEST-102, <i>Ask</i>).
/// </summary>
public sealed class TelemetrySqlGuardTests
{
    public static TheoryData<string, string> Hostile => new()
    {
        { "DELETE FROM requests", "a write" },
        { "UPDATE requests SET status = 1", "a write" },
        { "INSERT INTO events (name) VALUES ('x')", "a write" },
        { "DROP VIEW requests", "a schema change" },
        { "SELECT 1 FROM requests; DROP TABLE credit_entries", "a second statement" },
        { "SELECT * FROM users", "another table" },
        { "SELECT * FROM public.telemetry_spans", "the table under a view" },
        { "SELECT * FROM telemetry_spans", "the table under a view, unqualified" },
        { "SELECT * FROM credit_entries", "the ledger" },
        { "SELECT * FROM requests, users", "a second relation in a FROM list" },
        { "SELECT * FROM requests r JOIN cascade_entries c ON true", "a join to the vault" },
        { "SELECT * FROM requests r JOIN (SELECT * FROM memberships) m ON true", "a subquery over another table" },
        { "WITH x AS (SELECT * FROM users) SELECT * FROM x", "a CTE over another table" },
        { "WITH a AS (SELECT * FROM users), users AS (SELECT * FROM requests) SELECT * FROM a", "a CTE body naming a later CTE" },
        { "SELECT count(*) FROM requests UNION SELECT count(*) FROM pg_user", "a catalog through UNION" },
        { "SELECT * FROM pg_catalog.pg_authid", "the catalog" },
        { "SELECT * FROM information_schema.tables", "the information schema" },
        { "SELECT pg_sleep(30)", "a function not on the list" },
        { "SELECT count(*) FROM requests WHERE pg_sleep(30) IS NULL", "a sleeping predicate" },
        { "SELECT set_config('endgame.ask_app_id', '00000000-0000-0000-0000-000000000000', false) FROM requests", "re-pointing the app" },
        { "SELECT current_setting('endgame.organisation_id') FROM requests", "reading the session" },
        { "SELECT version() FROM requests", "a function not on the list" },
        { "SELECT query_to_xml('select * from users', true, true, '') FROM requests", "running text as a query" },
        { "SELECT lo_import('/etc/passwd') FROM requests", "reading a file" },
        { "SELECT * FROM requests FOR UPDATE", "a lock" },
        { "SELECT * INTO stolen FROM requests", "SELECT INTO" },
        { "COPY (SELECT * FROM requests) TO '/tmp/x'", "COPY" },
        { "SELECT * FROM requests -- WHERE 1 = 0", "a comment" },
        { "SELECT * FROM requests /* hidden */", "a block comment" },
        { "SELECT \"route\" FROM requests", "a quoted identifier" },
        { "SELECT $$x$$ FROM requests", "dollar quoting" },
        { "SELECT E'\\x41' FROM requests", "an escaped string" },
        { "SELECT current_user FROM requests", "who is asking" },
        { "SET ROLE endgame_system", "a session change" },
        { "SELECT * FROM ONLY requests", "ONLY" },
        { "SELECT * FROM LATERAL (SELECT 1) x", "LATERAL" },
        { "SELECT * FROM requests TABLESAMPLE SYSTEM (50)", "TABLESAMPLE" },
        { "TABLE requests", "TABLE syntax" },
        { "VALUES (1)", "VALUES" },
        { "SELECT 1", "no view at all" },
        { "SELECT * FROM generate_series(1, 1000000000)", "a set-returning function" },
        { "SELECT * FROM ask.requests r, ask.users u", "an unknown view in the ask schema" },
        { "SELECT * FROM requests WHERE route = 'unclosed", "an unclosed string" },
        { "SELECT ((1) FROM requests", "unbalanced parentheses" },
        { "", "nothing" },
        { "select cast(at as regclass) from requests", "a cast to an unknown type" },
        { "SELECT at::regclass FROM requests", "a cast to an unknown type" },
    };

    [Theory]
    [MemberData(nameof(Hostile))]
    public void A_hostile_or_mistaken_query_is_refused(string sql, string what)
    {
        var verdict = TelemetrySqlGuard.Check(sql);
        Assert.False(verdict.Allowed, $"Allowed {what}: {sql}");
        Assert.False(string.IsNullOrWhiteSpace(verdict.Reason));
    }

    public static TheoryData<string> Ordinary => new()
    {
        "SELECT count(*) AS requests FROM requests WHERE at >= now() - interval '1 day'",
        "SELECT date_trunc('hour', at) AS hour, count(*) AS requests, count(*) FILTER (WHERE failed) AS errors FROM requests GROUP BY 1 ORDER BY 1",
        "SELECT route, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95 FROM requests GROUP BY route ORDER BY p95 DESC LIMIT 10",
        "SELECT name, count(*) AS n FROM events WHERE at > now() - interval '7 days' GROUP BY name",
        "SELECT properties ->> 'plan' AS plan, count(*) FROM events WHERE name = 'signup.completed' GROUP BY 1",
        "WITH daily AS (SELECT at::date AS day, count(*) AS n FROM requests GROUP BY 1) SELECT day, n, lag(n) OVER (ORDER BY day) AS before FROM daily",
        "SELECT extract(hour FROM at) AS hour, avg(duration_ms) FROM requests GROUP BY 1;",
        "SELECT r.route, count(e.message) FROM ask.requests r LEFT JOIN ask.errors e ON e.route = r.route GROUP BY r.route",
        "select source, count(*) from errors where at between now() - interval '2 days' and now() group by source",
        "SELECT round(avg(value)::numeric, 2) FROM metrics WHERE name = 'queue.depth'",
    };

    [Theory]
    [MemberData(nameof(Ordinary))]
    public void An_ordinary_dashboard_question_is_allowed(string sql)
    {
        var verdict = TelemetrySqlGuard.Check(sql);
        Assert.True(verdict.Allowed, verdict.Reason);
        Assert.False(verdict.Sql.EndsWith(';'));
    }
}

/// <summary>
/// "Ask about this app" against a real database: the role, row-level security pinned to one app,
/// the timeout and the row limit hold even for a query the guard never saw; the endpoint writes,
/// fences, runs and explains a query through the gateway, charges the app, never charges the repair,
/// and the dashboard re-runs what was saved.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AskTests(PostgresServer postgres) : IAsyncLifetime
{
    private FakeOpenRouter openRouter = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private Guid org;
    private Guid bookings;
    private Guid other;
    private Guid foreignApp;
    private Guid foreignOrg;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter, settings: new Dictionary<string, string?> { ["Ask:StatementTimeoutMs"] = "400", ["Ask:MaxRows"] = "20" });
        owner = await app.OwnerWithOrganisationAsync();
        org = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync("/api/me")))["organisation"]!["id"]!.GetValue<string>());
        await owner.DivisionAsync("frostaura", "products");
        await owner.ProjectAsync("frostaura/products", "squash");
        bookings = await owner.AppAsync("frostaura/products/squash", "bookings");
        other = await owner.AppAsync("frostaura/products/squash", "ladder");
        await owner.TopUpAsync("frostaura", 100m);
        var acme = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "owner@frostaura.net" }));
        foreignOrg = Guid.Parse(acme["id"]!.GetValue<string>());
        await owner.DivisionAsync("acme", "web");
        await owner.ProjectAsync("acme/web", "shop");
        foreignApp = await owner.AppAsync("acme/web/shop", "store");

        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await SpansAsync(connection, org, bookings, 10, failed: 2);
        await SpansAsync(connection, org, other, 7, failed: 0);
        await SpansAsync(connection, foreignOrg, foreignApp, 5, failed: 5);
        for (var i = 0; i < 3; i++)
        {
            await using var e = new NpgsqlCommand("INSERT INTO telemetry_events (id, organisation_id, app_id, name, at, user_id, properties, received_at) VALUES (gen_random_uuid(), @org, @app, 'booking.made', now(), 'usr_1', '{\"court\": 2}', now())", connection);
            e.Parameters.AddWithValue("org", org);
            e.Parameters.AddWithValue("app", bookings);
            await e.ExecuteNonQueryAsync();
        }
    }

    private static async Task SpansAsync(NpgsqlConnection connection, Guid organisation, Guid appId, int count, int failed)
    {
        for (var i = 0; i < count; i++)
        {
            await using var command = new NpgsqlCommand("""
                INSERT INTO telemetry_spans (id, organisation_id, app_id, trace_id, span_id, name, kind, start_at, duration_ms, status_code, http_method, http_route, url_path, http_status, received_at)
                VALUES (gen_random_uuid(), @org, @app, @trace, @span, 'GET /api/bookings', 2, now() - (@i * interval '1 minute'), @ms, 0, 'GET', '/api/bookings', '/api/bookings', @status, now())
                """, connection);
            command.Parameters.AddWithValue("org", organisation);
            command.Parameters.AddWithValue("app", appId);
            command.Parameters.AddWithValue("trace", Guid.NewGuid().ToString("N"));
            command.Parameters.AddWithValue("span", Guid.NewGuid().ToString("N")[..16]);
            command.Parameters.AddWithValue("i", i);
            command.Parameters.AddWithValue("ms", 10.0 + i);
            command.Parameters.AddWithValue("status", i < failed ? 500 : 200);
            await command.ExecuteNonQueryAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private async Task<QueryResult> RunUnguardedAsync(Guid organisation, Guid appId, string sql)
    {
        await using var scope = app.Scope();
        return await scope.ServiceProvider.GetRequiredService<TelemetryQueryRunner>().RunAsync(organisation, appId, sql, CancellationToken.None);
    }

    private static long Count(QueryResult result) => result.Rows[0]["n"]!.GetValue<long>();

    [Fact]
    public async Task Without_the_guard_the_role_and_row_level_security_still_confine_a_query_to_one_app()
    {
        Assert.Equal(10, Count(await RunUnguardedAsync(org, bookings, "SELECT count(*) AS n FROM requests")));
        Assert.Equal(7, Count(await RunUnguardedAsync(org, other, "SELECT count(*) AS n FROM requests")));
        Assert.Equal(2, Count(await RunUnguardedAsync(org, bookings, "SELECT count(*) AS n FROM errors")));
        Assert.Equal(3, Count(await RunUnguardedAsync(org, bookings, "SELECT count(*) AS n FROM events")));

        // The tables under the views: still only this app's rows, whatever the WHERE says.
        Assert.Equal(10, Count(await RunUnguardedAsync(org, bookings, "SELECT count(*) AS n FROM public.telemetry_spans")));
        Assert.Equal(10, Count(await RunUnguardedAsync(org, bookings, $"SELECT count(*) AS n FROM public.telemetry_spans WHERE app_id = '{other}' OR true")));
        Assert.Equal(0, Count(await RunUnguardedAsync(org, bookings, $"SELECT count(*) AS n FROM public.telemetry_spans WHERE organisation_id = '{foreignOrg}'")));
        // Another organisation's app named with this organisation pinned: nothing.
        Assert.Equal(0, Count(await RunUnguardedAsync(org, foreignApp, "SELECT count(*) AS n FROM requests")));

        // Anything else is refused by privilege.
        foreach (var table in new[] { "public.users", "public.credit_entries", "public.cascade_entries", "public.memberships", "public.access_tokens", "public.organisations" })
        {
            var refused = await Assert.ThrowsAsync<EndgameProblem>(() => RunUnguardedAsync(org, bookings, $"SELECT count(*) AS n FROM {table}"));
            Assert.Equal("query_refused", refused.Code);
        }

        // The pins cannot be moved from inside the query.
        var repoint = await Assert.ThrowsAsync<EndgameProblem>(() => RunUnguardedAsync(org, bookings, $"SELECT set_config('endgame.ask_app_id', '{other}', true) AS n"));
        Assert.Equal("query_refused", repoint.Code);

        // Read-only, time-limited, row-limited.
        var write = await Assert.ThrowsAsync<EndgameProblem>(() => RunUnguardedAsync(org, bookings, "SELECT lo_create(0) AS n"));
        Assert.Equal(422, write.Status);
        var slow = await Assert.ThrowsAsync<EndgameProblem>(() => RunUnguardedAsync(org, bookings, "SELECT pg_sleep(5) AS n"));
        Assert.Equal("query_timeout", slow.Code);
        var many = await RunUnguardedAsync(org, bookings, "SELECT 1 AS x FROM requests a, requests b");
        Assert.Equal(20, many.Rows.Count);
        Assert.True(many.Truncated);
    }

    private static Func<JsonObject, HttpContext, Task> Answers(params string[] contents)
    {
        var queue = new Queue<string>(contents);
        return (request, http) => FakeOpenRouter.Completion(0.0002m, queue.Count > 1 ? queue.Dequeue() : queue.Peek())(request, http);
    }

    [Fact]
    public async Task A_question_becomes_one_fenced_query_an_answer_and_a_chart_charged_to_the_app()
    {
        var estimate = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask/estimate", new { question = "How many requests failed today?" }));
        Assert.True(estimate["credits"]!.GetValue<decimal>() > 0);

        openRouter.Chat = Answers(
            """{"sql": "SELECT date_trunc('hour', at) AS hour, count(*) AS requests, count(*) FILTER (WHERE failed) AS errors FROM requests GROUP BY 1 ORDER BY 1", "chart": {"kind": "line", "x": "hour", "y": ["requests", "errors"]}}""",
            """{"answer": "There were 10 requests and 2 of them failed."}""");
        var answer = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many requests failed today?" }));
        Assert.Equal("There were 10 requests and 2 of them failed.", answer["answer"]!.GetValue<string>());
        Assert.Equal("line", answer["chart"]!["kind"]!.GetValue<string>());
        Assert.Equal(["requests", "errors"], answer["chart"]!["series"]!.AsArray().Select(s => s!["name"]!.GetValue<string>()));
        Assert.StartsWith("SELECT date_trunc", answer["sql"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal(10, answer["rows"]!.AsArray().Sum(r => r!["requests"]!.GetValue<long>()));
        Assert.True(answer["credits"]!["charged"]!.GetValue<decimal>() > 0);
        Assert.True(answer["credits"]!["charged"]!.GetValue<decimal>() <= answer["credits"]!["estimate"]!.GetValue<decimal>());

        // The calls went through the gateway on the ask route, charged to the app.
        var credits = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura/products/squash/bookings"));
        Assert.True(credits["month"]!["ai"]!.GetValue<decimal>() > 0);
    }

    [Fact]
    public async Task A_refused_query_gets_one_repair_that_is_not_charged_and_a_second_refusal_ends_it()
    {
        openRouter.Chat = Answers(
            """{"sql": "SELECT * FROM users", "chart": {"kind": "table"}}""",
            """{"sql": "SELECT count(*) AS n FROM requests", "chart": {"kind": "number", "y": ["n"]}}""",
            """{"answer": "Ten."}""");
        var answer = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many requests?" }));
        Assert.Equal("number", answer["chart"]!["kind"]!.GetValue<string>());
        Assert.Equal(10d, answer["chart"]!["series"]![0]!["points"]![0]!["y"]!.GetValue<double>());
        var notCharged = await ControlPlaneApp.Ok(owner.GetAsync("/api/credits?scope=frostaura/products/squash/bookings"));
        Assert.True(notCharged["notCharged"]!["repairs"]!.GetValue<long>() >= 1);

        openRouter.Chat = Answers("""{"sql": "SELECT * FROM credit_entries"}""", """{"sql": "DELETE FROM requests"}""");
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "Show me the ledger" }), (HttpStatusCode)422);
        Assert.Equal("ask_unanswerable", refused["code"]!.GetValue<string>());
    }

    /// <summary>The views' columns and types as the database itself reports them, read here as the superuser, independently of the code under test.</summary>
    private async Task<Dictionary<string, List<(string Name, string Type)>>> ColumnsInDatabaseAsync()
    {
        var views = new Dictionary<string, List<(string, string)>>(StringComparer.Ordinal);
        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            SELECT c.table_name, c.column_name, c.data_type
            FROM information_schema.columns c JOIN information_schema.views v ON v.table_schema = c.table_schema AND v.table_name = c.table_name
            WHERE c.table_schema = 'ask' ORDER BY c.table_name, c.ordinal_position
            """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var view = reader.GetString(0);
            if (!views.TryGetValue(view, out var columns))
            {
                views[view] = columns = [];
            }

            columns.Add((reader.GetString(1), reader.GetString(2)));
        }

        return views;
    }

    private static string SystemPrompt(JsonObject request) => request["messages"]![0]!["content"]!.GetValue<string>();

    private JsonObject[] Calls() => openRouter.Requests.ToArray();

    /// <summary>This app's ask settlements in the ledger: how many were charged, how many recorded and not charged.</summary>
    private async Task<(long Charged, long NotCharged)> AskSettlementsAsync(Guid appId)
    {
        await using var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT count(*) FILTER (WHERE billable), count(*) FILTER (WHERE NOT billable) FROM credit_entries WHERE app_id = @app AND kind = 'settlement' AND task_type = 'ask'", connection);
        command.Parameters.AddWithValue("app", appId);
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (reader.GetInt64(0), reader.GetInt64(1));
    }

    [Fact]
    public async Task The_prompt_lists_every_view_and_column_the_database_has_and_no_other()
    {
        var inDatabase = await ColumnsInDatabaseAsync();
        Assert.Equal(TelemetrySqlGuard.Views.Order(StringComparer.Ordinal), inDatabase.Keys.Order(StringComparer.Ordinal));
        Assert.DoesNotContain(inDatabase["requests"], c => c.Name == "id");

        await using var scope = app.Scope();
        var catalog = await scope.ServiceProvider.GetRequiredService<AskViewCatalog>().ViewsAsync(CancellationToken.None);
        Assert.Equal(inDatabase.Keys.Order(StringComparer.Ordinal), catalog.Select(v => v.Name).Order(StringComparer.Ordinal));
        foreach (var view in catalog)
        {
            Assert.Equal(inDatabase[view.Name].Select(c => (c.Name, c.Type)), view.Columns.Select(c => (c.Name, c.Type)));
        }

        var prompt = AskViewCatalog.Prompt(catalog);
        foreach (var (view, columns) in inDatabase)
        {
            Assert.Contains($"{view}({string.Join(", ", columns.Select(c => $"{c.Name} {c.Type}"))})", prompt, StringComparison.Ordinal);
        }

        Assert.Contains("There is no id column", prompt, StringComparison.Ordinal);
        Assert.Contains("count(*)", prompt, StringComparison.Ordinal);
        Assert.Contains("visit", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("requests(id", prompt, StringComparison.Ordinal);

        // What the model is sent is that prompt.
        openRouter.Chat = Answers("""{"sql": "SELECT count(*) AS n FROM requests", "chart": {"kind": "number"}}""", """{"answer": "Ten."}""");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many requests?" }));
        Assert.Contains(prompt, SystemPrompt(Calls()[0]), StringComparison.Ordinal);
    }

    [Fact]
    public void Every_hint_names_a_view_that_exists_and_every_view_has_one()
    {
        Assert.Equal(TelemetrySqlGuard.Views.Order(StringComparer.Ordinal), AskViewCatalog.Hints.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_hint_for_a_view_the_database_does_not_have_fails_the_prompt()
    {
        await using var scope = app.Scope();
        var catalog = await scope.ServiceProvider.GetRequiredService<AskViewCatalog>().ViewsAsync(CancellationToken.None);
        var missing = Assert.Throws<InvalidOperationException>(() => AskViewCatalog.Prompt(catalog.Where(v => v.Name != "metrics").ToList()));
        Assert.Contains("metrics", missing.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Visits_in_the_views_are_the_visits_the_app_page_counts()
    {
        await using (var connection = new NpgsqlConnection(app.ConnectionString))
        {
            await connection.OpenAsync();
            foreach (var (method, path) in new[] { ("GET", "/"), ("GET", "/books"), ("GET", "/books/12"), ("GET", "/assets/app.js"), ("GET", "/favicon.ico"), ("POST", "/books"), ("GET", "/api/books"), ("GET", "/_platform/schedules/x"), ("GET", "/health") })
            {
                await using var command = new NpgsqlCommand("""
                    INSERT INTO telemetry_spans (id, organisation_id, app_id, trace_id, span_id, name, kind, start_at, duration_ms, status_code, http_method, http_route, url_path, http_status, received_at)
                    VALUES (gen_random_uuid(), @org, @app, @trace, @span, 'page', 2, now(), 5, 0, @method, @path, @path, 200, now())
                    """, connection);
                command.Parameters.AddWithValue("org", org);
                command.Parameters.AddWithValue("app", other);
                command.Parameters.AddWithValue("trace", Guid.NewGuid().ToString("N"));
                command.Parameters.AddWithValue("span", Guid.NewGuid().ToString("N")[..16]);
                command.Parameters.AddWithValue("method", method);
                command.Parameters.AddWithValue("path", path);
                await command.ExecuteNonQueryAsync();
            }
        }

        var visits = Count(await RunUnguardedAsync(org, other, "SELECT count(*) FILTER (WHERE visit) AS n FROM requests WHERE at >= date_trunc('day', now())"));
        Assert.Equal(3, visits);
        var page = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{other}"));
        Assert.Equal(visits, page["telemetry"]!["visitsToday"]!.GetValue<long>());
    }

    [Fact]
    public async Task A_database_error_goes_back_to_the_model_for_one_uncharged_repair()
    {
        openRouter.Chat = Answers(
            """{"sql": "SELECT date_trunc('hour', at) AS hour, count(id) AS visits FROM requests WHERE at >= date_trunc('day', now()) GROUP BY 1 ORDER BY 1", "chart": {"kind": "bar", "x": "hour", "y": ["visits"]}}""",
            """{"sql": "SELECT date_trunc('hour', at) AS hour, count(*) AS visits FROM requests WHERE at >= date_trunc('day', now()) GROUP BY 1 ORDER BY 1", "chart": {"kind": "bar", "x": "hour", "y": ["visits"]}}""",
            """{"answer": "It had ten requests today."}""");
        var answer = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many visits did it get today, by hour?" }));
        Assert.Equal("It had ten requests today.", answer["answer"]!.GetValue<string>());
        Assert.Contains("count(*)", answer["sql"]!.GetValue<string>(), StringComparison.Ordinal);

        var calls = Calls();
        Assert.Equal(3, calls.Length);
        Assert.Contains("There is no id column", SystemPrompt(calls[0]), StringComparison.Ordinal);
        Assert.Equal(calls[0]["messages"]![0]!.ToJsonString(), calls[1]["messages"]![0]!.ToJsonString());
        var repair = calls[1]["messages"]!.AsArray();
        Assert.Contains("count(id)", repair[^2]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
        var feedback = repair[^1]!["content"]!.GetValue<string>();
        Assert.Contains("The database said: column \"id\" does not exist", feedback, StringComparison.Ordinal);

        Assert.Equal((2L, 1L), await AskSettlementsAsync(bookings));
    }

    [Fact]
    public async Task The_prompt_names_the_custom_events_this_app_records_and_no_other_apps()
    {
        // A live model declined "How many books were added today?" — it could not know the app records book.created.
        openRouter.Chat = Answers(
            """{"sql": "SELECT count(*) FILTER (WHERE name = 'booking.made') AS made FROM events", "chart": {"kind": "number", "x": null, "y": ["made"]}}""",
            """{"answer": ""}""");
        var answer = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many bookings were made?" }));
        var prompt = SystemPrompt(Calls()[0]);
        Assert.Contains("- booking.made (3 in 30 days; properties e.g. {\"court\": 2})", prompt, StringComparison.Ordinal);
        Assert.Contains("count(DISTINCT user_id)", prompt, StringComparison.Ordinal);
        // A model that put nothing into words still answered: the owner reads a plain sentence, never a blank.
        Assert.Equal("Here is the one result that answers it.", answer["answer"]!.GetValue<string>());

        openRouter.Chat = Answers("""{"sql": null, "unanswerable": "The app records no bookings."}""");
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{other}/ask", new { question = "How many bookings were made?" }), (HttpStatusCode)422);
        var elsewhere = SystemPrompt(Calls()[^1]);
        Assert.DoesNotContain("booking.made", elsewhere, StringComparison.Ordinal);
        Assert.Contains("has recorded no custom events", elsewhere, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_repair_that_still_fails_says_so_in_plain_words_with_the_technical_detail_apart()
    {
        const string Second = "SELECT count(user_id) AS visits FROM requests";
        openRouter.Chat = Answers("""{"sql": "SELECT count(id) AS visits FROM requests"}""", $$"""{"sql": "{{Second}}"}""");
        var failed = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many visits?" }), (HttpStatusCode)422);
        Assert.Equal("ask_unanswerable", failed["code"]!.GetValue<string>());
        var words = failed["title"]!.GetValue<string>() + " " + failed["detail"]!.GetValue<string>();
        foreach (var technical in new[] { "SQL", "sql", "query", "column", "database", "view", "user_id", "id\"", "does not exist" })
        {
            Assert.DoesNotContain(technical, words, StringComparison.Ordinal);
        }

        Assert.Equal(Second, failed["technical"]!["sql"]!.GetValue<string>());
        Assert.Contains("column \"user_id\" does not exist", failed["technical"]!["error"]!.GetValue<string>(), StringComparison.Ordinal);

        // One repair, never charged; nothing after it.
        Assert.Equal(2, Calls().Length);
        Assert.Equal((1L, 1L), await AskSettlementsAsync(bookings));
    }

    [Fact]
    public async Task The_model_may_decline_a_question_the_views_cannot_answer()
    {
        openRouter.Chat = Answers("""{"sql": null, "unanswerable": "The app does not record where its visitors come from."}""");
        var declined = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "Which countries do visitors come from?" }), (HttpStatusCode)422);
        Assert.Equal("ask_unanswerable", declined["code"]!.GetValue<string>());
        Assert.Equal("The app does not record where its visitors come from.", declined["detail"]!.GetValue<string>());
        Assert.Contains("\"unanswerable\"", SystemPrompt(Calls()[0]), StringComparison.Ordinal);

        // Only the one call was made, and only it was charged.
        Assert.Single(Calls());
        Assert.Equal((1L, 0L), await AskSettlementsAsync(bookings));
    }

    [Fact]
    public async Task A_saved_question_that_no_longer_runs_says_so_plainly_with_the_database_message_apart()
    {
        var saved = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{bookings}/dashboard", new { question = "Requests", sql = "SELECT count(*) AS n FROM requests" }));
        await using (var connection = new NpgsqlConnection(app.ConnectionString))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand("UPDATE app_dashboard_questions SET sql = 'SELECT count(id) AS n FROM requests' WHERE id = @id", connection);
            command.Parameters.AddWithValue("id", Guid.Parse(saved["id"]!.GetValue<string>()));
            Assert.Equal(1, await command.ExecuteNonQueryAsync());
        }

        var question = Assert.Single((await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}/dashboard"))).AsArray())!;
        var error = question["error"]!.GetValue<string>();
        Assert.DoesNotContain("column", error, StringComparison.Ordinal);
        Assert.DoesNotContain("does not exist", error, StringComparison.Ordinal);
        Assert.Equal("SELECT count(id) AS n FROM requests", question["technical"]!["sql"]!.GetValue<string>());
        Assert.Contains("column \"id\" does not exist", question["technical"]!["error"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Saved_questions_rerun_on_read_and_a_viewer_reads_but_cannot_ask()
    {
        var saved = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{bookings}/dashboard", new
        {
            question = "Requests by route",
            sql = "SELECT route, count(*) AS n FROM requests GROUP BY route",
            chart = new { kind = "bar", x = "route", y = new[] { "n" } },
            answer = "All on one route.",
        }));
        var id = saved["id"]!.GetValue<string>();
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{bookings}/dashboard", new { question = "Steal", sql = "SELECT * FROM users" }), HttpStatusCode.BadRequest);

        await using (var connection = new NpgsqlConnection(app.ConnectionString))
        {
            await connection.OpenAsync();
            await SpansAsync(connection, org, bookings, 5, failed: 0);
        }

        var board = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}/dashboard"))).AsArray();
        var question = Assert.Single(board)!;
        Assert.Equal(15, question["rows"]![0]!["n"]!.GetValue<long>());
        Assert.Equal("bar", question["chart"]!["kind"]!.GetValue<string>());
        Assert.Null(question["error"]);

        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/products", email = "viewer@example.com", role = "viewer" }));
        var viewer = await app.SignInAsync("viewer@example.com");
        await ControlPlaneApp.Ok(viewer.GetAsync($"/api/apps/{bookings}/dashboard"));
        await ControlPlaneApp.Expect(await viewer.PostAsJsonAsync($"/api/apps/{bookings}/ask", new { question = "How many?" }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await viewer.DeleteAsync($"/api/apps/{bookings}/dashboard/{id}"), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/apps/{bookings}/dashboard/{id}"), HttpStatusCode.NoContent);
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}/dashboard"))).AsArray());
    }
}
