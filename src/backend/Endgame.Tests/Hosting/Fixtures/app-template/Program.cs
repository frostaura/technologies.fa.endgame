using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// The edge strips the address prefix and says what it was; the same image serves the path form and
// the organisation subdomain (ARCH-005, "Addresses").
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
        | ForwardedHeaders.XForwardedHost | ForwardedHeaders.XForwardedPrefix;
    o.KnownIPNetworks.Clear(); // the only peer on the app's network that sends requests is the edge
    o.KnownProxies.Clear();
});
builder.Services.AddHttpClient("out", c => c.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddHttpClient("direct", c => c.Timeout = TimeSpan.FromSeconds(5))
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseProxy = false, ConnectTimeout = TimeSpan.FromSeconds(4) });

var app = builder.Build();
app.UseForwardedHeaders();
var connectionString = app.Configuration.GetConnectionString("App") ?? throw new InvalidOperationException("No database.");

await using (var setup = new NpgsqlConnection(connectionString))
{
    await setup.OpenAsync();
    await using var create = new NpgsqlCommand("CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, text text NOT NULL)", setup);
    await create.ExecuteNonQueryAsync();
}

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

app.MapGet("/api/whoami", (HttpContext c) => new
{
    pathBase = c.Request.PathBase.Value ?? "",
    path = c.Request.Path.Value ?? "",
    host = c.Request.Host.Value ?? "",
    scheme = c.Request.Scheme,
    user = c.Request.Headers["X-Endgame-User-Id"].ToString(),
    cookie = c.Request.Headers.Cookie.ToString(),
    appId = Environment.GetEnvironmentVariable("ENDGAME_APP_ID") ?? "",
    platform = Environment.GetEnvironmentVariable("ENDGAME_PLATFORM_URL") ?? "",
    token = Environment.GetEnvironmentVariable("ENDGAME_APP_TOKEN") is { Length: > 0 },
});

app.MapGet("/api/notes", async () =>
{
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync();
    await using var query = new NpgsqlCommand("SELECT text FROM notes ORDER BY id", connection);
    await using var reader = await query.ExecuteReaderAsync();
    var notes = new List<string>();
    while (await reader.ReadAsync())
    {
        notes.Add(reader.GetString(0));
    }

    return notes;
});

app.MapPost("/api/notes", async (HttpRequest request) =>
{
    var text = await new StreamReader(request.Body).ReadToEndAsync();
    await using var connection = new NpgsqlConnection(connectionString);
    await connection.OpenAsync();
    await using var insert = new NpgsqlCommand("INSERT INTO notes (text) VALUES (@t)", connection);
    insert.Parameters.AddWithValue("t", text);
    await insert.ExecuteNonQueryAsync();
    return Results.Created("api/notes", text);
});

// Every database this app's role can see by name, and which of them it can actually open.
app.MapGet("/api/databases", async () =>
{
    var own = new NpgsqlConnectionStringBuilder(connectionString);
    var names = new List<string>();
    await using (var connection = new NpgsqlConnection(connectionString))
    {
        await connection.OpenAsync();
        await using var list = new NpgsqlCommand("SELECT datname FROM pg_database WHERE datname <> 'template0' ORDER BY 1", connection);
        await using var reader = await list.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }
    }

    var opened = new List<string>();
    foreach (var name in names)
    {
        var other = new NpgsqlConnectionStringBuilder(connectionString) { Database = name, Pooling = false, Timeout = 5 };
        try
        {
            await using var attempt = new NpgsqlConnection(other.ConnectionString);
            await attempt.OpenAsync();
            opened.Add(name);
        }
        catch (PostgresException)
        {
        }
    }

    return new { own = own.Database, visible = names, opened };
});

// Fetch a URL through the egress proxy (the default), or directly, and say what happened.
app.MapGet("/api/fetch", async (string url, bool? direct, IHttpClientFactory http) =>
{
    try
    {
        using var response = await http.CreateClient(direct == true ? "direct" : "out").GetAsync(url);
        return Results.Ok(new { reached = true, status = (int)response.StatusCode });
    }
    catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
    {
        return Results.Ok(new { reached = false, status = (e as HttpRequestException)?.StatusCode is HttpStatusCode code ? (int)code : 0, error = e.Message });
    }
});

// Ends the process the way a fatal bug would, a moment after answering.
app.MapPost("/api/crash", () =>
{
    _ = Task.Run(async () =>
    {
        await Task.Delay(200);
        Environment.Exit(3);
    });
    return Results.Accepted();
});

app.UseStaticFiles();

// The page is never served by default-file handling: its <base> is rewritten on every request from
// the forwarded prefix, so relative URLs resolve under either address shape.
var page = await File.ReadAllTextAsync(Path.Combine(app.Environment.WebRootPath, "index.html"));
app.MapFallback((HttpContext c) =>
{
    if (c.Request.Path.StartsWithSegments("/api"))
    {
        return Results.NotFound();
    }

    var baseHref = (c.Request.PathBase.Value ?? "").TrimEnd('/') + "/";
    return Results.Content(page.Replace("<base href=\"/\" />", $"<base href=\"{WebUtility.HtmlEncode(baseHref)}\" />", StringComparison.Ordinal), "text/html; charset=utf-8");
});

app.Run();
