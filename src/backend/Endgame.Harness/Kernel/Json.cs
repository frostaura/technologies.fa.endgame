using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Endgame.Harness.Kernel;

/// <summary>JSON helpers the harness uses everywhere: tolerant argument reading and compact writing.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static readonly JsonSerializerOptions Compact = new()
    {
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>
    /// A tool call's arguments as an object. ARCH-006: they may arrive as a string, an object or
    /// empty. Returns the parse error (first sentence) when they cannot be read.
    /// </summary>
    public static (JsonObject? Args, string? Error) ParseArguments(JsonNode? raw)
    {
        switch (raw)
        {
            case null:
                return (new JsonObject(), null);
            case JsonObject o:
                return (o.DeepClone().AsObject(), null);
            case JsonValue v when v.TryGetValue<string>(out var s):
                if (string.IsNullOrWhiteSpace(s))
                {
                    return (new JsonObject(), null);
                }

                try
                {
                    return JsonNode.Parse(s) is JsonObject parsed ? (parsed, null) : (null, "the arguments must be a JSON object");
                }
                catch (JsonException e)
                {
                    return (null, e.Message.Split('.')[0]);
                }

            default:
                return (null, "the arguments must be a JSON object");
        }
    }

    public static string? Str(JsonObject? o, string key) => o?[key] switch
    {
        null => null,
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        JsonValue v when v.GetValueKind() == JsonValueKind.Null => null,
        JsonNode n => n.ToJsonString(),
    };

    public static int? Int(JsonObject? o, string key) => o?[key] switch
    {
        JsonValue v when v.TryGetValue<int>(out var i) => i,
        JsonValue v when v.TryGetValue<long>(out var l) => (int)Math.Clamp(l, int.MinValue, int.MaxValue),
        JsonValue v when v.TryGetValue<double>(out var d) => (int)d,
        JsonValue v when v.TryGetValue<string>(out var s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) => i,
        _ => null,
    };

    public static decimal? Dec(JsonObject? o, string key) => o?[key] switch
    {
        JsonValue v when v.TryGetValue<decimal>(out var d) => d,
        JsonValue v when v.TryGetValue<string>(out var s) && decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    public static bool? Bool(JsonObject? o, string key) => o?[key] switch
    {
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<string>(out var s) && bool.TryParse(s, out var b) => b,
        _ => null,
    };

    public static IReadOnlyList<string> Strings(JsonObject? o, string key) => o?[key] switch
    {
        JsonArray a => a.Select(n => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n?.ToJsonString()).OfType<string>().ToList(),
        JsonValue v when v.TryGetValue<string>(out var s) && s.Length > 0 => s.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
        _ => [],
    };

    public static JsonArray Array(IEnumerable<string> values) => new(values.Select(v => (JsonNode)JsonValue.Create(v)!).ToArray());
}

/// <summary>Text the model sees: bounded, colour-free, keeping the head and the tail.</summary>
public static class OutputText
{
    /// <summary>
    /// Keeps a third from the head and two thirds from the tail (ARCH-006: errors come at the end),
    /// with a marker saying how much was dropped.
    /// </summary>
    public static string Truncate(string text, int max)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (text.Length <= max)
        {
            return text;
        }

        var head = max / 3;
        var tail = max - head;
        return string.Concat(text.AsSpan(0, head), $"\n\n... [{text.Length - max} characters cut] ...\n\n", text.AsSpan(text.Length - tail));
    }

    /// <summary>Removes ANSI colour and cursor codes, which only waste the model's context.</summary>
    public static string StripAnsi(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        if (!text.Contains('\u001b', StringComparison.Ordinal))
        {
            return text;
        }

        var result = new System.Text.StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] == '\u001b' && i + 1 < text.Length && text[i + 1] == '[')
            {
                i += 2;
                while (i < text.Length && !(text[i] >= '@' && text[i] <= '~'))
                {
                    i++;
                }

                continue;
            }

            result.Append(text[i]);
        }

        return result.ToString();
    }
}
