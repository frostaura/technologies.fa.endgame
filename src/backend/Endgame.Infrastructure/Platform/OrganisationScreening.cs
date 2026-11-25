using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Runs;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;

namespace Endgame.Infrastructure.Platform;

/// <summary>Platform costs, kept in <c>platform_costs</c> as the platform: no organisation pays for them.</summary>
public sealed class PlatformCostLedger(EndgameDbContext db, TenantSession session, TimeProvider clock) : IPlatformCosts
{
    public async Task RecordAsync(PlatformCost cost, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(cost);
        session.UseSystem();
        db.PlatformCosts.Add(new PlatformCostRecord
        {
            Id = Guid.NewGuid(),
            Purpose = cost.Purpose,
            Model = cost.Model is { Length: > 200 } m ? m[..200] : cost.Model,
            GenerationId = cost.GenerationId is { Length: > 200 } g ? g[..200] : cost.GenerationId,
            CostUsd = cost.CostUsd,
            DetailJson = cost.Detail.ToJsonString(),
            By = cost.By,
            At = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(cancellationToken);
        db.ChangeTracker.Clear();
        session.Clear();
    }
}

/// <summary>An operator's own screening, recorded when no model can be reached.</summary>
/// <param name="Decision"><c>clear</c> (no red line is crossed) or <c>breach</c>.</param>
/// <param name="Line">For a breach: which line, one of <see cref="VerdictDocument.RedLines"/>.</param>
public sealed record ManualScreening(string? Decision, string? Reason, string? Line = null);

/// <summary>How an organisation was screened before it was set up.</summary>
/// <param name="Method"><c>model</c> or <c>manual</c>.</param>
/// <param name="Line">The breached line, when one is.</param>
public sealed record ScreeningResult(string Method, bool Breached, string? Line, string Reason, string? Model, decimal CostUsd, Guid By, DateTimeOffset At)
{
    /// <summary>What is written to the new organisation's operator log.</summary>
    public JsonObject ToDetail() => new()
    {
        ["method"] = Method,
        ["result"] = Breached ? "breach" : "clear",
        ["line"] = Line,
        ["reason"] = Reason,
        ["model"] = Model,
        ["costUsd"] = CostUsd,
        ["by"] = By.ToString(),
        ["at"] = At,
    };
}

/// <summary>
/// Provisioning screens the organisation (CLAUDE.md rule 4): what it says it does is put to a model
/// against FrostAura's four red lines, as a platform cost charged to no organisation. A breach refuses
/// it, naming the line and why. If no model can be reached the operator may record their own decision
/// with a written reason; without one, provisioning is refused. A model's answer always outranks a
/// manual decision, which is only taken when there is no answer.
/// </summary>
public sealed class OrganisationScreening(PlatformModelCalls calls, TimeProvider clock)
{
    public const string Purpose = "organisation.screening";
    public const string TaskType = "classify";
    public const int MinDescription = 10;
    public const int MaxDescription = 1000;
    public const int MinReason = 10;

    /// <summary>Each line's name as people read it.</summary>
    public static readonly IReadOnlyDictionary<string, string> LineNames = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["tobacco-gambling-finance"] = "tobacco, exploitative gambling or predatory finance",
        ["weapons"] = "weapons used against civilians",
        ["animal-harm"] = "animal harm and industrial cruelty",
        ["surveillance"] = "surveillance and authoritarian tooling",
    };

    private const string Instructions = """
        You screen a new organisation for FrostAura before it is set up. FrostAura refuses to host, build for,
        fund or serve anything that falls on one of four red lines:
        1. "tobacco-gambling-finance": tobacco; exploitative gambling (casinos, slot machines, sports betting,
           loot boxes sold to the vulnerable); predatory finance (payday loans, loan sharking, schemes that
           profit from people's debt). Prediction markets and regulated forecasting or event markets are NOT
           gambling: they are information markets and are allowed.
        2. "weapons": weapons, or tooling, made to be used against civilians.
        3. "animal-harm": animal harm and industrial cruelty.
        4. "surveillance": surveillance of people and authoritarian tooling (tracking, profiling or
           suppressing citizens, dissidents or employees without their consent).
        Judge by the direction of effect: does what the organisation does push harm in one of these ways?
        Answer only with one JSON object and nothing else:
        {"breached": true or false, "line": one of the four keys above or null, "reason": "one or two plain sentences"}
        """;

    public async Task<ScreeningResult> ScreenAsync(string name, string slug, string? description, ManualScreening? manual, Guid by, CancellationToken cancellationToken)
    {
        var what = description?.Trim() ?? "";
        if (what.Length < MinDescription || what.Length > MaxDescription)
        {
            throw EndgameProblem.Invalid($"Say what the organisation does, in {MinDescription} to {MaxDescription} characters: it is screened against FrostAura's red lines before it is set up.");
        }

        ScreeningResult? result = null;
        string why;
        try
        {
            var reply = await calls.CompleteAsync(new ChatRequest
            {
                TaskType = TaskType,
                Scope = "",
                Messages =
                [
                    new JsonObject { ["role"] = "system", ["content"] = Instructions },
                    new JsonObject { ["role"] = "user", ["content"] = $"Name: {name}\nAddress name: {slug}\nWhat it does: {what}" },
                ],
                Limits = new ChatLimits { MaxTokens = 400 },
                Temperature = 0,
            }, Purpose, by, new JsonObject { ["organisation"] = slug, ["name"] = name }, cancellationToken);
            result = Read(reply, by);
            why = "the model's answer could not be read";
        }
        catch (EndgameProblem problem) when (problem.Status is 502 or 503)
        {
            why = "no model could be reached";
        }

        result ??= Manual(manual, by, why);
        if (result.Breached)
        {
            var line = result.Line is { } l && LineNames.TryGetValue(l, out var named) ? named : "one of FrostAura's red lines";
            var refusal = new EndgameProblem(422, "red_line", "FrostAura does not set this organisation up", $"What it does crosses a red line — {line}: {result.Reason}");
            refusal.Extensions["line"] = result.Line;
            refusal.Extensions["method"] = result.Method;
            throw refusal;
        }

        return result;
    }

    private ScreeningResult? Read(PlatformReply reply, Guid by)
    {
        var text = reply.Content.Trim();
        var start = text.IndexOf('{', StringComparison.Ordinal);
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start)
        {
            return null;
        }

        try
        {
            var answer = JsonNode.Parse(text[start..(end + 1)]) as JsonObject;
            if (answer?["breached"] is not JsonValue breachedValue || !breachedValue.TryGetValue<bool>(out var breached))
            {
                return null;
            }

            var line = answer["line"]?.ToString();
            var reason = answer["reason"]?.ToString() is { Length: > 0 } r ? (r.Length > 1000 ? r[..1000] : r) : (breached ? "It crosses a red line." : "It crosses none of the red lines.");
            return new ScreeningResult("model", breached, breached ? (line is not null && LineNames.ContainsKey(line) ? line : null) : null, reason, reply.Model, reply.CostUsd, by, clock.GetUtcNow());
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private ScreeningResult Manual(ManualScreening? manual, Guid by, string why)
    {
        if (manual is null)
        {
            throw new EndgameProblem(503, "screening_unavailable", "The organisation could not be screened",
                $"It is screened against FrostAura's red lines before it is set up, and {why}. Try again shortly, or record your own screening decision with a written reason.");
        }

        if (manual.Decision is not ("clear" or "breach"))
        {
            throw EndgameProblem.Invalid("A manual screening decides 'clear' (no red line is crossed) or 'breach'.");
        }

        var reason = manual.Reason?.Trim() ?? "";
        if (reason.Length < MinReason || reason.Length > 1000)
        {
            throw EndgameProblem.Invalid($"A manual screening needs a written reason of {MinReason} to 1000 characters.");
        }

        var breached = manual.Decision == "breach";
        var line = breached && manual.Line is { } l && LineNames.ContainsKey(l) ? l : null;
        return new ScreeningResult("manual", breached, line, reason, null, 0m, by, clock.GetUtcNow());
    }
}
