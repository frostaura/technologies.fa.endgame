namespace Endgame.Domain.Credits;

/// <summary>A per-token price ceiling, in US dollars per million tokens — the unit OpenRouter's <c>max_price</c> takes.</summary>
public sealed record PriceCeiling(decimal PromptPerMillion, decimal CompletionPerMillion, decimal PerRequest = 0m);

/// <summary>
/// ARCH-003 rule 2. OpenRouter has no estimate endpoint and no tokenizer, so the prompt is estimated
/// from its size, output is the clamped maximum, and both are priced at the ceiling the call is sent
/// with — the server cannot route to anything dearer, so the reservation cannot be exceeded.
/// </summary>
public static class ReservationFormula
{
    public const int BytesPerToken = 2;
    public const int TokensPerMessage = 16;
    public const int TokensPerCall = 64;

    public static long EstimatePromptTokens(long promptBytes, int messageCount)
    {
        if (promptBytes < 0 || messageCount < 0)
        {
            throw new DomainException("A prompt cannot have a negative size.");
        }

        return (promptBytes / BytesPerToken) + ((long)TokensPerMessage * messageCount) + TokensPerCall;
    }

    /// <summary>The most a call can cost, in US dollars.</summary>
    /// <param name="searchFeesUsd">Server-side search: max uses × engine fee.</param>
    /// <param name="searchPromptTokens">The prompt growth search results cause.</param>
    public static decimal WorstCaseUsd(long promptTokens, int maxOutputTokens, PriceCeiling ceiling, decimal searchFeesUsd = 0m, long searchPromptTokens = 0)
    {
        ArgumentNullException.ThrowIfNull(ceiling);
        if (maxOutputTokens <= 0)
        {
            throw new DomainException("max_tokens must be clamped to a positive number before a call is reserved.");
        }

        var prompt = (promptTokens + searchPromptTokens) * ceiling.PromptPerMillion / 1_000_000m;
        var completion = maxOutputTokens * ceiling.CompletionPerMillion / 1_000_000m;
        return prompt + completion + ceiling.PerRequest + searchFeesUsd;
    }

    /// <summary>The output limit actually sent: never more than the caller, the route or any model on it allows.</summary>
    public static int ClampMaxTokens(int? requested, int routeMax, int modelMax)
    {
        var limit = Math.Min(routeMax, modelMax);
        if (limit <= 0)
        {
            throw new DomainException("A route's max_tokens must be positive.");
        }

        return requested is > 0 ? Math.Min(requested.Value, limit) : limit;
    }
}
