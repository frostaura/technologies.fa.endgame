using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Gateway;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Tests.ControlPlane;

/// <summary>Runs only with <c>ENDGAME_LIVE_MODEL_TESTS=1</c> and a real <c>OPENROUTER_API_KEY</c> in the environment.</summary>
public sealed class LiveFactAttribute : FactAttribute
{
    public LiveFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ENDGAME_LIVE_MODEL_TESTS") != "1" || string.IsNullOrEmpty(Environment.GetEnvironmentVariable("OPENROUTER_API_KEY")))
        {
            Skip = "Live model test: set ENDGAME_LIVE_MODEL_TESTS=1 and OPENROUTER_API_KEY to run it (one tiny call, well under a cent).";
        }
    }
}

[Collection(PostgresCollection.Name)]
public sealed class LiveModelTests(PostgresServer postgres)
{
    [LiveFact]
    public async Task Every_routed_model_id_exists_and_one_real_call_settles_at_or_under_its_reservation()
    {
        await using var app = await ControlPlaneApp.StartAsync(postgres, settings: new Dictionary<string, string?>
        {
            ["ModelGateway:BaseUrl"] = "https://openrouter.ai",
            ["OPENROUTER_API_KEY"] = Environment.GetEnvironmentVariable("OPENROUTER_API_KEY"),
            ["ModelGateway:GenerationLookupSeconds"] = "20",
        });

        // Rule 7: never route to an unvalidated id. The listing is public and free.
        var gateway = app.Services.GetRequiredService<ModelGatewayOptions>();
        using var http = new HttpClient();
        var listing = (await http.GetFromJsonAsync<JsonNode>("https://openrouter.ai/api/v1/models"))!["data"]!.AsArray().Select(m => m!["id"]!.GetValue<string>()).ToHashSet();
        var unknown = gateway.Models.Keys.Where(id => !listing.Contains(id)).ToList();
        Assert.True(unknown.Count == 0, $"Not listed by OpenRouter: {string.Join(", ", unknown)}");

        var owner = await app.OwnerWithOrganisationAsync();
        await owner.TopUpAsync("frostaura", 5m);
        var response = await app.Internal().PostAsJsonAsync("/internal/model/chat", new
        {
            taskType = "classify",
            scope = "frostaura",
            limits = new { maxTokens = 32 },
            messages = new[] { new { role = "user", content = "Reply with the single word: yes" } },
        });
        var body = await ControlPlaneApp.Expect(response, HttpStatusCode.OK);
        Assert.NotNull(body["choices"]);
        var reserved = decimal.Parse(response.Headers.GetValues("Endgame-Reserved-Credits").Single(), CultureInfo.InvariantCulture);
        var settled = decimal.Parse(response.Headers.GetValues("Endgame-Settled-Credits").Single(), CultureInfo.InvariantCulture);
        Assert.True(settled > 0, "The reply carried a cost.");
        Assert.True(reserved >= settled, $"Reserved {reserved} must cover settled {settled}.");
    }
}
