using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Endgame.AppKit.Tests;

public sealed class ApiContractTests
{
    private static async Task<string> StartupError(Action<RouteGroupBuilder> api, Action<WebApplication>? map = null)
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => KitHost.StartAsync(api: api, map: map));
        return error.Message;
    }

    [Fact]
    public async Task An_endpoint_without_an_operation_id_stops_start_up_and_suggests_one()
    {
        var message = await StartupError(api => api.MapGet("widgets/{id}", (int id) => id).WithDescription("One widget."));
        Assert.Contains("GET api/widgets/{id}: missing an operation id", message);
        Assert.Contains(".WithName(\"getWidget\")", message);
    }

    [Fact]
    public async Task An_endpoint_without_a_description_stops_start_up()
    {
        var message = await StartupError(api => api.MapPost("widgets", () => 1).WithName("createWidget"));
        Assert.Contains("POST api/widgets: missing a description", message);
        Assert.Contains(".WithDescription(", message);
    }

    [Fact]
    public async Task Every_problem_is_listed_at_once()
    {
        var message = await StartupError(
            api =>
            {
                api.MapGet("a", () => 1);
                api.MapGet("b", () => 2).WithName("Bad-Name").WithDescription("b");
                api.MapGet("c", () => 3).WithName("getThing").WithDescription("c");
                api.MapGet("d", () => 4).WithName("getThing").WithDescription("d");
            },
            app => app.MapGet("api/widgets", () => 5).WithName("listWidgets").WithDescription("e"));
        Assert.Contains("endpoints break", message);
        Assert.Contains("GET api/a: missing an operation id", message);
        Assert.Contains("GET api/a: missing a description", message);
        Assert.Contains("\"Bad-Name\" must be lowerCamelCase", message);
        Assert.Contains("\"getThing\" is already used by GET api/c", message);
        Assert.Contains("GET api/widgets: map the app's endpoints on the group UseEndgameApp() returns", message);
    }

    [Fact]
    public async Task A_required_user_without_RequireUser_stops_start_up()
    {
        var message = await StartupError(api =>
            api.MapGet("mine", (EndgameUser user) => user.Id).WithName("listMine").WithDescription("Mine."));
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
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapGet("widgets/{id}", (int id) => TypedResults.Ok(new { id }))
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

    [Fact]
    public async Task Input_is_validated_before_the_handler_runs_with_one_entry_per_field()
    {
        var ran = false;
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapPost("widgets", (NewWidget input) =>
                {
                    ran = true;
                    return TypedResults.Ok(input);
                })
                .WithName("createWidget").WithDescription("Makes a widget."));
        using var http = host.Client();

        var refused = await http.PostAsJsonAsync("/api/widgets", new { name = "", size = 99 });
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, refused.StatusCode);
        var problem = await refused.Content.ReadFromJsonAsync<JsonElement>();
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("Name", out _), problem.ToString());
        Assert.True(errors.TryGetProperty("Size", out _), problem.ToString());
        Assert.False(ran);

        var accepted = await http.PostAsJsonAsync("/api/widgets", new { name = "Sprocket", size = 3 });
        Assert.Equal(System.Net.HttpStatusCode.OK, accepted.StatusCode);
        Assert.True(ran);
    }

    public sealed record NewWidget(
        [property: System.ComponentModel.DataAnnotations.Required, System.ComponentModel.DataAnnotations.StringLength(40, MinimumLength = 1)] string Name,
        [property: System.ComponentModel.DataAnnotations.Range(1, 10)] int Size);
}
