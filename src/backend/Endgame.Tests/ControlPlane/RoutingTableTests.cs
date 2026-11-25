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
        // qwen3.7-flash, the route's fallback, does not take parallel_tool_calls, so it is not sent (ARCH-006).
        Assert.False(prepared.Body.ContainsKey("parallel_tool_calls"));
        Assert.Equal(route.MaxTokens, prepared.MaxTokens);
        Assert.True(prepared.WorstCaseUsd <= route.MaxCallUsd);
        Assert.True(prepared.ReservedCredits >= prepared.WorstCaseUsd * 100m);
    }

    [Fact]
    public void A_research_call_sets_its_own_search_budget_within_the_route_and_may_switch_search_off()
    {
        // The first real run starved research at the route's two searches a call; the Runner now sizes the
        // budget per strand from the estimate, and the judge, which weighs what was found, searches nothing.
        var options = Shipped();
        var credits = new CreditOptions { CreditsPerUsd = 100m };
        var route = options.Routes["research"];
        Assert.True(route.WebSearch!.MaxUses >= 8, "the research route must allow a strand its 6 to 8 searches");
        ChatRequest Request(int? searches) => new()
        {
            TaskType = "research",
            Messages = [new JsonObject { ["role"] = "user", ["content"] = "Research it." }],
            Limits = new ChatLimits { MaxSearches = searches },
        };
        PreparedCall Prepare(int? searches) => ModelGateway.Prepare(options, credits, Request(searches), route, stream: false);

        var seven = Prepare(7);
        Assert.Equal(7, seven.Body["tools"]![0]!["parameters"]!["max_uses"]!.GetValue<int>());
        var none = Prepare(0);
        Assert.False(none.Body.ContainsKey("tools"));
        Assert.True(none.ReservedCredits < seven.ReservedCredits, "a call that cannot search reserves no search fees");
        Assert.Equal(route.WebSearch.MaxUses, Prepare(500).Body["tools"]![0]!["parameters"]!["max_uses"]!.GetValue<int>());
        Assert.Equal(route.WebSearch.MaxUses, Prepare(null).Body["tools"]![0]!["parameters"]!["max_uses"]!.GetValue<int>());
        Assert.True(Prepare(500).WorstCaseUsd <= route.MaxCallUsd);
        Assert.Throws<Endgame.Application.Common.EndgameProblem>(() => Prepare(-1));
    }

    [Fact]
    public void The_building_tiers_route_cheapest_first_to_the_benchmarked_models_each_under_its_own_ceiling()
    {
        var options = Shipped();
        (string TaskType, string Model)[] tiers =
        [
            ("build", "deepseek/deepseek-v4.1-flash"),
            ("build-t1", "qwen/qwen3.7-plus"),
            ("build-t2", "z-ai/glm-5.2"),
            ("build-t3", "anthropic/claude-sonnet-5.5"),
        ];
        decimal previous = 0;
        foreach (var (taskType, model) in tiers)
        {
            var route = options.Routes[taskType];
            Assert.Equal([model], route.Models);
            Assert.True(route.MaxCompletionPerMillionUsd > previous, $"{taskType} should allow dearer output than the tier below it.");
            previous = route.MaxCompletionPerMillionUsd;
        }

        foreach (var taskType in new[] { "plan", "evaluate", "research", "chat", "summarise" })
        {
            Assert.Contains(taskType, options.Routes.Keys);
        }

        Assert.NotNull(options.Routes["research"].WebSearch);
    }

    [Fact]
    public void Only_the_parameters_every_model_on_the_route_takes_are_sent()
    {
        var options = Shipped();
        var credits = new CreditOptions();
        ChatRequest Request(string taskType) => new()
        {
            TaskType = taskType,
            Messages = [new JsonObject { ["role"] = "user", ["content"] = "Build it." }],
            Tools = [new JsonObject { ["type"] = "function", ["function"] = new JsonObject { ["name"] = "edit_file" } }],
            ToolChoice = JsonValue.Create("auto"),
            Temperature = 0.2,
            ProviderOrder = ["Anthropic"],
        };

        // Sonnet takes no temperature and no parallel_tool_calls; sending either would leave no provider.
        var sonnet = ModelGateway.Prepare(options, credits, Request("build-t3"), options.Routes["build-t3"], stream: true).Body;
        Assert.False(sonnet.ContainsKey("temperature"));
        Assert.False(sonnet.ContainsKey("parallel_tool_calls"));
        Assert.Equal("auto", sonnet["tool_choice"]!.GetValue<string>());
        Assert.Equal("low", sonnet["reasoning"]!["effort"]!.GetValue<string>());
        Assert.Equal(["Anthropic"], sonnet["provider"]!["order"]!.AsArray().Select(p => p!.GetValue<string>()));

        // The cheap tier takes both.
        var cheap = ModelGateway.Prepare(options, credits, Request("build"), options.Routes["build"], stream: true).Body;
        Assert.Equal(0.2, cheap["temperature"]!.GetValue<double>());
        Assert.False(cheap["parallel_tool_calls"]!.GetValue<bool>());
    }

    [Fact]
    public void A_model_that_does_not_list_its_parameters_is_a_fault()
    {
        var options = Shipped();
        options.Models["z-ai/glm-5.2"].SupportedParameters.Clear();
        Assert.Contains(options.Validate(), f => f.Contains("z-ai/glm-5.2", StringComparison.Ordinal) && f.Contains("SupportedParameters", StringComparison.Ordinal));
    }
}
