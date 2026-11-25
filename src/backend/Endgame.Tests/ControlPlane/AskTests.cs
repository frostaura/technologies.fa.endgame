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
