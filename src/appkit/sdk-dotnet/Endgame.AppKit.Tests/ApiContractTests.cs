using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit.Tests;

public sealed class ApiContractTests
{
    private static async Task<string> StartupError(Action<WebApplication> map)
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => KitHost.StartAsync(map: map));
        return error.Message;
    }

    [Fact]
    public async Task An_endpoint_without_an_operation_id_stops_start_up_and_suggests_one()
    {
        var message = await StartupError(app => app.MapGet("api/widgets/{id}", (int id) => id).WithDescription("One widget."));
        Assert.Contains("GET api/widgets/{id}: missing an operation id", message);
        Assert.Contains(".WithName(\"getWidget\")", message);
    }

    [Fact]
    public async Task An_endpoint_without_a_description_stops_start_up()
    {
        var message = await StartupError(app => app.MapPost("api/widgets", () => 1).WithName("createWidget"));
        Assert.Contains("POST api/widgets: missing a description", message);
        Assert.Contains(".WithDescription(", message);
    }

    [Fact]
    public async Task Every_problem_is_listed_at_once()
    {
        var message = await StartupError(app =>
        {
            app.MapGet("api/a", () => 1);
            app.MapGet("api/b", () => 2).WithName("Bad-Name").WithDescription("b");
            app.MapGet("api/c", () => 3).WithName("getThing").WithDescription("c");
            app.MapGet("api/d", () => 4).WithName("getThing").WithDescription("d");
            app.MapGet("widgets", () => 5).WithName("listWidgets").WithDescription("e");
        });
        Assert.Contains("endpoints break", message);
        Assert.Contains("GET api/a: missing an operation id", message);
        Assert.Contains("GET api/a: missing a description", message);
        Assert.Contains("\"Bad-Name\" must be lowerCamelCase", message);
        Assert.Contains("\"getThing\" is already used by GET api/c", message);
        Assert.Contains("GET widgets: the app's own endpoints live under api/", message);
    }

    [Fact]
    public async Task A_required_user_without_RequireUser_stops_start_up()
    {
        var message = await StartupError(app =>
            app.MapGet("api/mine", (EndgameUser user) => user.Id).WithName("listMine").WithDescription("Mine."));
        Assert.Contains("takes a non-nullable EndgameUser but is not marked .RequireUser()", message);
    }

    [Fact]
    public async Task Excluded_endpoints_are_not_held_to_the_contract()
    {
        await using var host = await KitHost.StartAsync(map: app => app.MapGet("internal/ping", () => "pong").ExcludeFromDescription());
        Assert.Equal("pong", await host.Client().GetStringAsync("/internal/ping"));
    }

    [Theory]
    [InlineData("GET", "api/notes", "listNotes")]
    [InlineData("GET", "api/notes/{id}", "getNote")]
    [InlineData("POST", "api/notes", "createNote")]
    [InlineData("PUT", "api/notes/{id}", "updateNote")]
    [InlineData("DELETE", "api/notes/{id}", "deleteNote")]
    [InlineData("GET", "api/court-bookings", "listCourtBookings")]
    public void Suggested_names_read_as_verbs(string method, string route, string expected) =>
        Assert.Equal(expected, ApiContract.SuggestName([method], route));

    [Fact]
    public async Task The_OpenAPI_document_carries_ids_descriptions_and_the_address_it_was_fetched_at()
    {
        await using var host = await KitHost.StartAsync(map: app =>
            app.MapGet("api/widgets/{id}", (int id) => TypedResults.Ok(new { id }))
                .WithName("getWidget").WithSummary("One widget").WithDescription("The widget with this id."));
        using var http = host.Client("/acme/labs/demo");
        var doc = await http.GetFromJsonAsync<JsonElement>("/" + EndgameApp.OpenApiPath);

        var get = doc.GetProperty("paths").GetProperty("/api/widgets/{id}").GetProperty("get");
        Assert.Equal("getWidget", get.GetProperty("operationId").GetString());
        Assert.Equal("The widget with this id.", get.GetProperty("description").GetString());
        var me = doc.GetProperty("paths").GetProperty("/api/me").GetProperty("get");
        Assert.Equal("getCurrentUser", me.GetProperty("operationId").GetString());
        Assert.Equal("kit-tests", doc.GetProperty("info").GetProperty("title").GetString());
        Assert.Contains("/acme/labs/demo", doc.GetProperty("servers")[0].GetProperty("url").GetString());

        // The kit's own plumbing is not an MCP tool.
        var paths = doc.GetProperty("paths").EnumerateObject().Select(p => p.Name).ToList();
        Assert.DoesNotContain(paths, p => p.Contains("health") || p.Contains("_platform") || p.Contains("hooks") || p.Contains("path"));
    }
}
