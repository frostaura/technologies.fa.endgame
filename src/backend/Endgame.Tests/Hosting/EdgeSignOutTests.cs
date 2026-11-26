using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using Endgame.Edge;
using Endgame.Edge.Access;
using Endgame.Edge.Runtime;
using Endgame.Hosting.Contracts;
using Endgame.Tests.Fixtures;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Hosting;

/// <summary>
/// R2-10: signing out of the console, as a browser does it, through the real Edge pipeline in front of the real
/// control plane. Edge reuses an access answer for a few seconds per cookie (15 on the real stack); the subdomain's
/// own app cookie is never sent to the platform's host. Revoking the session row alone left the app open on the
/// answer Edge had already given — so the very next request after the sign-out is the one this test makes.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class EdgeSignOutTests(PostgresServer postgres) : IAsyncLifetime
{
    private const string Subdomain = "frostaura.frostaura.net";
    private readonly FakeBackend backend = new() { Running = true, State = AppRuntimeState.Running };
    private ControlPlaneApp controlPlane = null!;
    private FakeControlPlane routes = null!;
    private WebApplication echo = null!;
    private WebApplication edge = null!;
    private HttpClient visitor = null!;
    private int controlPort;
    private Guid bookings;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        controlPort = FreePort();
        var publicPort = FreePort();
        controlPlane = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?>
        {
            // The control plane tells this Edge, as on the real stack.
            ["Services:EdgeControl"] = $"http://127.0.0.1:{controlPort}",
        });
        owner = await controlPlane.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");

        // Routes only come from a stand-in (the app runs as an echo); every access check, hand-off and sign-out goes to the real control plane.
        routes = await FakeControlPlane.StartAsync(ControlPlaneApp.ServiceToken);
        (echo, var echoAddress) = await StartEchoAsync();
        routes.SetRoutes(Routes.View(bookings, org: "frostaura", division: "technologies", project: "squash", app: "bookings",
            target: echoAddress.ToString().TrimEnd('/'), access: AppAccess.Private) with
        { Host = Subdomain });

        edge = EdgeHost.Create([], builder =>
        {
            builder.Environment.ContentRootPath = Path.GetTempPath();
            builder.Logging.ClearProviders();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                [HostingConventions.ServiceTokenVariable] = ControlPlaneApp.ServiceToken,
                ["Edge:BindAddress"] = "127.0.0.1",
                ["Edge:PublicPort"] = publicPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["Edge:ControlPort"] = controlPort.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["Edge:ControlPlaneUrl"] = routes.Address.ToString(),
                ["Edge:DockUrl"] = "http://127.0.0.1:9",
                ["Edge:RoutesPollSeconds"] = "1",
                // The real stack's default: an answer is reused for the same cookie for 15 seconds.
                ["Edge:AccessCacheSeconds"] = "15",
                ["Edge:PlatformOrigin"] = "https://endgame.frostaura.net",
                ["Edge:UsageReportSeconds"] = "0",
            });
        }, services =>
        {
            services.Replace(ServiceDescriptor.Singleton<IAppBackend>(backend));
            services.AddHttpClient(AccessGate.ClientName).ConfigurePrimaryHttpMessageHandler(controlPlane.Handler);
        });
        await edge.StartAsync();
        visitor = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = new Uri($"http://127.0.0.1:{publicPort}") };
        for (var i = 0; i < 100 && !(await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/", null))).StatusCode.Equals(HttpStatusCode.Redirect); i++)
        {
            await Task.Delay(100);
        }
    }

    public async Task DisposeAsync()
    {
        visitor.Dispose();
        await edge.DisposeAsync();
        await echo.DisposeAsync();
        await routes.DisposeAsync();
        await controlPlane.DisposeAsync();
    }

    [Fact]
    public async Task After_the_console_signs_out_the_very_next_request_on_the_subdomain_is_asked_to_sign_in()
    {
        // The Owner, signed in to the console, opens the app on the organisation subdomain: a hand-off, redeemed by Edge on that host.
        var console = controlPlane.Client();
        await ControlPlaneApp.Expect(await console.PostAsJsonAsync("/api/auth/development", new { email = "owner@frostaura.net" }), HttpStatusCode.OK);
        var link = new Uri((await ControlPlaneApp.Ok(console.PostAsJsonAsync($"/api/app-auth/{bookings}/handoff", new { })))["url"]!.GetValue<string>());
        Assert.Equal(Subdomain, link.Host);
        using var redeemed = await visitor.SendAsync(OnSubdomain(link.PathAndQuery, null));
        Assert.Equal(HttpStatusCode.Redirect, redeemed.StatusCode);
        var appCookie = redeemed.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(PlatformCookies.AppSession(bookings) + "=", StringComparison.Ordinal)).Split(';')[0];

        // The app opens, as the Owner, and Edge now holds that answer for this cookie.
        using (var open = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/", appCookie)))
        {
            Assert.Equal(HttpStatusCode.OK, open.StatusCode);
            Assert.NotEqual("", (await open.Content.ReadFromJsonAsync<Echoed>())!.Session);
        }

        // Sign out on the console's host: that request carries the console cookie only, never the subdomain's.
        await ControlPlaneApp.Expect(await console.PostAsJsonAsync("/api/auth/logout", new { }), HttpStatusCode.NoContent);

        // The very next request on the subdomain, with the cookie the browser still holds, is sent to sign in — and so is an API call.
        using var again = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/", appCookie));
        Assert.Equal(HttpStatusCode.Redirect, again.StatusCode);
        Assert.Contains("/_endgame/auth/sign-in", again.Headers.Location!.OriginalString, StringComparison.Ordinal);
        using var api = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/api/me", appCookie, HttpMethod.Post));
        Assert.Equal(HttpStatusCode.Unauthorized, api.StatusCode);
    }

    [Fact]
    public async Task Signing_out_at_the_app_on_the_subdomain_ends_its_reused_answer_too()
    {
        var console = controlPlane.Client();
        await ControlPlaneApp.Expect(await console.PostAsJsonAsync("/api/auth/development", new { email = "owner@frostaura.net" }), HttpStatusCode.OK);
        var link = new Uri((await ControlPlaneApp.Ok(console.PostAsJsonAsync($"/api/app-auth/{bookings}/handoff", new { })))["url"]!.GetValue<string>());
        using var redeemed = await visitor.SendAsync(OnSubdomain(link.PathAndQuery, null));
        var appCookie = redeemed.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(PlatformCookies.AppSession(bookings) + "=", StringComparison.Ordinal)).Split(';')[0];
        using (var open = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/", appCookie)))
        {
            Assert.Equal(HttpStatusCode.OK, open.StatusCode);
        }

        using var signOut = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/_endgame/auth/sign-out", appCookie, HttpMethod.Post));
        Assert.True(signOut.StatusCode is HttpStatusCode.Redirect or HttpStatusCode.NoContent or HttpStatusCode.OK, $"sign-out answered {(int)signOut.StatusCode}");
        using var again = await visitor.SendAsync(OnSubdomain("/technologies/squash/bookings/", appCookie));
        Assert.Equal(HttpStatusCode.Redirect, again.StatusCode);
    }

    private static HttpRequestMessage OnSubdomain(string path, string? cookie, HttpMethod? method = null)
    {
        var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
        request.Headers.Host = Subdomain;
        if (cookie is not null)
        {
            request.Headers.Add("Cookie", cookie);
        }

        return request;
    }

    private sealed record Echoed(string Path, string Session);

    private static async Task<(WebApplication, Uri)> StartEchoAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseKestrel(k => k.Listen(IPAddress.Loopback, 0));
        var app = builder.Build();
        app.MapFallback("{**path}", (HttpContext c) => Results.Json(new Echoed(c.Request.Path.Value ?? "", c.Request.Headers[HostingConventions.SessionHeader].ToString())));
        await app.StartAsync();
        return (app, new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First()));
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
