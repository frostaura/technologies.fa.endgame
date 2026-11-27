using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using Endgame.Application.Common;
using UglyToad.PdfPig;

namespace Endgame.Infrastructure.Work;

/// <summary>What a file turned out to be, read from its bytes: its kind, the type it is served as, and the text read from it.</summary>
public sealed record InspectedFile(string Name, string Kind, string ContentType, long Bytes, int? Width, int? Height, int? Pages, int? Characters, string? Text);

/// <summary>
/// The files a conversation message may carry (ARCH-012): the limits, the kinds, and the check of each file by its bytes,
/// never by its name or the type the browser claims. An image is read only as far as its header (its size in pixels, no
/// decoding); a PDF only for its text, with PdfPig, bounded in characters and in time; a text file only when it is valid
/// UTF-8 with no NUL byte. Anything else — SVG, archives, programs, a name the bytes contradict — is refused in a plain
/// sentence that never names infrastructure.
/// </summary>
public static class ConversationAttachments
{
    public const int MaxFiles = 10;

    public const long MaxFileBytes = 10L * 1024 * 1024;

    public const long MaxMessageBytes = 25L * 1024 * 1024;

    public const long MaxPixels = 40_000_000;

    public const int MaxTextCharacters = 200_000;

    /// <summary>Uploads one person may hold that are not sent yet; the oldest must be sent or removed first.</summary>
    public const int MaxUnsentPerPerson = 20;

    /// <summary>An unsent upload older than this is cleared when its uploader next uploads.</summary>
    public static readonly TimeSpan UnsentLifetime = TimeSpan.FromDays(1);

    /// <summary>How long reading a PDF's text may take before the file is refused.</summary>
    public static readonly TimeSpan PdfReadLimit = TimeSpan.FromSeconds(10);

    public const int MaxNameLength = 200;

    /// <summary>What heading and fencing one text or PDF file in a prompt adds, in characters: its name, its size, the fence.</summary>
    public const int FencePerFile = 200;

    /// <summary>The body an upload may be: one file at its limit and the form around it.</summary>
    public const long MaxUploadRequestBytes = MaxFileBytes + (64 * 1024);

    public const string Image = "image";
    public const string Pdf = "pdf";
    public const string Text = "text";

    public static readonly IReadOnlyList<string> Kinds = [Image, Pdf, Text];

    private static readonly Dictionary<string, (string Type, string[] Extensions)> Images = new(StringComparer.Ordinal)
    {
        ["png"] = ("image/png", [".png"]),
        ["jpeg"] = ("image/jpeg", [".jpg", ".jpeg"]),
        ["webp"] = ("image/webp", [".webp"]),
        ["gif"] = ("image/gif", [".gif"]),
    };

    /// <summary>Text-like files by name, each served as plain text whatever it holds, so nothing in it can run in a browser.</summary>
    public static readonly IReadOnlyList<string> TextExtensions =
    [
        ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".xml", ".html", ".htm", ".css",
        ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".cs", ".csproj", ".sln", ".py", ".go", ".rs", ".java", ".kt", ".kts",
        ".rb", ".php", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".toml", ".ini", ".cfg", ".conf", ".log",
        ".c", ".h", ".cpp", ".hpp", ".swift", ".scala", ".dart", ".lua", ".r", ".vue", ".svelte", ".graphql", ".proto",
        ".tf", ".dockerfile", ".gitignore", ".editorconfig", ".rst", ".tex", ".srt", ".vtt",
    ];

    /// <summary>Every accepted extension, lower case with the dot: what the composer's file picker offers.</summary>
    public static IReadOnlyList<string> Extensions { get; } =
        [.. Images.Values.SelectMany(i => i.Extensions), ".pdf", .. TextExtensions];

    /// <summary>Whether a name's extension is one an image would have.</summary>
    public static bool IsImageName(string name) => Images.Values.Any(i => i.Extensions.Contains(Extension(name), StringComparer.Ordinal));

    /// <summary>
    /// Reads a file by its bytes. Throws an <see cref="EndgameProblem"/> the person can read: 400 for an empty file or no
    /// name, 413 for one too large (in bytes or in pixels), 415 for anything that is not an image, a PDF or text, or whose
    /// name its bytes contradict, 422 for a PDF whose text cannot be read.
    /// </summary>
    public static InspectedFile Inspect(string? fileName, ReadOnlySpan<byte> bytes)
    {
        var name = CleanName(fileName);
        if (bytes.Length == 0)
        {
            throw new EndgameProblem(400, "attachment_empty", "That file is empty", $"{name} has nothing in it, so there is nothing to send.");
        }

        if (bytes.Length > MaxFileBytes)
        {
            throw TooLarge($"{name} is {Megabytes(bytes.Length)}; a file can be at most {Megabytes(MaxFileBytes)}.");
        }

        var extension = Extension(name);
        if (Refused(bytes) is { } what)
        {
            throw Unsupported($"{name} is {what}, which cannot be attached. Attach images (PNG, JPEG, WebP, GIF), PDFs or text files.");
        }

        if (extension == ".svg" || LooksLikeSvg(bytes))
        {
            throw Unsupported($"{name} is an SVG drawing, which cannot be attached because it can carry code. Attach it as a PNG or JPEG instead.");
        }

        if (ImageFormat(bytes) is { } format)
        {
            var (type, extensions) = Images[format];
            if (!extensions.Contains(extension, StringComparer.Ordinal))
            {
                throw Unsupported($"{name} is a {format.ToUpperInvariant()} image, but its name says otherwise. Rename it to end in {extensions[0]} and attach it again.");
            }

            var (width, height) = Dimensions(format, bytes) ?? throw Unsupported($"{name} could not be read as an image. It may be damaged.");
            if ((long)width * height > MaxPixels)
            {
                throw TooLarge($"{name} is {width.ToString(CultureInfo.InvariantCulture)} × {height.ToString(CultureInfo.InvariantCulture)} pixels; an image can be at most {(MaxPixels / 1_000_000).ToString(CultureInfo.InvariantCulture)} megapixels. Make it smaller and attach it again.");
            }

            return new InspectedFile(name, Image, type, bytes.Length, width, height, null, null, null);
        }

        if (bytes.StartsWith("%PDF-"u8))
        {
            if (extension != ".pdf")
            {
                throw Unsupported($"{name} is a PDF, but its name says otherwise. Rename it to end in .pdf and attach it again.");
            }

            var (pages, text) = ReadPdf(name, bytes.ToArray());
            return new InspectedFile(name, Pdf, "application/pdf", bytes.Length, null, null, pages, text.Length, text);
        }

        if (IsImageName(name) || extension == ".pdf")
        {
            throw Unsupported($"{name} is named as {(extension == ".pdf" ? "a PDF" : "an image")}, but it is not one. Attach the file itself.");
        }

        if (!TextExtensions.Contains(extension, StringComparer.Ordinal))
        {
            throw Unsupported($"{name} is not a kind of file that can be attached. Attach images (PNG, JPEG, WebP, GIF), PDFs or text files such as .txt, .md, .csv, .json or code.");
        }

        if (bytes.Contains((byte)0))
        {
            throw Unsupported($"{name} is not plain text: it holds binary data. Attach the text itself.");
        }

        string decoded;
        try
        {
            decoded = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw Unsupported($"{name} is not readable text: it is not saved as UTF-8. Save it as UTF-8 text and attach it again.");
        }

        var bounded = Bound(decoded.TrimStart('﻿'));
        return new InspectedFile(name, Text, "text/plain; charset=utf-8", bytes.Length, null, null, null, bounded.Length, bounded);
    }

    /// <summary>The file's name with any folder, control characters and excess length removed; never empty.</summary>
    public static string CleanName(string? fileName)
    {
        var name = (fileName ?? "").Replace('\\', '/');
        name = name[(name.LastIndexOf('/') + 1)..];
        name = new string(name.Where(c => !char.IsControl(c) && c is not ('"' or '<' or '>')).ToArray()).Trim();
        if (name.Length == 0)
        {
            throw new EndgameProblem(400, "attachment_unnamed", "The file has no name", "Attach a file that has a name, such as notes.txt.");
        }

        if (name.Length > MaxNameLength)
        {
            var ext = Extension(name);
            name = name[..(MaxNameLength - ext.Length)] + ext;
        }

        return name;
    }

    /// <summary>The lower-case extension with its dot, or "" for none. A dotfile such as <c>.gitignore</c> is its own extension.</summary>
    public static string Extension(string name)
    {
        var dot = name.LastIndexOf('.');
        return dot < 0 ? "" : name[dot..].ToLowerInvariant();
    }

    private static string Bound(string text) => text.Length <= MaxTextCharacters ? text : text[..MaxTextCharacters];

    /// <summary>A file that is never attachable whatever its name: an archive, a compressed file or a program.</summary>
    private static string? Refused(ReadOnlySpan<byte> b)
    {
        if (b.StartsWith("PK\x03\x04"u8) || b.StartsWith("PK\x05\x06"u8) || b.StartsWith("PK\x07\x08"u8))
        {
            return "a zip archive";
        }

        if (Starts(b, 0x1F, 0x8B))
        {
            return "a compressed (gzip) file";
        }

        if (Starts(b, 0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C) || b.StartsWith("Rar!\x1A\x07"u8) || b.StartsWith("BZh"u8) || Starts(b, 0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00)
            || Starts(b, 0x28, 0xB5, 0x2F, 0xFD) || (b.Length > 262 && b[257..262].SequenceEqual("ustar"u8)))
        {
            return "an archive";
        }

        if (b.StartsWith("MZ"u8) || Starts(b, 0x7F, 0x45, 0x4C, 0x46) || Starts(b, 0xFE, 0xED, 0xFA, 0xCE) || Starts(b, 0xFE, 0xED, 0xFA, 0xCF)
            || Starts(b, 0xCF, 0xFA, 0xED, 0xFE) || Starts(b, 0xCE, 0xFA, 0xED, 0xFE) || Starts(b, 0xCA, 0xFE, 0xBA, 0xBE) || Starts(b, 0x00, 0x61, 0x73, 0x6D))
        {
            return "a program";
        }

        return null;
    }

    /// <summary>An SVG drawing, whatever it is named: after any byte-order mark, XML declaration, comments and doctype, its root element is <c>svg</c>.</summary>
    private static bool LooksLikeSvg(ReadOnlySpan<byte> bytes)
    {
        var head = Encoding.UTF8.GetString(bytes[..Math.Min(bytes.Length, 4096)]).TrimStart('﻿').TrimStart();
        for (var guard = 0; guard < 32 && head.StartsWith('<'); guard++)
        {
            if (head.StartsWith("<?", StringComparison.Ordinal) || head.StartsWith("<!--", StringComparison.Ordinal) || head.StartsWith("<!", StringComparison.Ordinal))
            {
                var close = head.StartsWith("<!--", StringComparison.Ordinal) ? head.IndexOf("-->", StringComparison.Ordinal) : head.IndexOf('>', StringComparison.Ordinal);
                if (close < 0)
                {
                    return false;
                }

                head = head[(close + (head.StartsWith("<!--", StringComparison.Ordinal) ? 3 : 1))..].TrimStart();
                continue;
            }

            return head.Length > 4 && head[1..].StartsWith("svg", StringComparison.OrdinalIgnoreCase) && (head.Length == 4 || !char.IsLetterOrDigit(head[4]));
        }

        return false;
    }

    private static bool Starts(ReadOnlySpan<byte> bytes, params ReadOnlySpan<byte> magic) => bytes.StartsWith(magic);

    private static string? ImageFormat(ReadOnlySpan<byte> b) =>
        Starts(b, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) ? "png"
        : Starts(b, 0xFF, 0xD8, 0xFF) ? "jpeg"
        : b.StartsWith("GIF87a"u8) || b.StartsWith("GIF89a"u8) ? "gif"
        : b.Length >= 12 && b.StartsWith("RIFF"u8) && b[8..12].SequenceEqual("WEBP"u8) ? "webp"
        : null;

    /// <summary>The image's width and height from its header alone; null when the header cannot be read.</summary>
    public static (int Width, int Height)? Dimensions(string format, ReadOnlySpan<byte> b)
    {
        switch (format)
        {
            case "png":
                return b.Length >= 24 && b[12..16].SequenceEqual("IHDR"u8) ? Positive(BinaryPrimitives.ReadUInt32BigEndian(b[16..20]), BinaryPrimitives.ReadUInt32BigEndian(b[20..24])) : null;
            case "gif":
                return b.Length >= 10 ? Positive(BinaryPrimitives.ReadUInt16LittleEndian(b[6..8]), BinaryPrimitives.ReadUInt16LittleEndian(b[8..10])) : null;
            case "webp":
                return WebPDimensions(b);
            case "jpeg":
                return JpegDimensions(b);
            default:
                return null;
        }
    }

    private static (int, int)? Positive(long width, long height) =>
        width is > 0 and <= int.MaxValue && height is > 0 and <= int.MaxValue ? ((int)width, (int)height) : null;

    private static (int, int)? WebPDimensions(ReadOnlySpan<byte> b)
    {
        if (b.Length < 30)
        {
            return null;
        }

        var chunk = b[12..16];
        if (chunk.SequenceEqual("VP8X"u8))
        {
            var width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
            var height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
            return Positive(width, height);
        }

        if (chunk.SequenceEqual("VP8 "u8))
        {
            return b[23] == 0x9D && b[24] == 0x01 && b[25] == 0x2A
                ? Positive(BinaryPrimitives.ReadUInt16LittleEndian(b[26..28]) & 0x3FFF, BinaryPrimitives.ReadUInt16LittleEndian(b[28..30]) & 0x3FFF)
                : null;
        }

        if (chunk.SequenceEqual("VP8L"u8) && b[20] == 0x2F)
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(b[21..25]);
            return Positive((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1);
        }

        return null;
    }

    private static (int, int)? JpegDimensions(ReadOnlySpan<byte> b)
    {
        var i = 2;
        while (i + 3 < b.Length)
        {
            if (b[i] != 0xFF)
            {
                return null;
            }

            var marker = b[i + 1];
            if (marker == 0xFF)
            {
                i++;
                continue;
            }

            if (marker is 0x01 or (>= 0xD0 and <= 0xD7))
            {
                i += 2;
                continue;
            }

            if (marker is 0xD9 or 0xDA)
            {
                return null;
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(b[(i + 2)..(i + 4)]);
            if (length < 2)
            {
                return null;
            }

            // Start of frame (baseline, progressive, lossless …), never DHT (C4), JPG (C8) or DAC (CC).
            if (marker is >= 0xC0 and <= 0xCF and not (0xC4 or 0xC8 or 0xCC))
            {
                return i + 9 <= b.Length ? Positive(BinaryPrimitives.ReadUInt16BigEndian(b[(i + 7)..(i + 9)]), BinaryPrimitives.ReadUInt16BigEndian(b[(i + 5)..(i + 7)])) : null;
            }

            i += 2 + length;
        }

        return null;
    }

    /// <summary>A PDF's pages and its text, page by page, stopping at <see cref="MaxTextCharacters"/> or <see cref="PdfReadLimit"/>.</summary>
    private static (int Pages, string Text) ReadPdf(string name, byte[] bytes)
    {
        var clock = Stopwatch.StartNew();
        try
        {
            using var document = PdfDocument.Open(bytes);
            var pages = document.NumberOfPages;
            var text = new StringBuilder();
            for (var n = 1; n <= pages && text.Length < MaxTextCharacters; n++)
            {
                if (clock.Elapsed > PdfReadLimit)
                {
                    throw Unreadable($"{name} took too long to read. Attach a shorter PDF, or the part of it that matters.");
                }

                if (text.Length > 0)
                {
                    text.Append("\n\n");
                }

                text.Append(document.GetPage(n).Text);
            }

            return (pages, Bound(text.ToString()));
        }
        catch (EndgameProblem)
        {
            throw;
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            // PdfPig throws its own types for a damaged, encrypted or unsupported file: all of them are "cannot be read".
            throw Unreadable($"{name} could not be read as a PDF. It may be damaged or protected by a password.");
        }
    }

    private static string Megabytes(long bytes) => $"{(bytes / (1024m * 1024m)).ToString("0.#", CultureInfo.InvariantCulture)} MB";

    private static EndgameProblem TooLarge(string detail) => new(413, "attachment_too_large", "That file is too large", detail);

    private static EndgameProblem Unsupported(string detail) => new(415, "attachment_not_accepted", "That kind of file cannot be attached", detail);

    private static EndgameProblem Unreadable(string detail) => new(422, "attachment_unreadable", "That file could not be read", detail);
}
