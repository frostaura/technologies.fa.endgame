using System.Text.Json.Nodes;
using Endgame.Application.Gateway;
using Microsoft.Extensions.Configuration;

namespace Endgame.Tests.ControlPlane;

/// <summary>The routing table that ships, and the rules a routing table must satisfy before the control plane will start.</summary>
public sealed class RoutingTableTests
{
    private static ModelGatewayOptions Shipped()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        var configuration = new ConfigurationBuilder().AddJsonFile(path).Build();
        return configuration.GetSection(ModelGatewayOptions.SectionName).Get<ModelGatewayOptions>()!;
    }

    [Fact]
    public void The_shipped_routing_table_is_valid_and_sets_reasoning_and_ceilings_everywhere()
    {
        var options = Shipped();
        Assert.Empty(options.Validate());
        Assert.All(options.Routes.Values, r =>
        {
            Assert.NotNull(r.Reasoning);
            Assert.True(r.MaxTokens > 0 && r.MaxCallUsd > 0);
        });
        Assert.Contains("research", options.Routes.Keys);
    }

    [Fact]
    public void An_unvalidated_model_a_missing_reasoning_setting_or_an_unclamped_output_is_a_fault()
    {
        var options = Shipped();
        options.Routes["chat"].Models.Add("someone/unlisted-model");
        options.Routes["classify"].Reasoning = null;
        options.Routes["summarise"].MaxTokens = 0;
        var faults = options.Validate();
        Assert.Contains(faults, f => f.Contains("unlisted-model", StringComparison.Ordinal));
        Assert.Contains(faults, f => f.Contains("Reasoning", StringComparison.Ordinal));
        Assert.Contains(faults, f => f.Contains("MaxTokens", StringComparison.Ordinal));
    }

    [Fact]
    public void A_call_is_reserved_at_the_ceiling_it_is_sent_with()
    {
        var options = Shipped();
        var credits = new CreditOptions { CreditsPerUsd = 100m };
        var route = options.Routes["research"];
        var request = new ChatRequest
        {
            TaskType = "research",
            Messages = [new JsonObject { ["role"] = "user", ["content"] = new string('x', 2000) }],
            Tools = [new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = "f" } }],
        };
        var prepared = ModelGateway.Prepare(options, credits, request, route, stream: false);
        var tools = prepared.Body["tools"]!.AsArray();
        Assert.Equal("openrouter:web_search", tools[^1]!["type"]!.GetValue<string>());
        Assert.False(prepared.Body["parallel_tool_calls"]!.GetValue<bool>());
        Assert.Equal(route.MaxTokens, prepared.MaxTokens);
        Assert.True(prepared.WorstCaseUsd <= route.MaxCallUsd);
        Assert.True(prepared.ReservedCredits >= prepared.WorstCaseUsd * 100m);
    }
}
