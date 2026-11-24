using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// <c>POST /api/apps/{id}/settings { idleMinutes }</c>, as the console sends it. Found by the merged
/// stack's acceptance test: the number arrived as an <c>int</c> and was refused as "not a whole number
/// from 1 to 1440", so no app's sleep time could be changed from the console at all.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class AppSettingsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;
    private Guid bookings;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "technologies");
        await owner.ProjectAsync("frostaura/technologies", "squash");
        bookings = await owner.AppAsync("frostaura/technologies/squash", "bookings");
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Theory]
    [InlineData(1)]
    [InlineData(45)]
    [InlineData(1440)]
    public async Task An_apps_idle_minutes_are_set_from_the_settings_endpoint_and_reach_the_routing_table(int minutes)
    {
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { idleMinutes = minutes }));
        var routes = await ControlPlaneApp.Ok(app.Internal().GetAsync("/internal/routes"));
        var route = routes["routes"]!.AsArray().Single(r => r!["appId"]!.GetValue<string>() == bookings.ToString())!;
        Assert.Equal(minutes, route["sleep"]!["idleMinutes"]!.GetValue<int>());
        Assert.Equal("frostaura/technologies/squash/bookings", route["sleep"]!["idleSetAt"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1441)]
    public async Task Idle_minutes_outside_one_to_1440_are_refused(int minutes)
    {
        var refused = await owner.PostAsJsonAsync($"/api/apps/{bookings}/settings", new { idleMinutes = minutes });
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, refused.StatusCode);
    }
}
