using System.Text.Json.Nodes;

namespace Endgame.Tests.Fixtures;

/// <summary>Verdict documents in the one shape ARCH-004 defines (<i>The verdict document</i>), for tests that need a valid one.</summary>
public static class VerdictSamples
{
    public static JsonObject Valid(string outcome = "build", string? redLine = null, string product = "Rival") => new()
    {
        ["outcome"] = outcome,
        ["headline"] = "Others already do this",
        ["summary"] = "Against: three products cover it. For: none shares between households. Verdict follows.",
        ["against"] = "Three cheap products already cover most of it.",
        ["suggestedChange"] = outcome == "change" ? "Lead with sharing between households." : null,
        ["existing"] = new JsonObject
        {
            ["evidence"] = "Three products do most of this.",
            ["products"] = new JsonArray(new JsonObject { ["name"] = product, ["what"] = "Does most of it", ["url"] = "https://rival.example" }),
            ["sources"] = new JsonArray("https://rival.example"),
        },
        ["gap"] = new JsonObject { ["evidence"] = "None shares between households." },
        ["demand"] = new JsonObject { ["evidence"] = "Families asked for it on two forums.", ["signals"] = new JsonArray("A forum thread asking for it") },
        ["wouldChange"] = "A household-sharing feature in any of them.",
        ["redLines"] = new JsonObject
        {
            ["breached"] = redLine is not null,
            ["line"] = redLine,
            ["reasoning"] = redLine is null ? "It harms no one." : "It watches people against their interest.",
        },
        ["placement"] = new JsonObject { ["division"] = "technologies", ["project"] = "recipe-box", ["app"] = "web", ["name"] = "Recipe Box" },
        ["method"] = new JsonObject
        {
            ["searches"] = 3,
            ["strands"] = new JsonArray(
                new JsonObject { ["id"] = "existing", ["title"] = "Looked for existing products", ["searches"] = 2, ["sources"] = 1, ["confidence"] = "medium" },
                new JsonObject { ["id"] = "demand", ["title"] = "Looked for evidence people will pay", ["searches"] = 1, ["sources"] = 0, ["confidence"] = "low" }),
            ["confidence"] = "low",
        },
        ["rulesApplied"] = new JsonArray(),
    };
}
