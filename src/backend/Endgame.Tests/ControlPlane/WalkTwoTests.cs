using System.Net;
using System.Net.Http.Json;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Defects found driving every academy flow by hand on the real stack (2026-11-26, second walk), held on the real
/// control plane and a real PostgreSQL.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class WalkTwoTests(PostgresServer postgres) : IAsyncLifetime
{
    private readonly LogSink logs = new();
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres, services: s => s.AddSingleton<ILoggerProvider>(logs));
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task A_deliberate_refusal_is_logged_once_as_a_warning_with_no_stack_trace()
    {
        // D55: a 503 refusal was logged as "Unhandled failure" and again by ASP.NET with a stack trace.
        logs.Entries.Clear();
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/organisations",
            new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = "Sells booking software to squash clubs." }), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("screening_unavailable", refused["code"]!.GetValue<string>());
        await ControlPlaneApp.Expect(await owner.GetAsync($"/api/runs/{Guid.NewGuid()}"), HttpStatusCode.NotFound);

        var entries = logs.Entries.ToList();
        Assert.DoesNotContain(entries, e => e.Level >= LogLevel.Error);
        Assert.DoesNotContain(entries, e => e.Category.StartsWith("Microsoft.AspNetCore.Diagnostics", StringComparison.Ordinal));
        var problems = entries.Where(e => e.Category == "Endgame.Problems").ToList();
        Assert.Equal(2, problems.Count);
        Assert.All(problems, e => Assert.Null(e.Exception));
        var unavailable = Assert.Single(problems, e => e.Message.Contains("screening_unavailable", StringComparison.Ordinal));
        Assert.Equal(LogLevel.Warning, unavailable.Level);
        Assert.Equal(LogLevel.Information, Assert.Single(problems, e => e.Message.Contains("not_found", StringComparison.Ordinal)).Level);
    }
}
