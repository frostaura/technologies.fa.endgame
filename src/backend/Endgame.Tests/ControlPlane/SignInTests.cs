using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>Real passkeys through ASP.NET Core Identity, driven by a software authenticator.</summary>
[Collection(PostgresCollection.Name)]
public sealed class SignInTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;

    public async Task InitializeAsync() => app = await ControlPlaneApp.StartAsync(postgres, developmentSignIn: false);

    public async Task DisposeAsync() => await app.DisposeAsync();

    private static async Task<JsonNode> RegisterAsync(HttpClient client, SoftwareAuthenticator authenticator, object request, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var options = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/register/options", request));
        Assert.NotNull(options["publicKey"]?["challenge"]);
        var credential = authenticator.Create(options["publicKey"]!);
        return await ControlPlaneApp.Expect(await client.PostAsJsonAsync("/api/auth/passkey/register/complete", new { credential }), expected);
    }

    private static async Task<JsonNode> LoginAsync(HttpClient client, SoftwareAuthenticator authenticator, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var options = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/login/options", new { }));
        var credential = authenticator.Get(options["publicKey"]!);
        return await ControlPlaneApp.Expect(await client.PostAsJsonAsync("/api/auth/passkey/login/complete", new { credential }), expected);
    }

    [Fact]
    public async Task Signed_out_me_is_401_problem_and_auth_options_are_readable()
    {
        var client = app.Client();
        var me = await ControlPlaneApp.Expect(await client.GetAsync("/api/me"), HttpStatusCode.Unauthorized);
        Assert.Equal("unauthenticated", me["code"]!.GetValue<string>());
        var options = await ControlPlaneApp.Ok(client.GetAsync("/api/auth/options"));
        Assert.True(options["passkey"]!.GetValue<bool>());
        Assert.False(options["developmentSignIn"]!.GetValue<bool>());
    }

    [Fact]
    public async Task The_first_person_registers_a_passkey_names_the_organisation_signs_out_and_signs_back_in()
    {
        using var authenticator = new SoftwareAuthenticator();
        var client = app.Client();
        var me = await RegisterAsync(client, authenticator, new { email = "dean@frostaura.net", displayName = "Dean" });
        Assert.Equal("Dean", me["user"]!["displayName"]!.GetValue<string>());
        Assert.Equal("dean@frostaura.net", me["user"]!["email"]!.GetValue<string>());
        Assert.Null(me["organisation"]);

        await ControlPlaneApp.Created(client.PostAsJsonAsync("/api/organisations", new { name = "FrostAura", slug = "frostaura" }));
        await ControlPlaneApp.Expect(await client.PostAsync("/api/auth/logout", null), HttpStatusCode.NoContent);
        await ControlPlaneApp.Expect(await client.GetAsync("/api/me"), HttpStatusCode.Unauthorized);

        me = await LoginAsync(client, authenticator);
        Assert.Equal("frostaura", me["organisation"]!["slug"]!.GetValue<string>());
        Assert.Equal("owner", me["memberships"]![0]!["role"]!.GetValue<string>());
    }

    [Fact]
    public async Task After_the_first_person_registration_needs_an_invitation_and_the_invited_person_gets_their_role()
    {
        using var first = new SoftwareAuthenticator();
        var owner = app.Client();
        await RegisterAsync(owner, first, new { email = "dean@frostaura.net", displayName = "Dean" });
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "FrostAura", slug = "frostaura" }));
        await owner.DivisionAsync("frostaura", "labs");

        using var stranger = new SoftwareAuthenticator();
        var refused = await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "x@example.com" }), HttpStatusCode.Forbidden);
        Assert.Equal("forbidden", refused["code"]!.GetValue<string>());

        var invitation = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope = "frostaura/labs", email = "ann@example.com", displayName = "Ann", role = "builder" }));
        var code = invitation["invitationCode"]!.GetValue<string>();

        await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = "wrong" }), HttpStatusCode.Forbidden);

        using var annKey = new SoftwareAuthenticator();
        var ann = app.Client();
        var me = await RegisterAsync(ann, annKey, new { email = "ann@example.com", invitationCode = code });
        Assert.Equal("Ann", me["user"]!["displayName"]!.GetValue<string>());
        var membership = Assert.Single(me["memberships"]!.AsArray());
        Assert.Equal("frostaura/labs", membership!["scope"]!.GetValue<string>());
        Assert.Equal("builder", membership["role"]!.GetValue<string>());

        // The code is single-use.
        await ControlPlaneApp.Expect(await app.Client().PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "ann@example.com", invitationCode = code }), HttpStatusCode.Forbidden);

        // A Builder in one division may build there and nowhere above it.
        await ann.ProjectAsync("frostaura/labs", "reel");
        await ControlPlaneApp.Expect(await ann.PostAsJsonAsync("/api/divisions", new { parent = "frostaura", name = "X", slug = "xx" }), HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_passkey_answered_for_another_origin_is_rejected()
    {
        using var authenticator = new SoftwareAuthenticator();
        var client = app.Client();
        var options = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/register/options", new { email = "dean@frostaura.net" }));
        var credential = authenticator.Create(options["publicKey"]!, originOverride: "https://evil.example");
        var problem = await ControlPlaneApp.Expect(await client.PostAsJsonAsync("/api/auth/passkey/register/complete", new { credential }), HttpStatusCode.BadRequest);
        Assert.Equal("passkey_rejected", problem["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await client.GetAsync("/api/me"), HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task An_unknown_passkey_cannot_sign_in()
    {
        using var registered = new SoftwareAuthenticator();
        await RegisterAsync(app.Client(), registered, new { email = "dean@frostaura.net" });
        using var unknown = new SoftwareAuthenticator();
        var client = app.Client();
        var options = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/passkey/login/options", new { }));
        var credential = unknown.Get(options["publicKey"]!);
        await ControlPlaneApp.Expect(await client.PostAsJsonAsync("/api/auth/passkey/login/complete", new { credential }), HttpStatusCode.Unauthorized);
    }
}
