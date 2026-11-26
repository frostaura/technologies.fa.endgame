using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Runs;
using Endgame.Harness;
using Endgame.Harness.Kernel;
using Endgame.Runner.Execution;

namespace Endgame.Runner.Workflows;

/// <summary>
/// Turns the judge's answer and the strands' reports into the one verdict document ARCH-004 defines
/// (<see cref="VerdictDocument"/>): a strict parse-and-repair. Code repairs only what it can do without
/// inventing anything — shapes, slugs, sources, counts — and applies the rules a flattering model would
/// bend. What only the judge can say (the case against, the evidence) is left as a fault for it to fix.
/// </summary>
public static class VerdictBuilder
{
    /// <summary>The document, and the faults that remain (empty when it is valid).</summary>
    public static (JsonObject? Document, IReadOnlyList<string> Faults) Build(JsonObject? judge, VerdictContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (judge is null)
        {
            return (null, ["The reply was not one JSON object. Reply with only the JSON object, every key present."]);
        }

        var rules = new List<string>();
        var outcome = Outcome(Json.Str(judge, "outcome"));
        if (outcome is null)
        {
            rules.Add($"The judge's outcome '{OutputText.Truncate(Json.Str(judge, "outcome") ?? "none", 40)}' is not a verdict, and an unreadable verdict counts as do not build.");
            outcome = Verdicts.DoNotBuild;
        }

        // Every product any strand found is named, whether the judge mentioned it or not.
        var products = new JsonArray();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void AddProduct(JsonNode? node, string fallbackWhat)
        {
            var (name, what, url) = node switch
            {
                JsonObject o => (Json.Str(o, "name"), Json.Str(o, "what") ?? Json.Str(o, "description"), Json.Str(o, "url")),
                JsonValue v when v.GetValueKind() == JsonValueKind.String => (v.GetValue<string>(), null, null),
                _ => (null, null, null),
            };
            name = name?.Trim();
            if (string.IsNullOrEmpty(name) || products.Count >= 40 || !names.Add(name))
            {
                return;
            }

            products.Add(new JsonObject
            {
                ["name"] = Clip(name, 120),
                ["what"] = Clip(string.IsNullOrWhiteSpace(what) ? fallbackWhat : what, 300),
                ["url"] = SourcePool.Normalise(url),
            });
        }

        foreach (var product in judge["existing"]?["products"] as JsonArray ?? judge["existing"] as JsonArray ?? [])
        {
            AddProduct(product, "Named by the research as doing this or part of it.");
        }

        foreach (var strand in context.Strands)
        {
            foreach (var product in strand.Report?["products"] as JsonArray ?? [])
            {
                AddProduct(product, $"Found while the research {strand.Title.ToLowerInvariant()}.");
            }
        }

        // Missing evidence of demand is a reason not to build.
        var demandStrand = context.Strands.FirstOrDefault(s => s.Id == "demand");
        var demandFindings = Json.Strings(demandStrand?.Report, "findings");
        var demandEvidence = Text(judge["demand"], "evidence");
        var signals = Json.Strings(judge["demand"] as JsonObject, "signals").Concat(demandFindings).Select(t => Clip(t, 300)).Where(t => t.Length > 0).Distinct(StringComparer.Ordinal).Take(20).ToList();
        var noDemand = string.IsNullOrWhiteSpace(demandEvidence) || (demandStrand is not null && demandFindings.Count == 0);
        if (noDemand && outcome == Verdicts.Build)
        {
            rules.Add("No evidence of demand was found, and missing demand counts against building, so the verdict is do not build.");
            outcome = Verdicts.DoNotBuild;
        }

        // A red line is never built, whatever the market says.
        var lines = judge["redLines"] as JsonObject ?? judge["redLine"] as JsonObject;
        var breached = lines?["breached"]?.GetValueKind() == JsonValueKind.True;
        var line = breached ? RedLine(Json.Str(lines, "line") ?? Json.Str(lines, "reasoning")) : null;
        if (breached && outcome != Verdicts.DoNotBuild)
        {
            rules.Add($"The idea crosses a red line ({line ?? "unnamed"}), and FrostAura never builds it.");
            outcome = Verdicts.DoNotBuild;
        }

        var summary = Text(judge, "summary");
        var placementIn = judge["placement"] as JsonObject;
        var name = Clip(Json.Str(placementIn, "name") is { Length: > 0 } n ? n : Title(context.Idea), 60);
        var defaultDivision = context.Scope.Split('/') is { Length: > 1 } parts ? parts[1] : "labs";
        var document = new JsonObject
        {
            ["outcome"] = outcome,
            ["headline"] = Clip(Text(judge, "headline") is { Length: > 0 } h ? h : Sentences.First(summary, 200), 200),
            ["summary"] = Clip(Sentences.Join([summary], rules), 4000),
            ["against"] = Clip(Text(judge, "against"), 2000),
            ["suggestedChange"] = outcome == Verdicts.Change ? Clip(Text(judge, "suggestedChange") ?? Text(judge, "change"), 1000) : null,
            ["existing"] = new JsonObject
            {
                ["evidence"] = Clip(Text(judge["existing"], "evidence") ?? (products.Count == 0 ? "The research found no existing product that does this." : null), 2000),
                ["products"] = products,
                ["sources"] = Json.Array(context.Sources.Take(60)),
            },
            ["gap"] = new JsonObject { ["evidence"] = Clip(Text(judge["gap"], "evidence") ?? (judge["gap"] is JsonValue g ? g.ToString() : null), 2000) },
            ["demand"] = new JsonObject
            {
                ["evidence"] = Clip(string.IsNullOrWhiteSpace(demandEvidence) ? "No evidence of demand was found." : demandEvidence, 2000),
                ["signals"] = Json.Array(signals),
            },
            ["wouldChange"] = Clip(Text(judge, "wouldChange"), 1000),
            ["redLines"] = new JsonObject
            {
                ["breached"] = breached,
                ["line"] = line,
                ["reasoning"] = Clip(Json.Str(lines, "reasoning"), 1000),
            },
            ["placement"] = new JsonObject
            {
                ["division"] = WorkflowSupport.Slug(Json.Str(placementIn, "division"), defaultDivision),
                ["project"] = WorkflowSupport.Slug(Json.Str(placementIn, "project") ?? name, WorkflowSupport.Slug(name, "project")),
                ["app"] = WorkflowSupport.Slug(Json.Str(placementIn, "app"), "web"),
                ["name"] = name,
            },
            ["method"] = Method(judge, context),
            ["rulesApplied"] = Json.Array(rules.Select(r => Clip(r, 500)).Take(10)),
        };

        // Nothing is invented: what only the judge can say, and did not, is a fault for it to fix.
        Drop(document, "against");
        Drop(document, "wouldChange");
        Drop(document["existing"]!.AsObject(), "evidence");
        Drop(document["gap"]!.AsObject(), "evidence");
        Drop(document["redLines"]!.AsObject(), "reasoning");
        if (breached && line is null)
        {
            document["redLines"]!["line"] = "unnamed";
        }

        if (outcome == Verdicts.Change && document["suggestedChange"] is null)
        {
            document.Remove("suggestedChange");
        }

        if (string.IsNullOrWhiteSpace(summary))
        {
            document.Remove("summary");
            if (string.IsNullOrWhiteSpace(Text(judge, "headline")))
            {
                document.Remove("headline");
            }
        }

        var faults = VerdictDocument.Validate(document);
        return (document, faults);
    }

    public static string? Outcome(string? raw) => (raw ?? "").Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-').Replace("'", "", StringComparison.Ordinal) switch
    {
        "build" => Verdicts.Build,
        "change" or "build-changed" or "build-with-changes" => Verdicts.Change,
        "do-not-build" or "dont-build" or "no-build" or "not-build" => Verdicts.DoNotBuild,
        _ => null,
    };

    /// <summary>A red line named in the judge's words, as one of ARCH-004's four.</summary>
    public static string? RedLine(string? text)
    {
        var t = (text ?? "").ToLowerInvariant();
        return VerdictDocument.RedLines.FirstOrDefault(l => l == t)
            ?? (t.Contains("tobacco", StringComparison.Ordinal) || t.Contains("gambl", StringComparison.Ordinal) || t.Contains("financ", StringComparison.Ordinal) ? "tobacco-gambling-finance"
            : t.Contains("weapon", StringComparison.Ordinal) ? "weapons"
            : t.Contains("animal", StringComparison.Ordinal) || t.Contains("cruelty", StringComparison.Ordinal) ? "animal-harm"
            : t.Contains("surveil", StringComparison.Ordinal) || t.Contains("authoritarian", StringComparison.Ordinal) || t.Contains("track", StringComparison.Ordinal) ? "surveillance"
            : null);
    }

    public static string? Confidence(string? raw) => (raw ?? "").Trim().ToLowerInvariant() is "low" or "medium" or "high" ? raw!.Trim().ToLowerInvariant() : null;

    /// <summary>The idea's first line, as a short title.</summary>
    public static string Title(string idea)
    {
        var first = (idea ?? "").Split('\n')[0].Trim();
        var end = first.IndexOfAny([':', '.']);
        var title = end is > 10 and < 80 ? first[..end] : first;
        return title.Length <= 60 ? title : title[..57].TrimEnd() + "...";
    }

    /// <summary>One plain sentence of what a strand found, for the owner.</summary>
    public static string StrandSummary(string strand, JsonObject? report, AgentResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (result.Unreachable)
        {
            // Not its form: the models were not reached, so it had nothing to report (D64).
            return "It could not reach Endgame's AI models, so it found nothing.";
        }

        if (report is null)
        {
            return "It did not report back in the agreed form, so its work is not counted.";
        }

        var products = (report["products"] as JsonArray ?? []).Select(p => p is JsonObject o ? Json.Str(o, "name") : p?.ToString()).OfType<string>().Where(n => n.Length > 0).ToList();
        var findings = Json.Strings(report, "findings");
        var searches = result.State.Searches == 1 ? "1 search" : $"{result.State.Searches} searches";
        return strand switch
        {
            "existing" when products.Count > 0 => Sentences.Plain($"Found {products.Count} existing product{(products.Count == 1 ? "" : "s")}, among them {string.Join(", ", products.Take(3))}, in {searches}", 300),
            "existing" => Sentences.Plain($"Found no existing product that does this, in {searches}", 300),
            "demand" when findings.Count == 0 => Sentences.Plain($"Found no evidence that people would pay for it, in {searches}", 300),
            _ when findings.Count == 0 => Sentences.Plain($"Found nothing to report, in {searches}", 300),
            _ => Sentences.Plain($"{findings.Count} finding{(findings.Count == 1 ? "" : "s")} in {searches}; the first: {Sentences.First(findings[0], 200)}", 300),
        };
    }

    private static JsonObject Method(JsonObject judge, VerdictContext context)
    {
        var strands = new JsonArray(context.Strands.Select(s => (JsonNode)new JsonObject
        {
            ["id"] = s.Id,
            ["title"] = s.Title,
            ["searches"] = s.Searches,
            ["sources"] = s.Sources,
            ["confidence"] = s.Confidence,
        }).ToArray());
        string[] order = ["low", "medium", "high"];
        var best = context.Strands.Count == 0 ? 0 : context.Strands.Max(s => Array.IndexOf(order, s.Confidence));
        var judged = Array.IndexOf(order, Confidence(Json.Str(judge, "confidence")) ?? "low");
        return new JsonObject
        {
            ["searches"] = context.Strands.Sum(s => s.Searches),
            ["strands"] = strands,
            ["confidence"] = order[Math.Clamp(Math.Min(judged, best), 0, 2)],
        };
    }

    private static void Drop(JsonObject o, string key)
    {
        if (o[key] is null)
        {
            o.Remove(key);
        }
    }

    private static string? Text(JsonNode? o, string key) => o switch
    {
        JsonObject obj => obj[key] switch
        {
            JsonValue v when v.GetValueKind() == JsonValueKind.String => v.GetValue<string>().Trim(),
            JsonArray a => string.Join(" ", a.OfType<JsonValue>().Where(x => x.GetValueKind() == JsonValueKind.String).Select(x => Sentences.End(x.GetValue<string>().Trim()))),
            JsonObject inner => Text(inner, "evidence") ?? Text(inner, "text"),
            _ => null,
        },
        _ => null,
    };

    private static string Clip(string? text, int max) =>
        string.IsNullOrWhiteSpace(text) ? null! : Sentences.Flatten(text, max);
}
