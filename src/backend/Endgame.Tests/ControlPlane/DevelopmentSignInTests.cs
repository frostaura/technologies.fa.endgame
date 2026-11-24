using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The development sign-in must be provably absent unless BOTH the environment is Development AND
/// ENDGAME_DEV_LOGIN=true (assumption 12). These fail the build if it is ever reachable otherwise.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DevelopmentSignInTests(PostgresServer postgres)
{
    [Theory]
    [InlineData("Production", true)]
    [InlineData("Production", false)]
    [InlineData("Staging", true)]
    [InlineData("Development", false)]
    public async Task Is_not_mapped_outside_development_with_the_flag(string environment, bool flag)
    {
        await using var app = await ControlPlaneApp.StartAsync(postgres, environment: environment, developmentSignIn: flag);
        var client = app.Client();
        var problem = await ControlPlaneApp.Expect(await client.PostAsJsonAsync("/api/auth/development", new { email = "dev@frostaura.net" }), HttpStatusCode.NotFound);
        Assert.Equal("not_found", problem["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await client.GetAsync("/api/me"), HttpStatusCode.Unauthorized);

        var options = await ControlPlaneApp.Ok(client.GetAsync("/api/auth/options"));
        Assert.False(options["developmentSignIn"]!.GetValue<bool>());

        var openapi = await ControlPlaneApp.Ok(client.GetAsync("/api/openapi/v1.json"));
        Assert.False(openapi["paths"]!.AsObject().ContainsKey("/api/auth/development"));
    }

    [Fact]
    public async Task Is_mapped_in_development_with_the_flag_and_returns_me()
    {
        await using var app = await ControlPlaneApp.StartAsync(postgres, environment: "Development", developmentSignIn: true);
        var client = app.Client();
        Assert.True((await ControlPlaneApp.Ok(client.GetAsync("/api/auth/options")))["developmentSignIn"]!.GetValue<bool>());
        // The console sends an empty body; the configured development user is signed in.
        var me = await ControlPlaneApp.Ok(client.PostAsJsonAsync("/api/auth/development", new { }));
        Assert.Equal("dev@frostaura.net", me["user"]!["email"]!.GetValue<string>());
        var again = await ControlPlaneApp.Ok(client.GetAsync("/api/me"));
        Assert.Equal(me["user"]!["id"]!.GetValue<string>(), again["user"]!["id"]!.GetValue<string>());
    }
}
