using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Tree;

namespace Endgame.Domain.Runs;

/// <summary>
/// Research's verdict document, exactly as ARCH-004 (<i>The verdict document</i>) defines it: every key
/// present with exactly its type, no other key at any depth, and the cross-field rules. The control plane
/// refuses anything else; the Runner checks its own document with the same code before it posts, and
/// gives the faults to the judge for one corrected attempt.
/// </summary>
public static class VerdictDocument
{
    public const int MaxErrors = 50;

    /// <summary>The red lines a verdict may name (CLAUDE.md rule 4; FrostAura's four refusals).</summary>
    public static readonly IReadOnlyList<string> RedLines = ["tobacco-gambling-finance", "weapons", "animal-harm", "surveillance"];

    public static readonly IReadOnlyList<string> Confidences = ["low", "medium", "high"];

    private static readonly string[] TopKeys =
        ["outcome", "headline", "summary", "against", "suggestedChange", "existing", "gap", "demand", "wouldChange", "redLines", "placement", "method", "rulesApplied"];

    /// <summary>Every fault in the document, one line each (<c>path: what is wrong and what is expected</c>); empty when it is valid.</summary>
    public static IReadOnlyList<string> Validate(JsonNode? document)
    {
        var v = new Checker();
        if (document is not JsonObject doc)
        {
            v.Fault("$", "the verdict is a JSON object");
            return v.Errors;
        }

        v.Keys(doc, "", TopKeys);
        var outcome = v.Enum(doc, "outcome", Verdicts.All);
        v.Text(doc, "headline", 1, 200);
        v.Text(doc, "summary", 1, 4000);
        v.Text(doc, "against", 1, 2000);
        if (v.Present(doc, "suggestedChange"))
        {
            if (outcome == Verdicts.Change)
            {
                v.Text(doc, "suggestedChange", 1, 1000, why: "a string of 1 to 1000 characters saying what to change, because the outcome is \"change\"");
            }
            else if (doc["suggestedChange"] is not null)
            {
                v.Fault("suggestedChange", "null unless the outcome is \"change\"");
            }
        }

        if (v.Object(doc, "existing") is { } existing)
        {
            v.Keys(existing, "existing.", ["evidence", "products", "sources"]);
            v.Text(existing, "evidence", 1, 2000, "existing.");
            if (v.Array(existing, "products", 0, 40, "existing.") is { } products)
            {
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < products.Count; i++)
                {
                    var at = $"existing.products[{i}].";
                    if (products[i] is not JsonObject product)
                    {
                        v.Fault(at.TrimEnd('.'), "an object { name, what, url }");
                        continue;
                    }

                    v.Keys(product, at, ["name", "what", "url"]);
                    if (v.Text(product, "name", 1, 120, at) is { } name && !names.Add(name))
                    {
                        v.Fault(at + "name", $"unique: '{name}' is named twice");
                    }

                    v.Text(product, "what", 1, 300, at);
                    if (v.Present(product, "url", at) && product["url"] is not null)
                    {
                        v.Text(product, "url", 1, 500, at, why: "an address of 1 to 500 characters, or null when there is none (never \"\")");
                    }
                }
            }

            v.StringList(existing, "sources", 0, 60, 1, 500, "existing.", unique: true);
        }

        if (v.Object(doc, "gap") is { } gap)
        {
            v.Keys(gap, "gap.", ["evidence"]);
            v.Text(gap, "evidence", 1, 2000, "gap.");
        }

        if (v.Object(doc, "demand") is { } demand)
        {
            v.Keys(demand, "demand.", ["evidence", "signals"]);
            v.Text(demand, "evidence", 1, 2000, "demand.");
            v.StringList(demand, "signals", 0, 20, 1, 300, "demand.");
        }

        v.Text(doc, "wouldChange", 1, 1000);
        if (v.Object(doc, "redLines") is { } lines)
        {
            v.Keys(lines, "redLines.", ["breached", "line", "reasoning"]);
            var breached = v.Bool(lines, "breached", "redLines.");
            if (v.Present(lines, "line", "redLines."))
            {
                if (breached == true)
                {
                    v.Enum(lines, "line", RedLines, "redLines.", why: $"the breached line: one of {Quote(RedLines)}");
                }
                else if (breached == false && lines["line"] is not null)
                {
                    v.Fault("redLines.line", "null when no red line is breached");
                }
            }

            v.Text(lines, "reasoning", 1, 1000, "redLines.");
            if (breached == true && outcome is not null && outcome != Verdicts.DoNotBuild)
            {
                v.Fault("outcome", "\"do-not-build\": a breached red line is never built");
            }
        }

        if (v.Object(doc, "placement") is { } placement)
        {
            v.Keys(placement, "placement.", ["division", "project", "app", "name"]);
            foreach (var key in new[] { "division", "project", "app" })
            {
                v.Slug(placement, key, "placement.");
            }

            v.Text(placement, "name", 1, 60, "placement.");
        }

        if (v.Object(doc, "method") is { } method)
        {
            v.Keys(method, "method.", ["searches", "strands", "confidence"]);
            var searches = v.Count(method, "searches", "method.");
            v.Enum(method, "confidence", Confidences, "method.");
            if (v.Array(method, "strands", 1, 6, "method.") is { } strands)
            {
                var ids = new HashSet<string>(StringComparer.Ordinal);
                var sum = 0;
                var counted = true;
                for (var i = 0; i < strands.Count; i++)
                {
                    var at = $"method.strands[{i}].";
                    if (strands[i] is not JsonObject strand)
                    {
                        v.Fault(at.TrimEnd('.'), "an object { id, title, searches, sources, confidence }");
                        counted = false;
                        continue;
                    }

                    v.Keys(strand, at, ["id", "title", "searches", "sources", "confidence"]);
                    if (v.Text(strand, "id", 1, 40, at) is { } id && !ids.Add(id))
                    {
                        v.Fault(at + "id", $"unique: '{id}' appears twice");
                    }

                    v.Text(strand, "title", 1, 80, at);
                    if (v.Count(strand, "searches", at) is { } n)
                    {
                        sum += n;
                    }
                    else
                    {
                        counted = false;
                    }

                    v.Count(strand, "sources", at);
                    v.Enum(strand, "confidence", Confidences, at);
                }

                if (counted && searches is { } total && total != sum)
                {
                    v.Fault("method.searches", string.Create(CultureInfo.InvariantCulture, $"the sum of the strands' searches ({sum}), not {total}"));
                }
            }
        }

        v.StringList(doc, "rulesApplied", 0, 10, 1, 500);
        return v.Errors;
    }

    private static string Quote(IEnumerable<string> values) => string.Join(", ", values.Select(s => $"\"{s}\""));

    private sealed class Checker
    {
        public List<string> Errors { get; } = [];

        public void Fault(string path, string expected)
        {
            if (Errors.Count < MaxErrors)
            {
                Errors.Add($"{path}: {expected}");
            }
        }

        public void Keys(JsonObject o, string prefix, IReadOnlyList<string> allowed)
        {
            foreach (var key in o.Select(kv => kv.Key).Where(k => !allowed.Contains(k)))
            {
                Fault(prefix + key, $"not part of the verdict document; the keys here are {string.Join(", ", allowed)}");
            }
        }

        public bool Present(JsonObject o, string key, string prefix = "")
        {
            if (o.ContainsKey(key))
            {
                return true;
            }

            Fault(prefix + key, "required");
            return false;
        }

        public string? Text(JsonObject o, string key, int min, int max, string prefix = "", string? why = null)
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            var expected = why ?? (min == 0 ? $"a string of at most {max} characters" : $"a string of {min} to {max} characters");
            if (o[key] is not JsonValue value || value.GetValueKind() != JsonValueKind.String)
            {
                Fault(prefix + key, expected + $", not {Kind(o[key])}");
                return null;
            }

            var text = value.GetValue<string>().Trim();
            if (text.Length < min || text.Length > max)
            {
                Fault(prefix + key, expected + string.Create(CultureInfo.InvariantCulture, $" (this one has {text.Length})"));
                return null;
            }

            return text;
        }

        public string? Enum(JsonObject o, string key, IReadOnlyList<string> allowed, string prefix = "", string? why = null)
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            if (o[key] is JsonValue value && value.GetValueKind() == JsonValueKind.String && allowed.Contains(value.GetValue<string>()))
            {
                return value.GetValue<string>();
            }

            Fault(prefix + key, (why ?? $"one of {Quote(allowed)}") + $", not {Describe(o[key])}");
            return null;
        }

        public bool? Bool(JsonObject o, string key, string prefix = "")
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            switch (o[key]?.GetValueKind())
            {
                case JsonValueKind.True:
                    return true;
                case JsonValueKind.False:
                    return false;
                default:
                    Fault(prefix + key, $"true or false, not {Describe(o[key])}");
                    return null;
            }
        }

        public int? Count(JsonObject o, string key, string prefix = "")
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            if (o[key] is JsonValue value && value.GetValueKind() == JsonValueKind.Number && value.TryGetValue<int>(out var n) && n >= 0)
            {
                return n;
            }

            Fault(prefix + key, $"a whole number, 0 or more, not {Describe(o[key])}");
            return null;
        }

        public JsonObject? Object(JsonObject o, string key, string prefix = "")
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            if (o[key] is JsonObject inner)
            {
                return inner;
            }

            Fault(prefix + key, $"an object, not {Kind(o[key])}");
            return null;
        }

        public JsonArray? Array(JsonObject o, string key, int min, int max, string prefix = "")
        {
            if (!Present(o, key, prefix))
            {
                return null;
            }

            if (o[key] is not JsonArray array)
            {
                Fault(prefix + key, $"an array, not {Kind(o[key])}");
                return null;
            }

            if (array.Count < min || array.Count > max)
            {
                Fault(prefix + key, string.Create(CultureInfo.InvariantCulture, $"{min} to {max} entries (this one has {array.Count})"));
                return null;
            }

            return array;
        }

        public void StringList(JsonObject o, string key, int min, int max, int minLength, int maxLength, string prefix = "", bool unique = false)
        {
            if (Array(o, key, min, max, prefix) is not { } array)
            {
                return;
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < array.Count; i++)
            {
                var at = string.Create(CultureInfo.InvariantCulture, $"{prefix}{key}[{i}]");
                if (array[i] is not JsonValue value || value.GetValueKind() != JsonValueKind.String)
                {
                    Fault(at, $"a string, not {Kind(array[i])}");
                    continue;
                }

                var text = value.GetValue<string>().Trim();
                if (text.Length < minLength || text.Length > maxLength)
                {
                    Fault(at, string.Create(CultureInfo.InvariantCulture, $"a string of {minLength} to {maxLength} characters (this one has {text.Length})"));
                }
                else if (unique && !seen.Add(text))
                {
                    Fault(at, $"unique: '{text}' is listed twice");
                }
            }
        }

        public void Slug(JsonObject o, string key, string prefix)
        {
            if (Text(o, key, SlugRules.MinLength, SlugRules.MaxLength, prefix, why: "a slug: 2 to 40 lower-case letters, digits and single hyphens") is { } slug && !SlugRules.IsValid(slug))
            {
                Fault(prefix + key, $"a slug: 2 to 40 lower-case letters, digits and single hyphens, not '{slug}'");
            }
        }

        private static string Kind(JsonNode? node) => node switch
        {
            null => "null",
            JsonObject => "an object",
            JsonArray => "an array",
            JsonValue v => v.GetValueKind() switch
            {
                JsonValueKind.String => "a string",
                JsonValueKind.Number => "a number",
                JsonValueKind.True or JsonValueKind.False => "a boolean",
                _ => "a value",
            },
            _ => "a value",
        };

        private static string Describe(JsonNode? node)
        {
            if (node is JsonValue v && v.GetValueKind() == JsonValueKind.String)
            {
                var text = v.GetValue<string>();
                return $"\"{(text.Length > 60 ? text[..57] + "..." : text)}\"";
            }

            return node is JsonValue n && n.GetValueKind() is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False
                ? node.ToJsonString()
                : Kind(node);
        }
    }
}
