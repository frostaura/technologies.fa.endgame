using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace App.Tests;

/// <summary>
/// The app under an address prefix, as Edge forwards the path form. The same build is served at
/// the root of an organisation subdomain; NotesApiTests covers that shape.
/// </summary>
public sealed class AppShellTests : IClassFixture<AppShellTests.PrefixedApp>
{
    private readonly PrefixedApp _app;

    public AppShellTests(PrefixedApp app) => _app = app;

    public sealed class PrefixedApp : EndgameAppFactory<Program>
    {
        public PrefixedApp() => PathBase = "/acme/labs/demo";
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/notes/0195b7a6-0000-7000-8000-000000000000")]
    [InlineData("/notes/new")]
    public async Task Every_page_is_the_app_with_its_base_set_to_the_prefix(string path)
    {
        var response = await _app.CreateClient().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("<base href=\"/acme/labs/demo/\" />", html);
        Assert.Contains("<div id=\"root\">", html);
    }

    [Fact]
    public async Task Health_and_the_interface_description_are_where_the_platform_looks()
    {
        using var http = _app.CreateClient();
        var health = await http.GetFromJsonAsync<JsonElement>("/health");
        Assert.Equal("healthy", health.GetProperty("status").GetString());

        var doc = await http.GetFromJsonAsync<JsonElement>("/openapi/v1.json");
        var operations = doc.GetProperty("paths").EnumerateObject()
            .SelectMany(p => p.Value.EnumerateObject())
            .Select(o => o.Value.GetProperty("operationId").GetString())
            .ToHashSet();
        Assert.Superset(new HashSet<string?> { "listNotes", "getNote", "createNote", "getNoteFollow", "followNote", "unfollowNote", "getCurrentUser" }, operations);
    }
}
