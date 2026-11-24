using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

[Collection(PostgresCollection.Name)]
public sealed class TreeEndpointTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;

    public async Task InitializeAsync() => app = await ControlPlaneApp.StartAsync(postgres);

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task First_run_tree_is_empty_not_an_error_and_naming_the_organisation_makes_the_caller_its_owner()
    {
        var owner = await app.SignInAsync();
        var empty = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        Assert.Null(empty["organisation"]);
        Assert.Empty(empty["divisions"]!.AsArray());
        Assert.Empty(empty["needsYou"]!.AsArray());

        var me = await ControlPlaneApp.Ok(owner.GetAsync("/api/me"));
        Assert.Null(me["organisation"]);

        var created = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "FrostAura", slug = "frostaura" }));
        Assert.Equal("frostaura", created["slug"]!.GetValue<string>());
        me = await ControlPlaneApp.Ok(owner.GetAsync("/api/me"));
        Assert.Equal("frostaura", me["organisation"]!["slug"]!.GetValue<string>());
        Assert.Equal("owner", me["memberships"]![0]!["role"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_tree_document_carries_every_level_with_real_zero_spend_and_workers()
    {
        var owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies", "Technologies");
        await owner.ProjectAsync("frostaura/technologies", "endgame", "Endgame");
        var appId = await owner.AppAsync("frostaura/technologies/endgame", "console", "Console");

        var tree = await ControlPlaneApp.Ok(owner.GetAsync("/api/tree"));
        Assert.Equal("frostaura", tree["organisation"]!["slug"]!.GetValue<string>());
        Assert.Equal(0m, tree["organisation"]!["spend"]!["monthCredits"]!.GetValue<decimal>());
        var division = tree["divisions"]![0]!;
        Assert.Equal("technologies", division["slug"]!.GetValue<string>());
        var project = division["projects"]![0]!;
        Assert.Equal("planning", project["stage"]!.GetValue<string>());
        var appNode = project["apps"]![0]!;
        Assert.Equal(appId.ToString(), appNode["id"]!.GetValue<string>());
        Assert.Equal("starting", appNode["running"]!.GetValue<string>());
        Assert.Equal("private", appNode["access"]!.GetValue<string>());
        Assert.Equal(0m, appNode["spend"]!["monthCredits"]!.GetValue<decimal>());
        Assert.Empty(appNode["workers"]!.AsArray());
    }
}
