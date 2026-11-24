using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit.Tests;

public sealed class IdentityTests
{
    private static void MapPrivate(WebApplication app)
    {
        app.MapGet("api/private", (EndgameUser user) => new { user.Email })
            .RequireUser().WithName("getPrivate").WithDescription("Only for the signed in.");
        app.MapGet("api/maybe", (EndgameUser? user, IEndgameIdentity identity) => new { email = user?.Email, signIn = identity.SignInUrl() })
            .WithName("getMaybe").WithDescription("Works signed in or not.");
    }

    [Fact]
    public async Task Nobody_signed_in_is_a_null_user_not_an_error()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        var me = await host.Client().GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal(JsonValueKind.Null, me.GetProperty("user").ValueKind);
    }

    [Fact]
    public async Task A_platform_session_becomes_the_current_user()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        var session = host.Platform.CreateSession("ada@example.test", EndgameUserKind.EndUser, "Ada");
        using var http = host.Client(session: session);

        var me = await http.GetFromJsonAsync<JsonElement>("/api/me");
        var user = me.GetProperty("user");
        Assert.Equal("ada@example.test", user.GetProperty("email").GetString());
        Assert.Equal("Ada", user.GetProperty("displayName").GetString());
        Assert.Equal("endUser", user.GetProperty("kind").GetString());
        Assert.StartsWith("usr_", user.GetProperty("id").GetString());

        var mine = await http.GetFromJsonAsync<JsonElement>("/api/private");
        Assert.Equal("ada@example.test", mine.GetProperty("email").GetString());
    }

    [Fact]
    public async Task An_API_call_without_a_user_gets_a_401_problem_naming_where_to_sign_in()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        var response = await host.Client("/acme/labs/demo").GetAsync("/api/private");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2Facme%2Flabs%2Fdemo%2F", problem.GetProperty("signInUrl").GetString());
    }

    [Fact]
    public async Task A_browser_navigating_to_a_private_page_is_sent_to_sign_in_and_back()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        using var http = host.Client("/acme/labs/demo");
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/private?x=1");
        request.Headers.Accept.ParseAdd("text/html");
        var response = await http.SendAsync(request);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2Facme%2Flabs%2Fdemo%2Fapi%2Fprivate%3Fx%3D1", response.Headers.Location?.OriginalString);
    }

    [Fact]
    public async Task An_unknown_session_is_treated_as_signed_out()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        using var http = host.Client(session: "dev-session-forged");
        var me = await http.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal(JsonValueKind.Null, me.GetProperty("user").ValueKind);
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/api/private")).StatusCode);
    }

    [Fact]
    public async Task Sign_in_urls_follow_the_address_shape()
    {
        await using var host = await KitHost.StartAsync(map: MapPrivate);
        var atRoot = await host.Client().GetFromJsonAsync<JsonElement>("/api/maybe");
        Assert.Equal("/_endgame/auth/sign-in?returnTo=%2Fapi%2Fmaybe", atRoot.GetProperty("signIn").GetString());
        var underPrefix = await host.Client("/acme/labs/demo").GetFromJsonAsync<JsonElement>("/api/maybe");
        Assert.Equal("/acme/labs/demo/_endgame/auth/sign-in?returnTo=%2Facme%2Flabs%2Fdemo%2Fapi%2Fmaybe", underPrefix.GetProperty("signIn").GetString());
    }

    [Fact]
    public void Return_addresses_must_stay_inside_the_app()
    {
        Assert.True(EndgameIdentity.IsLocal("/acme/labs/demo/notes"));
        Assert.False(EndgameIdentity.IsLocal("//evil.example"));
        Assert.False(EndgameIdentity.IsLocal("/\\evil.example"));
        Assert.False(EndgameIdentity.IsLocal("https://evil.example"));
    }
}
