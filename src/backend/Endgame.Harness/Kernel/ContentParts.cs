using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Credits;

namespace Endgame.Harness.Kernel;

/// <summary>
/// A message's <c>content</c> is a string, or an array of content parts (<c>{type: "text", text}</c> and
/// <c>{type: "image_url", image_url: {url}}</c>) — the shape a turn with attached files has. Everything in the harness that
/// reads a message's words, measures it or writes it down goes through here, so a message of parts is never mistaken for an
/// empty one, never measured by the length of an image's base64, and never written into the log with its image data.
/// </summary>
public static class ContentParts
{
    public const string TextType = "text";
    public const string ImageType = "image_url";

    /// <summary>The words of a message's content: the string itself, or its text parts joined by blank lines; "" for neither.</summary>
    public static string Text(JsonNode? content) => content switch
    {
        JsonValue v when v.GetValueKind() == JsonValueKind.String => v.GetValue<string>(),
        JsonArray parts => string.Join("\n\n", parts.OfType<JsonObject>().Where(p => Type(p) == TextType).Select(p => p["text"] is JsonValue t && t.GetValueKind() == JsonValueKind.String ? t.GetValue<string>() : "")),
        _ => "",
    };

    /// <summary>The words of a message (its <c>content</c>), or null when it has none at all.</summary>
    public static string? TextOrNull(JsonNode? content) => content is JsonValue or JsonArray ? Text(content) : null;

    public static bool IsImage(JsonNode? part) => part is JsonObject o && Type(o) == ImageType;

    /// <summary>How many image parts a set of messages carries.</summary>
    public static int Images(JsonArray messages)
    {
        ArgumentNullException.ThrowIfNull(messages);
        return messages.OfType<JsonObject>().Sum(m => m["content"] is JsonArray parts ? parts.Count(IsImage) : 0);
    }

    /// <summary>
    /// The UTF-8 size of a set of messages with every image's data left out — an image is billed by its pixels, so the
    /// estimates add <see cref="ReservationFormula.ImageTokens"/> for each one instead (<see cref="Images"/>).
    /// </summary>
    public static int BytesWithoutImages(JsonArray messages, JsonSerializerOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(messages);
        var any = messages.OfType<JsonObject>().Any(m => m["content"] is JsonArray parts && parts.Any(IsImage));
        var measured = any ? new JsonArray(messages.Select(m => m is JsonObject o ? WithoutImageData(o) : m?.DeepClone()).ToArray()) : messages;
        return Encoding.UTF8.GetByteCount(options is null ? measured.ToJsonString() : measured.ToJsonString(options));
    }

    /// <summary>A copy of a message whose image parts keep their type and lose their data.</summary>
    public static JsonNode WithoutImageData(JsonObject message)
    {
        ArgumentNullException.ThrowIfNull(message);
        var copy = new JsonObject();
        foreach (var (key, value) in message)
        {
            copy[key] = key == "content" && value is JsonArray parts
                ? new JsonArray(parts.Select(p => IsImage(p) ? new JsonObject { ["type"] = ImageType } : p?.DeepClone()).ToArray())
                : value?.DeepClone();
        }

        return copy;
    }

    /// <summary>
    /// What a message of parts is, written down for the log or a summariser: its text parts, and each image as
    /// <c>[image: name]</c> — the name a text part just before it gives (<see cref="ImageLabel"/>), else <c>[image]</c>.
    /// </summary>
    public static string Describe(JsonNode? content)
    {
        if (content is not JsonArray parts)
        {
            return Text(content);
        }

        var sb = new StringBuilder();
        var list = parts.OfType<JsonObject>().ToList();
        for (var i = 0; i < list.Count; i++)
        {
            if (IsImage(list[i]))
            {
                var label = i > 0 && LabelOf(list[i - 1]) is { } named ? $"[image: {named}]" : "[image]";
                sb.Append(label).Append('\n');
                continue;
            }

            // A label is written as the image it names.
            if (LabelOf(list[i]) is not null && i + 1 < list.Count && IsImage(list[i + 1]))
            {
                continue;
            }

            sb.Append(list[i]["text"] is JsonValue t && t.GetValueKind() == JsonValueKind.String ? t.GetValue<string>() : "").Append('\n');
        }

        return sb.ToString().TrimEnd();
    }

    /// <summary>The text part that names the image after it, so the model, the log and compaction all know which file it is.</summary>
    public static JsonObject ImageLabel(string name) => new() { ["type"] = TextType, ["text"] = ImageLabelPrefix + name };

    public const string ImageLabelPrefix = "Attached image: ";

    private static string? LabelOf(JsonObject part) =>
        Type(part) == TextType && part["text"] is JsonValue t && t.GetValueKind() == JsonValueKind.String && t.GetValue<string>().StartsWith(ImageLabelPrefix, StringComparison.Ordinal)
            ? t.GetValue<string>()[ImageLabelPrefix.Length..].Trim()
            : null;

    private static string? Type(JsonObject part) => part["type"] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;
}
