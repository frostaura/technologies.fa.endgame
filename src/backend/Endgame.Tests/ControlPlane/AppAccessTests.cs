using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Tree;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Private, shared and public, decided by the control plane for Edge (<c>POST /internal/access/check</c>),
/// and the app end-user population: real passkeys through Identity's own handler, one app each.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AppAccessTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;
    private Guid bookings;
    private Guid ladder;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");
        ladder = await owner.AppAsync("frostaura/technologies/squash", "ladder");
        service = app.Internal();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private async Task<JsonNode> CheckAsync(Guid appId, string? cookie, string path = "/") =>
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/access/check", new { appId, cookie, path }));

    private async Task SetAccessAsync(Guid appId, string access) =>
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{appId}/settings", new { access }));

    [Fact]
    public async Task A_private_app_admits_members_with_rights_asks_strangers_to_sign_in_and_refuses_the_rest()
    {
        Assert.Equal("sign-in", (await CheckAsync(bookings, null))["decision"]!.GetValue<string>());
        var ownerCookie = await new Browser(app).SignInMemberAsync("owner@frostaura.net");
        var allowed = await CheckAsync(bookings, ownerCookie);
        Assert.Equal("allow", allowed["decision"]!.GetValue<string>());
        Assert.NotNull(allowed["sessionToken"]);

        // A member of the organisation whose role sits on another branch has no rights here.
        await owner.DivisionAsync("frostaura", "labs");
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "ann@example.com", role = "builder" }));
        var annCookie = await new Browser(app).SignInMemberAsync("ann@example.com");
        Assert.Equal("deny", (await CheckAsync(bookings, annCookie))["decision"]!.GetValue<string>());

        // A viewer granted on the app itself is admitted, and the app learns their role.
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/technologies/squash/bookings", email = "ann@example.com", role = "viewer" }));
        Assert.Equal("allow", (await CheckAsync(bookings, annCookie))["decision"]!.GetValue<string>());

        // Private apps take no end users, and platform callbacks are never admitted from outside.
        var stranger = new Browser(app);
        var refused = await ControlPlaneApp.Expect(await stranger.PostAsync($"/api/app-auth/{bookings}/development", new { email = "fan@example.com" }), HttpStatusCode.Forbidden);
        Assert.Contains("private", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal("deny", (await CheckAsync(bookings, ownerCookie, "/_platform/schedules/nightly"))["decision"]!.GetValue<string>());
        Assert.Equal("deny", (await CheckAsync(Guid.NewGuid(), ownerCookie))["decision"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_shared_app_admits_the_people_it_was_shared_with_once_they_register_with_their_code_and_unsharing_ends_it()
    {
        await SetAccessAsync(bookings, "shared");
        var share = await ControlPlaneApp.Created(owner.PostAsJsonAsync($"/api/apps/{bookings}/shares", new { email = "Friend@Example.com" }));
        Assert.Equal("friend@example.com", share["email"]!.GetValue<string>());
        var code = share["invitationCode"]!.GetValue<string>();

        using var authenticator = new SoftwareAuthenticator();
        var friend = new Browser(app);
        var info = await ControlPlaneApp.Ok(friend.GetAsync($"/api/app-auth/{bookings}"));
        Assert.Equal("shared", info["access"]!.GetValue<string>());
        Assert.True(info["invitationRequired"]!.GetValue<bool>());

        // Without the code, or as someone it was not shared with, registration is refused.
        await ControlPlaneApp.Expect(await friend.PostAsync($"/api/app-auth/{bookings}/sign-up/options", new { email = "friend@example.com" }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Expect(await friend.PostAsync($"/api/app-auth/{bookings}/sign-up/options", new { email = "other@example.com", invitationCode = code }), HttpStatusCode.Forbidden);

        var signedUp = await friend.SignUpAsync(bookings, authenticator, "friend@example.com", "Friend", code, "https://endgame.frostaura.net/frostaura/technologies/squash/bookings/courts?day=today");
        Assert.Equal("endUser", signedUp["user"]!["kind"]!.GetValue<string>());
        Assert.Equal("https://endgame.frostaura.net/frostaura/technologies/squash/bookings/courts?day=today", signedUp["returnTo"]!.GetValue<string>());
        Assert.Equal("allow", (await CheckAsync(bookings, friend.CookieHeader))["decision"]!.GetValue<string>());

        // The code is one-time.
        await ControlPlaneApp.Expect(await new Browser(app).PostAsync($"/api/app-auth/{bookings}/sign-up/options", new { email = "friend@example.com", invitationCode = code }), HttpStatusCode.Forbidden);

        // Signed out and back in with the same passkey.
        await ControlPlaneApp.Expect(await friend.PostAsync($"/api/app-auth/{bookings}/sign-out", new { }), HttpStatusCode.NoContent);
        Assert.Equal("sign-in", (await CheckAsync(bookings, friend.CookieHeader))["decision"]!.GetValue<string>());
        var back = await friend.SignInAsync(bookings, authenticator, "https://evil.example/steal");
        Assert.Equal("https://endgame.frostaura.net/frostaura/technologies/squash/bookings/", back["returnTo"]!.GetValue<string>());
        var check = await CheckAsync(bookings, friend.CookieHeader);
        Assert.Equal("allow", check["decision"]!.GetValue<string>());

        var shares = (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}/shares"))).AsArray();
        Assert.True(Assert.Single(shares)!["registered"]!.GetValue<bool>());
        Assert.Equal(1, (await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}")))["sharedWith"]!.GetValue<int>());

        // Unsharing ends it at once: the access check refuses and the app's token stops resolving.
        var appToken = (await ControlPlaneApp.Ok(service.PostAsync($"/internal/apps/{bookings}/token", null)))["token"]!.GetValue<string>();
        var kit = app.Internal();
        kit.DefaultRequestHeaders.Authorization = new("Bearer", appToken);
        await ControlPlaneApp.Ok(kit.PostAsJsonAsync("/platform/v1/identity/resolve", new { session = check["sessionToken"]!.GetValue<string>() }));
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/apps/{bookings}/shares?email=friend@example.com"), HttpStatusCode.NoContent);
        Assert.Equal("sign-in", (await CheckAsync(bookings, friend.CookieHeader))["decision"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await kit.PostAsJsonAsync("/platform/v1/identity/resolve", new { session = check["sessionToken"]!.GetValue<string>() }), HttpStatusCode.Unauthorized);
        var again = await ControlPlaneApp.Ok(friend.PostAsync($"/api/app-auth/{bookings}/sign-in/options", new { }));
        await ControlPlaneApp.Expect(await friend.PostAsync($"/api/app-auth/{bookings}/sign-in/complete", new { credential = authenticator.Get(again["publicKey"]!) }), HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task An_end_user_belongs_to_one_app_and_can_never_reach_the_console_or_another_app()
    {
        await SetAccessAsync(bookings, "public");
        await SetAccessAsync(ladder, "public");
        using var authenticator = new SoftwareAuthenticator();
        var player = new Browser(app);
        await player.SignUpAsync(bookings, authenticator, "player@example.com", "Player", null, null);
        Assert.Equal("allow", (await CheckAsync(bookings, player.CookieHeader))["decision"]!.GetValue<string>());
        Assert.NotNull((await CheckAsync(bookings, player.CookieHeader))["sessionToken"]);

        // At the other app the same browser is anonymous (public: admitted, but unknown), and the passkey does not work there.
        var elsewhere = await CheckAsync(ladder, player.CookieHeader);
        Assert.Equal("allow", elsewhere["decision"]!.GetValue<string>());
        Assert.Null(elsewhere["sessionToken"]);
        var options = await ControlPlaneApp.Ok(player.PostAsync($"/api/app-auth/{ladder}/sign-in/options", new { }));
        var wrongApp = await player.PostAsync($"/api/app-auth/{ladder}/sign-in/complete", new { credential = authenticator.Get(options["publicKey"]!) });
        Assert.Equal("passkey_rejected", (await ControlPlaneApp.Expect(wrongApp, HttpStatusCode.Unauthorized))["code"]!.GetValue<string>());

        // The console knows nothing of them: no session, and their passkey is not a member's.
        await ControlPlaneApp.Expect(await player.GetAsync("/api/me"), HttpStatusCode.Unauthorized);
        var memberOptions = await ControlPlaneApp.Ok(player.PostAsync("/api/auth/passkey/login/options", new { }));
        await ControlPlaneApp.Expect(await player.PostAsync("/api/auth/passkey/login/complete", new { credential = authenticator.Get(memberOptions["publicKey"]!) }), HttpStatusCode.Unauthorized);

        // A public app with nobody signed in: open, with no session.
        var anonymous = await CheckAsync(bookings, null);
        Assert.Equal("allow", anonymous["decision"]!.GetValue<string>());
        Assert.Null(anonymous["sessionToken"]);
    }

    [Fact]
    public async Task Only_a_person_can_make_an_app_public_and_only_an_admin_changes_who_may_open_it()
    {
        // No agent and no service: the cascade refuses them, and the internal API has no route that sets it.
        await using (var scope = app.Scope())
        {
            var resolved = await scope.ServiceProvider.GetRequiredService<ScopeResolver>().RequireAsync("frostaura/technologies/squash/bookings", CancellationToken.None);
            var cascade = scope.ServiceProvider.GetRequiredService<CascadeService>();
            foreach (var actor in new[] { Actor.Agent, Actor.Service })
            {
                var refused = await Assert.ThrowsAsync<EndgameProblem>(() =>
                    cascade.SetAsync(resolved, CascadeKind.Setting, CascadeKeys.Access, JsonValue.Create("public"), Guid.NewGuid(), actor, CancellationToken.None));
                Assert.Equal("human_only", refused.Code);
            }

            // Sharing is not going public: an agent may narrow or share.
            await cascade.SetAsync(resolved, CascadeKind.Setting, CascadeKeys.Access, JsonValue.Create("shared"), Guid.NewGuid(), Actor.Agent, CancellationToken.None);
        }

        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/internal/apps/{bookings}/settings", new { access = "public" }), HttpStatusCode.NotFound);
        await ControlPlaneApp.Expect(await service.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { access = "public" }), HttpStatusCode.Unauthorized);
        var route = (await ControlPlaneApp.Ok(service.GetAsync("/internal/routes")))["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<Guid>() == bookings)!;
        Assert.Equal("shared", route["access"]!.GetValue<string>());

        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura", email = "builder@example.com", role = "builder" }));
        var builder = await app.SignInAsync("builder@example.com");
        await ControlPlaneApp.Expect(await builder.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { access = "public" }), HttpStatusCode.Forbidden);
        await ControlPlaneApp.Ok(builder.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { running = "always-on" }));
        await ControlPlaneApp.Expect(await builder.PostAsJsonAsync($"/api/apps/{bookings}/shares", new { email = "x@example.com" }), HttpStatusCode.Forbidden);

        var made = await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { access = "public" }));
        Assert.Equal("public", made["settings"]!["access"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { access = "everyone" }), HttpStatusCode.BadRequest);
        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        Assert.Equal("public", tree["divisions"]![0]!["projects"]![0]!["apps"]!.AsArray().Single(a => a!["slug"]!.GetValue<string>() == "bookings")!["access"]!.GetValue<string>());
    }

    /// <summary>A browser: keeps the cookies the control plane sets and sends its Origin, so passkey ceremonies and app sessions behave as they do in one.</summary>
    private sealed class Browser(ControlPlaneApp app)
    {
        private readonly Dictionary<string, string> cookies = new(StringComparer.Ordinal);
        private readonly HttpClient client = Bare(app);

        public string CookieHeader => string.Join("; ", cookies.Select(c => $"{c.Key}={c.Value}"));

        private static HttpClient Bare(ControlPlaneApp app)
        {
            var c = app.Internal();
            c.DefaultRequestHeaders.Authorization = null;
            c.DefaultRequestHeaders.Add("Origin", "https://localhost");
            return c;
        }

        public async Task<HttpResponseMessage> PostAsync(string path, object body) => Keep(await Send(new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) }));

        public async Task<HttpResponseMessage> GetAsync(string path) => Keep(await Send(new HttpRequestMessage(HttpMethod.Get, path)));

        public async Task<string> SignInMemberAsync(string email)
        {
            await ControlPlaneApp.Expect(await PostAsync("/api/auth/development", new { email }), HttpStatusCode.OK);
            return CookieHeader;
        }

        public async Task<JsonNode> SignUpAsync(Guid appId, SoftwareAuthenticator authenticator, string email, string name, string? code, string? returnTo)
        {
            var options = await ControlPlaneApp.Ok(PostAsync($"/api/app-auth/{appId}/sign-up/options", new { email, displayName = name, invitationCode = code, returnTo }));
            return await ControlPlaneApp.Ok(PostAsync($"/api/app-auth/{appId}/sign-up/complete", new { credential = authenticator.Create(options["publicKey"]!), invitationCode = code }));
        }

        public async Task<JsonNode> SignInAsync(Guid appId, SoftwareAuthenticator authenticator, string? returnTo)
        {
            var options = await ControlPlaneApp.Ok(PostAsync($"/api/app-auth/{appId}/sign-in/options", new { returnTo }));
            return await ControlPlaneApp.Ok(PostAsync($"/api/app-auth/{appId}/sign-in/complete", new { credential = authenticator.Get(options["publicKey"]!) }));
        }

        private async Task<HttpResponseMessage> Send(HttpRequestMessage request)
        {
            if (cookies.Count > 0)
            {
                request.Headers.Add("Cookie", CookieHeader);
            }

            return await client.SendAsync(request);
        }

        private HttpResponseMessage Keep(HttpResponseMessage response)
        {
            if (response.Headers.TryGetValues("Set-Cookie", out var set))
            {
                foreach (var line in set)
                {
                    var pair = line.Split(';')[0];
                    var eq = pair.IndexOf('=', StringComparison.Ordinal);
                    var (name, value) = (pair[..eq], pair[(eq + 1)..]);
                    var expired = line.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase) || value.Length == 0;
                    if (expired)
                    {
                        cookies.Remove(name);
                    }
                    else
                    {
                        cookies[name] = value;
                    }
                }
            }

            return response;
        }
    }
}
