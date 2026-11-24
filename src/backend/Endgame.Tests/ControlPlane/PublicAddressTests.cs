using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// An app's two addresses carry the scheme and port visitors really use. A stack on a developer's
/// machine is plain HTTP on a high port (<c>http://localhost:18095</c>, <c>http://acme.localhost:18095</c>);
/// with the addresses fixed to <c>https://</c> and no port, every sign-in's <c>returnTo</c> was
/// refused there and every hand-off link pointed at a host nothing listens on.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class PublicAddressTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private Guid bookings;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?>
        {
            ["Addresses:PathHost"] = "localhost",
            ["Addresses:OrganisationDomain"] = "localhost",
            ["Addresses:Scheme"] = "http",
            ["Addresses:Port"] = "18095",
        });
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task Both_addresses_carry_the_configured_scheme_and_port_and_the_route_host_does_not()
    {
        var detail = await ControlPlaneApp.Ok(owner.GetAsync($"/api/apps/{bookings}"));
        Assert.Equal("http://localhost:18095/frostaura/technologies/squash/bookings/", detail["addresses"]!["path"]!.GetValue<string>());
        Assert.Equal("http://frostaura.localhost:18095/technologies/squash/bookings/", detail["addresses"]!["subdomain"]!.GetValue<string>());

        var routes = await ControlPlaneApp.Ok(app.Internal().GetAsync("/internal/routes"));
        var route = routes["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<string>() == bookings.ToString())!;
        Assert.Equal("frostaura.localhost", route["host"]!.GetValue<string>()); // a host name; the edge matches any port
    }

    [Fact]
    public async Task A_sign_in_returning_to_the_local_subdomain_is_accepted_and_handed_off_there()
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { access = "public" }));
        var visitor = app.Client();
        var onPath = await ControlPlaneApp.Ok(visitor.PostAsJsonAsync($"/api/app-auth/{bookings}/development",
            new { email = "p@example.com", returnTo = "http://localhost:18095/frostaura/technologies/squash/bookings/courts" }));
        Assert.Equal("http://localhost:18095/frostaura/technologies/squash/bookings/courts", onPath["returnTo"]!.GetValue<string>());

        var onSubdomain = await ControlPlaneApp.Ok(visitor.PostAsJsonAsync($"/api/app-auth/{bookings}/development",
            new { email = "p@example.com", returnTo = "http://frostaura.localhost:18095/technologies/squash/bookings/courts" }));
        var link = new Uri(onSubdomain["returnTo"]!.GetValue<string>());
        Assert.Equal("http://frostaura.localhost:18095/technologies/squash/bookings/_endgame/auth/handoff", link.GetLeftPart(UriPartial.Path));

        // Another scheme or port is still somewhere else.
        foreach (var elsewhere in new[] { "https://frostaura.localhost:18095/technologies/squash/bookings/", "http://frostaura.localhost:18096/technologies/squash/bookings/", "http://frostaura.localhost/technologies/squash/bookings/" })
        {
            var refused = await ControlPlaneApp.Expect(await visitor.PostAsJsonAsync($"/api/app-auth/{bookings}/development", new { email = "p@example.com", returnTo = elsewhere }), HttpStatusCode.BadRequest);
            Assert.Equal("invalid_return_to", refused["code"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task Without_the_settings_the_addresses_stay_https_on_the_default_port()
    {
        await using var production = await ControlPlaneApp.StartAsync(postgres);
        var client = await production.OwnerWithOrganisationAsync();
        await client.DivisionAsync("frostaura", "technologies");
        await client.ProjectAsync("frostaura/technologies", "squash");
        var id = await client.AppAsync("frostaura/technologies/squash", "bookings");
        var detail = await ControlPlaneApp.Ok(client.GetAsync($"/api/apps/{id}"));
        Assert.Equal("https://endgame.frostaura.net/frostaura/technologies/squash/bookings/", detail["addresses"]!["path"]!.GetValue<string>());
        Assert.Equal("https://frostaura.frostaura.net/technologies/squash/bookings/", detail["addresses"]!["subdomain"]!.GetValue<string>());
    }
}
