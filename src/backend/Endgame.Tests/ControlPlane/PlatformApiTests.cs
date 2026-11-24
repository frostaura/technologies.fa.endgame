using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Platform;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The platform API (src/appkit/PLATFORM-API.md) against the real control plane, on real Postgres,
/// called exactly as the app kit calls it — same paths, same bodies, the app token as a bearer — for
/// identity, models (OpenRouter faked), secrets, e-mail (an in-test SMTP sink), schedules (the signed
/// callback captured where Edge would forward it), webhooks and telemetry (real OTLP protobuf).
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class PlatformApiTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string EdgeControl = "http://edge-control.test";
    private readonly ConcurrentQueue<(HttpRequestMessage Request, byte[] Body)> callbacks = new();
    private FakeOpenRouter openRouter = null!;
    private SmtpSink smtp = null!;
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid appId;
    private string token = "";

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        smtp = new SmtpSink();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter, settings: new Dictionary<string, string?>
        {
            ["Smtp:Host"] = "127.0.0.1",
            ["Smtp:Port"] = smtp.Port.ToString(CultureInfo.InvariantCulture),
            ["Smtp:From"] = "no-reply@endgame.test",
            ["Smtp:StartTls"] = "false",
            ["Services:EdgeControl"] = EdgeControl,
            ["AppSessions:TokenGraceSeconds"] = "0",
        }, services: s =>
        {
            s.AddHttpClient(AppCallbackClient.ClientName).ConfigurePrimaryHttpMessageHandler(() => new CapturingHandler(callbacks, HttpStatusCode.NoContent));
            s.AddHttpClient(EdgeNotifier.ClientName).ConfigurePrimaryHttpMessageHandler(() => new CapturingHandler(new ConcurrentQueue<(HttpRequestMessage, byte[])>(), HttpStatusCode.OK));
        });
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        appId = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        await owner.TopUpAsync("frostaura", 100m);
        service = app.Internal();
        token = (await ControlPlaneApp.Ok(service.PostAsync($"/internal/apps/{appId}/token", null)))["token"]!.GetValue<string>();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
        await smtp.DisposeAsync();
    }

    /// <summary>A client set up as the kit's PlatformClient is: base address, the app token as a bearer.</summary>
    private HttpClient Kit(string? appToken = null)
    {
        var client = app.Internal();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", appToken ?? token);
        return client;
    }

    [Fact]
    public async Task The_app_token_is_required_rotates_and_is_never_reachable_through_the_public_side()
    {
        var anonymous = app.Internal();
        anonymous.DefaultRequestHeaders.Authorization = null;
        var refused = await ControlPlaneApp.Expect(await anonymous.GetAsync("/platform/v1/secrets/ANY_NAME"), HttpStatusCode.Unauthorized);
        Assert.Equal("app_token_invalid", refused["code"]!.GetValue<string>());
        // The service token is not an app token.
        await ControlPlaneApp.Expect(await app.Internal().GetAsync("/platform/v1/secrets/ANY_NAME"), HttpStatusCode.Unauthorized);

        // Through Edge's public side (it sets X-Forwarded-Host), the platform API is not there at all.
        using var forwarded = new HttpRequestMessage(HttpMethod.Get, "/platform/v1/secrets/ANY_NAME");
        forwarded.Headers.Add("X-Forwarded-Host", "endgame.frostaura.net");
        await ControlPlaneApp.Expect(await Kit().SendAsync(forwarded), HttpStatusCode.NotFound);

        // Stored only as a hash: the database never holds the token.
        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT token_hash FROM app_tokens", db);
            var hash = (string)(await command.ExecuteScalarAsync())!;
            Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token))), hash);
        }

        // Dock restarting the app mints a new one; the old one stops working (grace is zero here).
        var fresh = (await ControlPlaneApp.Ok(service.PostAsync($"/internal/apps/{appId}/token", null)))["token"]!.GetValue<string>();
        Assert.NotEqual(token, fresh);
        await ControlPlaneApp.Expect(await Kit(token).GetAsync("/platform/v1/secrets/ANY_NAME"), HttpStatusCode.Unauthorized);
        await ControlPlaneApp.Expect(await Kit(fresh).GetAsync("/platform/v1/secrets/ANY_NAME"), HttpStatusCode.NotFound);
        token = fresh;
    }

    [Fact]
    public async Task Identity_resolves_a_member_and_an_end_user_from_the_session_edge_hands_the_app()
    {
        // A member: the console's own session cookie, sent by Edge in the access check.
        var cookie = await SessionCookieAsync("/api/auth/development", new { email = "owner@frostaura.net" }, "endgame.session");
        var check = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/access/check", new { appId, cookie, path = "/notes" }));
        Assert.Equal("allow", check["decision"]!.GetValue<string>());
        var session = check["sessionToken"]!.GetValue<string>();
        // App-scoped and never the browser's cookie, so an app cannot replay it against the console.
        Assert.DoesNotContain(cookie.Split('=', 2)[1], session, StringComparison.Ordinal);
        var replayed = app.Internal();
        replayed.DefaultRequestHeaders.Authorization = null;
        replayed.DefaultRequestHeaders.Add("Cookie", $"endgame.session={session}");
        await ControlPlaneApp.Expect(await replayed.GetAsync("/api/me"), HttpStatusCode.Unauthorized);

        var member = await ControlPlaneApp.Ok(Kit().PostAsJsonAsync("/platform/v1/identity/resolve", new { session }));
        Assert.Equal("member", member["user"]!["kind"]!.GetValue<string>());
        Assert.Equal("owner", member["user"]!["role"]!.GetValue<string>());
        Assert.Equal("owner@frostaura.net", member["user"]!["email"]!.GetValue<string>());
        Assert.StartsWith("usr_", member["user"]!["id"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.True(member["expiresAt"]!.GetValue<DateTimeOffset>() > DateTimeOffset.UtcNow);

        // An end user of a public app, signed in at the app's identity pages.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { access = "public" }));
        var endUserCookie = await SessionCookieAsync($"/api/app-auth/{appId}/development", new { email = "player@example.com", displayName = "Player" }, $"endgame.app.{appId:N}");
        var asEndUser = await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/access/check", new { appId, cookie = endUserCookie, path = "/" }));
        Assert.Equal("allow", asEndUser["decision"]!.GetValue<string>());
        var endUser = await ControlPlaneApp.Ok(Kit().PostAsJsonAsync("/platform/v1/identity/resolve", new { session = asEndUser["sessionToken"]!.GetValue<string>() }));
        Assert.Equal("endUser", endUser["user"]!["kind"]!.GetValue<string>());
        Assert.Null(endUser["user"]!["role"]);
        Assert.Equal("Player", endUser["user"]!["displayName"]!.GetValue<string>());

        // Nonsense, and a session for another app, are session_invalid.
        var invalid = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/identity/resolve", new { session = "egs_forged" }), HttpStatusCode.Unauthorized);
        Assert.Equal("session_invalid", invalid["code"]!.GetValue<string>());
        var otherApp = await owner.AppAsync("frostaura/technologies/squash", "ladder");
        var otherToken = (await ControlPlaneApp.Ok(service.PostAsync($"/internal/apps/{otherApp}/token", null)))["token"]!.GetValue<string>();
        await ControlPlaneApp.Expect(await Kit(otherToken).PostAsJsonAsync("/platform/v1/identity/resolve", new { session }), HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Models_go_through_the_same_gateway_on_an_app_safe_route_charged_to_the_app_and_held_to_its_cap()
    {
        var reply = await ControlPlaneApp.Ok(Kit().PostAsJsonAsync("/platform/v1/models/chat", new
        {
            messages = new[] { new { role = "system", content = "Be brief." }, new { role = "user", content = "Hello?" } },
            taskType = "summarise",
            maxTokens = 64,
            temperature = 0.2,
        }));
        Assert.Equal("Hello.", reply["content"]!.GetValue<string>());
        Assert.Equal(12, reply["usage"]!["inputTokens"]!.GetValue<int>());
        Assert.Equal(5, reply["usage"]!["outputTokens"]!.GetValue<int>());
        Assert.Equal(0.01m, reply["credits"]!.GetValue<decimal>());

        var sent = openRouter.Requests.Last();
        Assert.Equal("qwen/qwen3.7-flash", sent["model"]!.GetValue<string>());
        Assert.Equal(64, sent["max_tokens"]!.GetValue<int>());
        Assert.Equal(0.2, sent["temperature"]!.GetValue<double>());
        Assert.Null(sent["tools"]);

        // Charged to the app's whole path, on the app route.
        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT task_type, app_id, project_id, division_id IS NOT NULL FROM credit_entries WHERE kind = 'settlement'", db);
            await using var reader = await command.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal("app.summarise", reader.GetString(0));
            Assert.Equal(appId, reader.GetGuid(1));
            Assert.True(reader.GetBoolean(3));
        }

        var unknown = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "x" } }, taskType = "code" }), HttpStatusCode.BadRequest);
        Assert.Equal("invalid_request", unknown["code"]!.GetValue<string>());

        // The per-app cap is checked in the admission itself: 402 budget_exhausted, and nothing reaches the provider.
        await owner.SetAsync("frostaura/technologies/squash/bookings", "setting", "app_models.monthly_credits", 0.02m);
        var before = openRouter.Requests.Count;
        var capped = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/models/chat", new { messages = new[] { new { role = "user", content = "again" } } }), HttpStatusCode.PaymentRequired);
        Assert.Equal("budget_exhausted", capped["code"]!.GetValue<string>());
        Assert.Equal("app models", capped["bindingScope"]!.GetValue<string>());
        Assert.Equal(before, openRouter.Requests.Count);
    }

    [Fact]
    public async Task Secrets_cascade_are_sealed_at_rest_and_the_console_only_ever_sees_names()
    {
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/secrets", new { scope = "frostaura/technologies", name = "COURT_SENSOR_KEY", value = "division-value" }));
        var secret = await ControlPlaneApp.Ok(Kit().GetAsync("/platform/v1/secrets/COURT_SENSOR_KEY"));
        Assert.Equal("division-value", secret["value"]!.GetValue<string>());
        Assert.Equal("frostaura/technologies", secret["scope"]!.GetValue<string>());

        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/secrets", new { scope = "frostaura/technologies/squash/bookings", name = "COURT_SENSOR_KEY", value = "app-value" }));
        Assert.Equal("app-value", (await ControlPlaneApp.Ok(Kit().GetAsync("/platform/v1/secrets/COURT_SENSOR_KEY")))["value"]!.GetValue<string>());

        var list = await ControlPlaneApp.Ok(owner.GetAsync("/api/secrets?scope=frostaura/technologies/squash/bookings"));
        var named = Assert.Single(list["effective"]!.AsArray())!;
        Assert.Equal("COURT_SENSOR_KEY", named["name"]!.GetValue<string>());
        Assert.Equal("app", named["setAtLevel"]!.GetValue<string>());
        Assert.Equal(["frostaura/technologies"], named["overrides"]!.AsArray().Select(o => o!.GetValue<string>()));
        var fromDivision = await ControlPlaneApp.Ok(owner.GetAsync("/api/secrets?scope=frostaura/technologies"));
        Assert.Equal("frostaura/technologies/squash/bookings", fromDivision["setBelow"]![0]!["setAtPath"]!.GetValue<string>());
        foreach (var read in new[] { list, fromDivision, await ControlPlaneApp.Ok(owner.GetAsync("/api/cascade?scope=frostaura/technologies/squash/bookings&kind=secret")) })
        {
            Assert.DoesNotContain("app-value", read.ToJsonString(), StringComparison.Ordinal);
            Assert.DoesNotContain("division-value", read.ToJsonString(), StringComparison.Ordinal);
        }

        // At rest: envelope-sealed, no plaintext in the row.
        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT protected_value, value::text FROM cascade_entries WHERE kind = 'secret'", db);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                Assert.StartsWith("egv1.", reader.GetString(0), StringComparison.Ordinal);
                Assert.DoesNotContain("-value", reader.GetString(0) + reader.GetString(1), StringComparison.Ordinal);
            }
        }

        // Removing the app's own value lets the division's apply again; no level at all is secret_not_found.
        await ControlPlaneApp.Expect(await owner.DeleteAsync("/api/secrets?scope=frostaura/technologies/squash/bookings&name=COURT_SENSOR_KEY"), HttpStatusCode.NoContent);
        Assert.Equal("division-value", (await ControlPlaneApp.Ok(Kit().GetAsync("/platform/v1/secrets/COURT_SENSOR_KEY")))["value"]!.GetValue<string>());
        var missing = await ControlPlaneApp.Expect(await Kit().GetAsync("/platform/v1/secrets/NOT_SET_ANYWHERE"), HttpStatusCode.NotFound);
        Assert.Equal("secret_not_found", missing["code"]!.GetValue<string>());
        Assert.Contains("frostaura/technologies/squash/bookings", missing["detail"]!.GetValue<string>(), StringComparison.Ordinal);

        // Only Admins and above set secrets.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "builder@example.com", role = "builder" }));
        var builder = await app.SignInAsync("builder@example.com");
        await ControlPlaneApp.Expect(await builder.PutAsJsonAsync("/api/secrets", new { scope = "frostaura", name = "X_KEY", value = "v" }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await owner.PutAsJsonAsync("/api/secrets", new { scope = "frostaura", name = "lower-case", value = "v" }), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Email_is_queued_and_delivered_through_smtp_and_bad_mail_is_refused()
    {
        var queued = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/email", new
        {
            to = new[] { "member@example.com" },
            subject = "Your court is booked",
            text = "Court 2 at 18:00.",
            html = "<p>Court 2 at 18:00.</p>",
            replyTo = "club@example.com",
        }), HttpStatusCode.Accepted);
        Assert.StartsWith("eml_", queued["id"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Empty(smtp.Messages);

        var dispatcher = app.Services.GetRequiredService<EmailDispatcher>();
        Assert.Equal(1, await dispatcher.DispatchOnceAsync(CancellationToken.None));
        var received = Assert.Single(smtp.Messages);
        Assert.Equal(["member@example.com"], received.To);
        Assert.Equal("no-reply@endgame.test", received.From);
        Assert.Contains("Your court is booked", received.Data, StringComparison.Ordinal);
        Assert.Equal(0, await dispatcher.DispatchOnceAsync(CancellationToken.None));

        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT status, attempts, app_id FROM email_messages", db);
            await using var reader = await command.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal("sent", reader.GetString(0));
            Assert.Equal(1, reader.GetInt32(1));
            Assert.Equal(appId, reader.GetGuid(2));
        }

        foreach (var bad in new object[]
                 {
                     new { to = Array.Empty<string>(), subject = "s", text = "t" },
                     new { to = new[] { "not-an-address" }, subject = "s", text = "t" },
                     new { to = new[] { "a@b.c" }, subject = "two\r\nlines", text = "t" },
                     new { to = new[] { "a@b.c" }, subject = "s" },
                 })
        {
            var refused = await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/email", bad), HttpStatusCode.BadRequest);
            Assert.Equal("invalid_request", refused["code"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task Schedules_are_declared_called_back_signed_through_edge_and_webhooks_reach_the_routing_table()
    {
        var declared = await ControlPlaneApp.Ok(Kit().PutAsJsonAsync("/platform/v1/schedules", new
        {
            schedules = new[] { new { name = "nightly-digest", cron = "0 3 * * *", timeZone = "Africa/Johannesburg", path = "_platform/schedules/nightly-digest" } },
        }));
        var schedule = Assert.Single(declared["schedules"]!.AsArray())!;
        Assert.Equal("nightly-digest", schedule["name"]!.GetValue<string>());
        var next = schedule["nextRunAt"]!.GetValue<DateTimeOffset>();
        Assert.Equal(1, next.UtcDateTime.Hour); // 03:00 in Johannesburg (UTC+2)

        await ControlPlaneApp.Expect(await Kit().PutAsJsonAsync("/platform/v1/schedules", new { schedules = new[] { new { name = "x", cron = "61 * * * *", timeZone = "UTC", path = "_platform/schedules/x" } } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await Kit().PutAsJsonAsync("/platform/v1/schedules", new { schedules = new[] { new { name = "ok-name", cron = "* * * * *", timeZone = "Mars/Olympus", path = "_platform/schedules/ok-name" } } }), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await Kit().PutAsJsonAsync("/platform/v1/schedules", new { schedules = new[] { new { name = "ok-name", cron = "* * * * *", timeZone = "UTC", path = "api/elsewhere" } } }), HttpStatusCode.BadRequest);

        // Make it due, run one scheduler pass, and look at what Edge's control listener received.
        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("UPDATE app_schedules SET next_run_at = now() - interval '1 minute'", db);
            await command.ExecuteNonQueryAsync();
        }

        var scheduler = app.Services.GetRequiredService<Scheduler>();
        Assert.Equal(1, await scheduler.RunDueOnceAsync(CancellationToken.None));
        var (request, body) = Assert.Single(callbacks);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal($"{EdgeControl}/internal/apps/{appId:D}/platform/schedules/nightly-digest", request.RequestUri!.ToString());
        Assert.Equal($"Bearer {ControlPlaneApp.ServiceToken}", request.Headers.Authorization!.ToString());
        Assert.NotNull(JsonNode.Parse(body)!["scheduledFor"]);
        var signature = request.Headers.GetValues("X-Endgame-Signature").Single();
        Assert.True(VerifyAsTheKitDoes(token, signature, body, DateTimeOffset.UtcNow), signature);
        Assert.False(VerifyAsTheKitDoes("another-token", signature, body, DateTimeOffset.UtcNow));

        // It moved on to its next occurrence, recorded the answer, and is not due again.
        Assert.Equal(0, await scheduler.RunDueOnceAsync(CancellationToken.None));
        await using (var db = new NpgsqlConnection(app.ConnectionString))
        {
            await db.OpenAsync();
            await using var command = new NpgsqlCommand("SELECT last_status, next_run_at > now(), lease_holder IS NULL FROM app_schedules", db);
            await using var reader = await command.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal(204, reader.GetInt32(0));
            Assert.True(reader.GetBoolean(1));
            Assert.True(reader.GetBoolean(2));
        }

        // An empty list removes them all.
        Assert.Empty((await ControlPlaneApp.Ok(Kit().PutAsJsonAsync("/platform/v1/schedules", new { schedules = Array.Empty<object>() })))["schedules"]!.AsArray());

        var hooks = await ControlPlaneApp.Ok(Kit().PutAsJsonAsync("/platform/v1/webhooks", new { webhooks = new[] { new { name = "court-sensor", path = "hooks/court-sensor" } } }));
        Assert.Equal("hooks/court-sensor", hooks["webhooks"]![0]!["path"]!.GetValue<string>());
        var route = (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<Guid>() == appId)!;
        Assert.Equal(["court-sensor"], route["hooks"]!.AsArray().Select(h => h!.GetValue<string>()));
        await ControlPlaneApp.Expect(await Kit().PutAsJsonAsync("/platform/v1/webhooks", new { webhooks = new[] { new { name = "court-sensor", path = "hooks/elsewhere" } } }), HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Telemetry_is_stored_per_app_and_the_app_page_and_tree_show_what_was_measured()
    {
        // Nothing measured yet: null, never zero.
        Assert.Null((await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["telemetry"]);
        Assert.Null(TreeApp(await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["visitsToday"]);

        await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/telemetry/events", new
        {
            events = new[] { new { name = "booking.created", at = DateTimeOffset.UtcNow, properties = new { court = 2 }, userId = "usr_1" } },
        }), HttpStatusCode.Accepted);
        await ControlPlaneApp.Expect(await Kit().PostAsJsonAsync("/platform/v1/telemetry/events", new { events = new[] { new { name = "Not A Name" } } }), HttpStatusCode.BadRequest);

        var now = DateTimeOffset.UtcNow.AddSeconds(-5);
        var traces = OtlpWriter.Traces(appId.ToString(),
            new OtlpWriter.Span("GET /", 2, now, 12, "GET", "/", 200),
            new OtlpWriter.Span("GET /bookings", 2, now, 20, "GET", "/bookings", 200),
            new OtlpWriter.Span("GET api/bookings", 2, now, 30, "GET", "/api/bookings", 200, "api/bookings"),
            new OtlpWriter.Span("POST api/bookings", 2, now, 400, "POST", "/api/bookings", 500, "api/bookings"),
            new OtlpWriter.Span("GET /health", 2, now, 1, "GET", "/health", 200),
            new OtlpWriter.Span("SELECT", 3, now, 2, "GET", "/", 200));
        using (var content = new ByteArrayContent(traces))
        {
            content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
            var response = await Kit().PostAsync("/platform/v1/otlp/v1/traces", content);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("application/x-protobuf", response.Content.Headers.ContentType!.MediaType);
        }

        foreach (var (signal, bytes) in new[] { ("metrics", OtlpWriter.Metrics(appId.ToString(), "http.server.request.duration", 12.5, now)), ("logs", OtlpWriter.Logs(appId.ToString(), "Booked court 2", 9, now)) })
        {
            using var content = new ByteArrayContent(bytes);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
            Assert.Equal(HttpStatusCode.OK, (await Kit().PostAsync($"/platform/v1/otlp/v1/{signal}", content)).StatusCode);
        }

        await ControlPlaneApp.Expect(await Kit().PostAsync("/platform/v1/otlp/v1/profiles", new ByteArrayContent([])), HttpStatusCode.NotFound);
        using (var garbage = new ByteArrayContent([0x0a, 0xff, 0xff]))
        {
            garbage.Headers.ContentType = new MediaTypeHeaderValue("application/x-protobuf");
            await ControlPlaneApp.Expect(await Kit().PostAsync("/platform/v1/otlp/v1/traces", garbage), HttpStatusCode.BadRequest);
        }

        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/apps/{appId}/published", new { version = "c0ffee" }));
        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}"));
        var telemetry = detail["telemetry"]!;
        Assert.Equal(2, telemetry["visitsToday"]!.GetValue<long>());
        Assert.Equal(4, telemetry["requestsToday"]!.GetValue<long>());
        Assert.Equal(1, telemetry["errorsToday"]!.GetValue<long>());
        Assert.Equal(25d, telemetry["latencyP50Ms"]!.GetValue<double>());
        Assert.True(telemetry["latencyP95Ms"]!.GetValue<double>() > 300);
        Assert.NotNull(telemetry["lastVisitAt"]);
        // One failure in four within fifteen minutes is degraded.
        Assert.Equal("degraded", detail["health"]!["state"]!.GetValue<string>());
        Assert.Equal(2, TreeApp(await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["visitsToday"]!.GetValue<int>());

        await using var db = new NpgsqlConnection(app.ConnectionString);
        await db.OpenAsync();
        await using var counts = new NpgsqlCommand("SELECT (SELECT count(*) FROM telemetry_events), (SELECT count(*) FROM telemetry_metrics), (SELECT count(*) FROM telemetry_logs), (SELECT count(DISTINCT app_id) FROM telemetry_spans)", db);
        await using var reader = await counts.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal([1L, 1L, 1L, 1L], new[] { reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3) });
    }

    [Fact]
    public async Task Otlp_json_is_accepted_too()
    {
        var at = ((DateTimeOffset.UtcNow - DateTimeOffset.UnixEpoch).Ticks * 100).ToString(CultureInfo.InvariantCulture);
        var json = $$$"""
            {"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"app"}}]},
              "scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"GET /",
                "kind":2,"startTimeUnixNano":"{{{at}}}","endTimeUnixNano":"{{{at}}}",
                "attributes":[{"key":"http.request.method","value":{"stringValue":"GET"}},{"key":"url.path","value":{"stringValue":"/"}},
                              {"key":"http.response.status_code","value":{"intValue":"200"}}]}]}]}]}
            """;
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await Kit().PostAsync("/platform/v1/otlp/v1/traces", content);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{}", await response.Content.ReadAsStringAsync());
        Assert.Equal(1, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{appId}")))["telemetry"]!["visitsToday"]!.GetValue<long>());
    }

    private JsonNode TreeApp(JsonNode tree) => tree["divisions"]![0]!["projects"]![0]!["apps"]!.AsArray().Single(a => a!["id"]!.GetValue<Guid>() == appId)!;

    /// <summary>Signs in through an endpoint with a client that does not keep cookies, and returns the session cookie as a Cookie header.</summary>
    private async Task<string> SessionCookieAsync(string path, object body, string cookieName)
    {
        var client = app.Internal();
        client.DefaultRequestHeaders.Authorization = null;
        client.DefaultRequestHeaders.Add("Origin", "https://localhost");
        var response = await client.PostAsJsonAsync(path, body);
        await ControlPlaneApp.Expect(response, HttpStatusCode.OK);
        var set = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith(cookieName + "=", StringComparison.Ordinal));
        return set.Split(';')[0];
    }

    /// <summary>
    /// The app kit's <c>CallbackSignature.Verify</c>, line for line (src/appkit/sdk-dotnet/Endgame.AppKit/Platform/CallbackSignature.cs):
    /// <c>t=&lt;unix&gt;,v1=&lt;hex HMAC-SHA256(token, "&lt;t&gt;." + body)&gt;</c>, at most five minutes old.
    /// </summary>
    private static bool VerifyAsTheKitDoes(string appToken, string header, byte[] body, DateTimeOffset now)
    {
        string? t = null, v1 = null;
        foreach (var part in header.Split(','))
        {
            var kv = part.Split('=', 2);
            if (kv is ["t", var a])
            {
                t = a;
            }
            else if (kv is ["v1", var b])
            {
                v1 = b;
            }
        }

        if (t is null || v1 is null || !long.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            || (now - DateTimeOffset.FromUnixTimeSeconds(seconds)).Duration() > TimeSpan.FromMinutes(5))
        {
            return false;
        }

        var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(appToken), (byte[])[.. Encoding.UTF8.GetBytes(t + "."), .. body]);
        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(v1), mac);
    }

    /// <summary>Stands in for Edge's control listener: records each request and answers with a fixed status.</summary>
    private sealed class CapturingHandler(ConcurrentQueue<(HttpRequestMessage, byte[])> into, HttpStatusCode status) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            into.Enqueue((request, body));
            return new HttpResponseMessage(status);
        }
    }
}
