using System.Text.RegularExpressions;

namespace Endgame.Application.Gateway;

/// <summary>
/// The routing table (ARCH-003, <i>Routing table shape</i>), bound from the <c>ModelGateway</c>
/// configuration section and validated when the host starts — an unknown model id, a missing reasoning
/// setting or an unclamped output limit stops the control plane rather than failing a live call.
/// </summary>
public sealed partial class ModelGatewayOptions
{
    public const string SectionName = "ModelGateway";

    public string BaseUrl { get; set; } = "https://openrouter.ai";

    /// <summary>Sent as OpenRouter's attribution headers. Never a person's details.</summary>
    public string AppTitle { get; set; } = "FrostAura Endgame";

    public string AppUrl { get; set; } = "https://endgame.frostaura.net";

    public int RequestTimeoutSeconds { get; set; } = 300;

    /// <summary>How long to keep asking for a generation record when a reply carried no cost figure.</summary>
    public int GenerationLookupSeconds { get; set; } = 20;

    /// <summary>The validated catalogue. A route may only name a model listed here.</summary>
    public Dictionary<string, ModelEntry> Models { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Task type → route.</summary>
    public Dictionary<string, ModelRoute> Routes { get; set; } = new(StringComparer.Ordinal);

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._:-]*$", RegexOptions.CultureInvariant)]
    private static partial Regex ModelIdPattern();

    [GeneratedRegex("^[a-z][a-z0-9_.-]{0,59}$", RegexOptions.CultureInvariant)]
    private static partial Regex TaskTypePattern();

    public static readonly IReadOnlyList<string> ReasoningSettings = ["off", "minimal", "low", "medium", "high"];

    public static readonly IReadOnlyList<string> SortOrders = ["price", "throughput", "latency"];

    /// <summary>Every rule a routing table must satisfy, as a list of faults. Empty when it is valid.</summary>
    public IReadOnlyList<string> Validate()
    {
        var faults = new List<string>();
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out _))
        {
            faults.Add("ModelGateway:BaseUrl is not an absolute address.");
        }

        foreach (var (id, model) in Models)
        {
            if (!ModelIdPattern().IsMatch(id))
            {
                faults.Add($"Model id '{id}' is not a valid OpenRouter id.");
            }

            if (model.MaxOutputTokens <= 0)
            {
                faults.Add($"Model '{id}' needs a positive MaxOutputTokens (its provider's limit).");
            }
        }

        if (Routes.Count == 0)
        {
            faults.Add("ModelGateway:Routes is empty; every model call needs a route for its task type.");
        }

        foreach (var (taskType, route) in Routes)
        {
            var at = $"Route '{taskType}'";
            if (!TaskTypePattern().IsMatch(taskType))
            {
                faults.Add($"{at}: a task type is lower-case letters, digits, dots, hyphens and underscores.");
            }

            if (route.Models.Count == 0)
            {
                faults.Add($"{at} names no model.");
            }

            faults.AddRange(route.Models.Where(m => !Models.ContainsKey(m)).Select(m => $"{at} names '{m}', which is not in the validated catalogue."));
            if (route.Models.Count != route.Models.Distinct(StringComparer.Ordinal).Count())
            {
                faults.Add($"{at} names a model twice.");
            }

            if (route.MaxPromptPerMillionUsd <= 0 || route.MaxCompletionPerMillionUsd <= 0)
            {
                faults.Add($"{at} needs a positive price ceiling for prompt and completion tokens.");
            }

            if (route.MaxRequestUsd < 0)
            {
                faults.Add($"{at}: MaxRequestUsd cannot be negative.");
            }

            if (route.MaxTokens <= 0)
            {
                faults.Add($"{at} needs a positive MaxTokens: output is always clamped.");
            }

            if (route.MaxCallUsd <= 0)
            {
                faults.Add($"{at} needs a positive MaxCallUsd: the most one call may reserve.");
            }

            if (route.Reasoning is null || !ReasoningSettings.Contains(route.Reasoning))
            {
                faults.Add($"{at} must set Reasoning explicitly to one of {string.Join(", ", ReasoningSettings)}.");
            }

            if (!SortOrders.Contains(route.Sort))
            {
                faults.Add($"{at}: Sort must be one of {string.Join(", ", SortOrders)}.");
            }

            if (route.WebSearch is { } search
                && (search.MaxResults <= 0 || search.MaxUses <= 0 || search.FeePerResultUsd < 0 || search.PromptTokensPerResult <= 0 || string.IsNullOrWhiteSpace(search.Engine)))
            {
                faults.Add($"{at}: WebSearch needs an engine, positive MaxResults, MaxUses and PromptTokensPerResult, and a fee.");
            }
        }

        return faults;
    }
}

/// <summary>One validated model id and the most output any of its providers will produce.</summary>
public sealed class ModelEntry
{
    public int MaxOutputTokens { get; set; }

    public int ContextLength { get; set; }
}

public sealed class ModelRoute
{
    /// <summary>Ordered: the first is preferred; the rest are fallbacks within the same ceiling.</summary>
    public List<string> Models { get; set; } = [];

    /// <summary>The provider price ceiling sent as <c>provider.max_price</c>, in US$ per million tokens.</summary>
    public decimal MaxPromptPerMillionUsd { get; set; }

    public decimal MaxCompletionPerMillionUsd { get; set; }

    public decimal MaxRequestUsd { get; set; }

    public string Sort { get; set; } = "price";

    /// <summary><c>off</c>, or an effort: <c>minimal</c>, <c>low</c>, <c>medium</c>, <c>high</c>. Never left to a model's default.</summary>
    public string? Reasoning { get; set; }

    public int MaxTokens { get; set; }

    public bool ParallelToolCalls { get; set; }

    /// <summary>The most one call on this route may reserve, in US dollars, checked before sending.</summary>
    public decimal MaxCallUsd { get; set; }

    public WebSearchOptions? WebSearch { get; set; }
}

/// <summary>OpenRouter's server-side web search, offered on a route as a tool the model may call.</summary>
public sealed class WebSearchOptions
{
    public string Engine { get; set; } = "parallel";

    public int MaxResults { get; set; } = 3;

    public int MaxUses { get; set; } = 1;

    /// <summary>The engine's fee per result, in US dollars, reserved for every result the model may fetch.</summary>
    public decimal FeePerResultUsd { get; set; }

    /// <summary>How much each result may grow the prompt, reserved in prompt tokens.</summary>
    public int PromptTokensPerResult { get; set; } = 1500;
}

/// <summary>How credits relate to money: priced at what the work costs plus one fixed margin.</summary>
public sealed class CreditOptions
{
    public const string SectionName = "Credits";

    public decimal CreditsPerUsd { get; set; } = 100m;

    /// <summary>The fixed margin over cost, as a fraction (0.2 is 20 %).</summary>
    public decimal Margin { get; set; }

    /// <summary>How long a reservation for a call without a run stays held.</summary>
    public int ReservationMinutes { get; set; } = 15;

    /// <summary>A settlement: what the work cost, in credits, to the micro-credit.</summary>
    public decimal ToCredits(decimal usd) => decimal.Round(usd * CreditsPerUsd * (1m + Margin), 6, MidpointRounding.AwayFromZero);

    /// <summary>A reservation: rounded up, so it is never below the cost it covers.</summary>
    public decimal ToCreditsCeiling(decimal usd) => Math.Ceiling(usd * CreditsPerUsd * (1m + Margin) * 1_000_000m) / 1_000_000m;
}
