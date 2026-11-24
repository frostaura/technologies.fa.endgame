using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit.Tests;

/// <summary>A built front end on disk, shaped like Vite's output with <c>base: './'</c>.</summary>
internal sealed class WebRoot : IDisposable
{
    public const string GoodIndex = """
        <!doctype html><html><head><base href="/" /><script type="module" src="./assets/index-abc123.js"></script></head>
        <body><div id="root"></div></body></html>
        """;

    public WebRoot(string index = GoodIndex)
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "appkit-webroot-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(System.IO.Path.Combine(Path, "assets"));
        File.WriteAllText(System.IO.Path.Combine(Path, "index.html"), index);
        File.WriteAllText(System.IO.Path.Combine(Path, "assets", "index-abc123.js"), "console.log('app');");
        File.WriteAllText(System.IO.Path.Combine(Path, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    }

    public string Path { get; }

    public void Dispose() => Directory.Delete(Path, recursive: true);
}

public sealed class HostingTests
{
    [Theory]
    [InlineData(null, "/")]
    [InlineData("/acme/labs/demo", "/acme/labs/demo/")]
    [InlineData("/acme/labs/demo/", "/acme/labs/demo/")]
    public async Task The_page_carries_a_base_rewritten_from_the_forwarded_prefix(string? prefix, string expectedBase)
    {
        using var root = new WebRoot();
        await using var host = await KitHost.StartAsync(webRoot: root.Path);
        using var http = host.Client(prefix);

        foreach (var path in new[] { "/", "/notes/42", "/index.html" })
        {
            var response = await http.GetAsync(path);
            var html = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains($"<base href=\"{expectedBase}\" />", html);
            Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());
        }
    }

    [Fact]
    public async Task Fingerprinted_assets_are_served_immutable_and_missing_files_are_not_the_page()
    {
        using var root = new WebRoot();
        await using var host = await KitHost.StartAsync(webRoot: root.Path);
        using var http = host.Client("/acme/labs/demo");

        var asset = await http.GetAsync("/assets/index-abc123.js");
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Contains("immutable", asset.Headers.CacheControl?.ToString());

        // A lazy chunk that is not there must fail as a 404, never come back as HTML.
        var missing = await http.GetAsync("/assets/gone-999.js");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.DoesNotContain("<base", await missing.Content.ReadAsStringAsync());

        var api = await http.GetAsync("/api/nothing-here");
        Assert.Equal(HttpStatusCode.NotFound, api.StatusCode);
        Assert.Equal("application/problem+json", api.Content.Headers.ContentType?.MediaType);
    }

    [Theory]
    [InlineData("<html><head><script src=\"./a.js\"></script></head></html>", "no <base href")]
    [InlineData("<html><head><base href=\"/\" /><script src=\"/assets/a.js\"></script></head></html>", "root-relative")]
    [InlineData("<html><head><base href=\"/\" /><link href=\"https://fonts.example.com/x.css\"></head></html>", "another host")]
    public void A_page_that_would_break_under_a_prefix_is_named(string html, string expected)
    {
        var problems = SpaHost.Check(html);
        Assert.Contains(problems, p => p.Contains(expected, StringComparison.Ordinal));
    }

    [Fact]
    public void A_good_page_passes_the_check() => Assert.Empty(SpaHost.Check(WebRoot.GoodIndex));

    [Fact]
    public async Task A_broken_build_stops_the_app_from_starting()
    {
        using var root = new WebRoot("<html><head><base href=\"/\" /><script src=\"/assets/a.js\"></script></head></html>");
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => KitHost.StartAsync(webRoot: root.Path));
        Assert.Contains("base: './'", error.Message);
    }

    [Fact]
    public async Task Production_refuses_to_start_without_a_front_end()
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => KitHost.StartAsync(environmentName: "Production"));
        Assert.Contains("wwwroot/index.html is missing", error.Message);
    }

    [Fact]
    public async Task Health_reports_the_database()
    {
        await using var host = await KitHost.StartAsync();
        var response = await host.Client().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("healthy", body.GetProperty("status").GetString());
        Assert.Equal("reachable", body.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Missing_environment_is_named_in_one_message()
    {
        var error = await Assert.ThrowsAnyAsync<Exception>(() => KitHost.StartAsync(environment: e =>
        {
            e[EndgameEnvironment.PlatformUrl] = null;
            e[EndgameEnvironment.AppToken] = "";
        }));
        Assert.Contains(EndgameEnvironment.PlatformUrl, error.Message);
        Assert.Contains(EndgameEnvironment.AppToken, error.Message);
        Assert.DoesNotContain(EndgameEnvironment.Database + ",", error.Message);
    }

    [Fact]
    public async Task A_malformed_platform_url_is_refused_with_an_example()
    {
        var error = await Assert.ThrowsAnyAsync<Exception>(() => KitHost.StartAsync(environment: e => e[EndgameEnvironment.PlatformUrl] = "control-plane:8080"));
        Assert.Contains("absolute http(s) URL", error.Message);
    }

    [Fact]
    public async Task Errors_are_problem_details_with_a_trace_id()
    {
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapGet("boom", string () => throw new InvalidOperationException("kaboom"))
                .WithName("explode").WithDescription("Fails on purpose."));
        var response = await host.Client().GetAsync("/api/boom");
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("traceId", out _));
        Assert.DoesNotContain("kaboom", body.ToString());
    }

    [Fact]
    public async Task Forwarded_host_and_scheme_are_honoured()
    {
        await using var host = await KitHost.StartAsync(api: api =>
            api.MapGet("where", (HttpRequest r) => new { r.Scheme, Host = r.Host.Value, PathBase = r.PathBase.Value })
                .WithName("whereAmI").WithDescription("Echoes the address the request arrived at."));
        using var http = host.Client("/acme/labs/demo");
        http.DefaultRequestHeaders.Add("X-Forwarded-Host", "endgame.frostaura.net");
        http.DefaultRequestHeaders.Add("X-Forwarded-Proto", "https");
        var body = await http.GetFromJsonAsync<JsonElement>("/api/where");
        Assert.Equal("https", body.GetProperty("scheme").GetString());
        Assert.Equal("endgame.frostaura.net", body.GetProperty("host").GetString());
        Assert.Equal("/acme/labs/demo", body.GetProperty("pathBase").GetString());
    }
}
