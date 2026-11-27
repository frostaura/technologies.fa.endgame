using System.Buffers.Binary;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Credits;
using Endgame.Infrastructure.Work;
using Microsoft.Extensions.Configuration;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// A file attached to a conversation is judged by its bytes, never by its name or the type a browser claims (ARCH-012):
/// what is accepted, what is refused, and what the model gateway makes of an image in a prompt.
/// </summary>
public sealed class AttachmentChecksTests
{
    // ------------------------------------------------------------------ files that are accepted

    [Fact]
    public void An_image_is_read_by_its_header_alone_for_its_size_in_pixels()
    {
        var png = Inspect("photo.png", Png(640, 480));
        Assert.Equal(("image", "image/png", 640, 480), (png.Kind, png.ContentType, png.Width!.Value, png.Height!.Value));
        var jpeg = Inspect("photo.JPG", Jpeg(1200, 800));
        Assert.Equal(("image/jpeg", 1200, 800), (jpeg.ContentType, jpeg.Width!.Value, jpeg.Height!.Value));
        var gif = Inspect("wave.gif", Gif(32, 16));
        Assert.Equal(("image/gif", 32, 16), (gif.ContentType, gif.Width!.Value, gif.Height!.Value));
        var webp = Inspect("cover.webp", WebP(1920, 1080));
        Assert.Equal(("image/webp", 1920, 1080), (webp.ContentType, webp.Width!.Value, webp.Height!.Value));
        Assert.Null(png.Text);
    }

    [Fact]
    public void A_text_file_is_kept_as_its_text_and_served_as_plain_text_whatever_it_holds()
    {
        var page = Inspect("index.html", "<script>alert(1)</script><p>Hello</p>"u8.ToArray());
        Assert.Equal(("text", "text/plain; charset=utf-8"), (page.Kind, page.ContentType));
        Assert.Equal("<script>alert(1)</script><p>Hello</p>", page.Text);
        Assert.Equal(page.Text!.Length, page.Characters);
        var code = Inspect("Program.cs", Encoding.UTF8.GetBytes("\uFEFFConsole.WriteLine(\"héllo\");"));
        Assert.Equal("Console.WriteLine(\"héllo\");", code.Text);
        Assert.Equal("text", Inspect(".gitignore", "bin/\nobj/\n"u8.ToArray()).Kind);
    }

    [Fact]
    public void A_pdf_is_read_for_its_pages_and_text()
    {
        var pdf = Inspect("minutes.pdf", PdfWith(["Minutes of the club meeting", "Courts open at seven"]));
        Assert.Equal(("pdf", "application/pdf", 2), (pdf.Kind, pdf.ContentType, pdf.Pages!.Value));
        Assert.Contains("Minutes of the club meeting", pdf.Text, StringComparison.Ordinal);
        Assert.Contains("Courts open at seven", pdf.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void The_text_read_from_a_file_is_bounded()
    {
        var huge = Inspect("log.txt", Encoding.UTF8.GetBytes(new string('a', ConversationAttachments.MaxTextCharacters + 5_000)));
        Assert.Equal(ConversationAttachments.MaxTextCharacters, huge.Characters);
        // A PDF whose text is far longer than the bound: read up to it, never all of it.
        var pages = Enumerable.Range(0, 400).Select(i => $"Page {i} " + string.Join(' ', Enumerable.Repeat("lorem ipsum dolor sit amet", 30))).ToArray();
        var pdf = Inspect("big.pdf", PdfWith(pages));
        Assert.Equal(400, pdf.Pages);
        Assert.Equal(ConversationAttachments.MaxTextCharacters, pdf.Characters);
        Assert.Equal(ConversationAttachments.MaxTextCharacters, pdf.Text!.Length);
    }

    [Fact]
    public void A_name_is_cleaned_of_folders_and_control_characters()
    {
        Assert.Equal("notes.txt", Inspect("../../etc/notes.txt", "x"u8.ToArray()).Name);
        Assert.Equal("notes.txt", Inspect("C:\\Users\\me\\notes.txt", "x"u8.ToArray()).Name);
        Assert.Equal("a.txt", Inspect("a\u0000\n.txt", "x"u8.ToArray()).Name);
        Assert.Equal(400, Refused(null, "x"u8.ToArray()).Status);
    }

    // ------------------------------------------------------------------ hostile and wrong files

    [Fact]
    public void A_name_its_bytes_contradict_is_refused_both_ways()
    {
        var textAsPng = Refused("photo.png", "just some words"u8.ToArray());
        Assert.Equal(415, textAsPng.Status);
        Assert.Contains("named as an image, but it is not one", textAsPng.Detail, StringComparison.Ordinal);
        var pngAsText = Refused("notes.txt", Png(10, 10));
        Assert.Equal(415, pngAsText.Status);
        Assert.Contains("is a PNG image, but its name says otherwise", pngAsText.Detail, StringComparison.Ordinal);
        Assert.Equal(415, Refused("photo.jpg", Png(10, 10)).Status);
        Assert.Equal(415, Refused("report.txt", PdfWith(["Hello"])).Status);
        Assert.Equal(415, Refused("report.pdf", "%PDX not a pdf"u8.ToArray()).Status);
    }

    [Fact]
    public void Archives_and_programs_are_refused_even_named_as_text()
    {
        Assert.Contains("gzip", Refused("notes.txt", [0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00]).Detail, StringComparison.Ordinal);
        Assert.Contains("zip archive", Refused("notes.txt", [.. "PK\x03\x04"u8, .. "rest of the zip"u8]).Detail, StringComparison.Ordinal);
        Assert.Contains("zip archive", Refused("book.docx", [.. "PK\x03\x04"u8, 0, 0]).Detail, StringComparison.Ordinal);
        Assert.Contains("program", Refused("run.sh", [.. "MZ"u8, 0x90, 0x00]).Detail, StringComparison.Ordinal);
        Assert.Contains("program", Refused("tool.txt", [0x7F, 0x45, 0x4C, 0x46, 2, 1]).Detail, StringComparison.Ordinal);
        Assert.Equal(415, Refused("song.mp3", [0x49, 0x44, 0x33, 3, 0]).Status);
    }

    [Fact]
    public void An_svg_is_refused_whatever_it_is_named()
    {
        var svg = """<?xml version="1.0"?><!-- drawn --><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"""u8.ToArray();
        Assert.Contains("SVG", Refused("logo.svg", svg).Detail, StringComparison.Ordinal);
        Assert.Contains("SVG", Refused("logo.png", svg).Detail, StringComparison.Ordinal);
        Assert.Contains("SVG", Refused("logo.xml", svg).Detail, StringComparison.Ordinal);
        Assert.Contains("SVG", Refused("logo.html", "\uFEFF  <svg onload=\"x()\"></svg>"u8.ToArray()).Detail, StringComparison.Ordinal);
        // A page that draws with an svg inside it is a page, served as plain text.
        Assert.Equal("text", Inspect("page.html", "<html><body><svg></svg></body></html>"u8.ToArray()).Kind);
    }

    [Fact]
    public void An_image_claiming_more_than_forty_megapixels_is_refused_without_being_decoded()
    {
        var bomb = Refused("bomb.png", Png(100_000, 100_000));
        Assert.Equal(413, bomb.Status);
        Assert.Contains("100000 × 100000 pixels", bomb.Detail, StringComparison.Ordinal);
        Assert.Equal(413, Refused("wide.gif", Gif(65_535, 65_535)).Status);
        Assert.Equal(413, Refused("big.webp", WebP(16_000, 16_000)).Status);
        Assert.Equal(413, Refused("big.jpg", Jpeg(65_000, 65_000)).Status);
        // At the limit exactly it is accepted.
        Assert.Equal("image", Inspect("ok.png", Png(8_000, 5_000)).Kind);
        Assert.Equal(415, Refused("broken.png", Png(10, 10)[..16]).Status);
    }

    [Fact]
    public void Empty_oversized_unknown_nul_bearing_and_non_utf8_files_are_refused()
    {
        Assert.Equal(400, Refused("empty.txt", []).Status);
        var big = Refused("big.txt", new byte[ConversationAttachments.MaxFileBytes + 1]);
        Assert.Equal(413, big.Status);
        Assert.Equal(415, Refused("data.bin", "binary"u8.ToArray()).Status);
        Assert.Equal(415, Refused("README", "words"u8.ToArray()).Status);
        Assert.Contains("binary data", Refused("notes.txt", [.. "abc"u8, 0, .. "def"u8]).Detail, StringComparison.Ordinal);
        Assert.Contains("UTF-8", Refused("latin.txt", [0x63, 0x61, 0x66, 0xE9]).Detail, StringComparison.Ordinal);
    }

    [Fact]
    public void A_damaged_pdf_is_refused_in_plain_words()
    {
        var damaged = Refused("broken.pdf", "%PDF-1.7\nthis is not really a pdf at all"u8.ToArray());
        Assert.Equal(422, damaged.Status);
        Assert.Contains("could not be read as a PDF", damaged.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("Exception", damaged.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_accepted_extension_is_lower_case_with_its_dot_and_none_is_svg()
    {
        Assert.All(ConversationAttachments.Extensions, e => Assert.Matches("^\\.[a-z0-9.]+$", e));
        Assert.DoesNotContain(".svg", ConversationAttachments.Extensions);
        Assert.Contains(".pdf", ConversationAttachments.Extensions);
        Assert.Contains(".png", ConversationAttachments.Extensions);
        Assert.Contains(".md", ConversationAttachments.Extensions);
        Assert.Equal(ConversationAttachments.Extensions.Count, ConversationAttachments.Extensions.Distinct().Count());
    }

    // ------------------------------------------------------------------ the gateway and images

    [Fact]
    public void The_catalogue_says_which_models_take_images_and_a_route_does_only_when_all_of_its_models_do()
    {
        var options = Shipped();
        Assert.Empty(options.Validate());
        // Read from OpenRouter's own listing (architecture.input_modalities) on 2026-11-27; gpt-oss-20b and glm-5.2 read text only.
        Assert.True(options.Models["qwen/qwen3.7-flash"].Accepts("image"));
        Assert.False(options.Models["openai/gpt-oss-20b"].Accepts("image"));
        Assert.False(options.Models["z-ai/glm-5.2"].Accepts("image"));
        Assert.False(options.AcceptsImages("chat"));
        Assert.True(options.AcceptsImages("research"));
        Assert.False(options.AcceptsImages("plan"));
        Assert.False(options.AcceptsImages("no-such-route"));
    }

    [Fact]
    public void An_input_modality_the_gateway_does_not_send_or_a_list_without_text_is_a_fault()
    {
        var options = Shipped();
        options.Models["openai/gpt-oss-20b"].InputModalities = ["image"];
        options.Models["z-ai/glm-5.2"].InputModalities = ["text", "audio"];
        var faults = options.Validate();
        Assert.Contains(faults, f => f.Contains("openai/gpt-oss-20b", StringComparison.Ordinal) && f.Contains("InputModalities", StringComparison.Ordinal));
        Assert.Contains(faults, f => f.Contains("z-ai/glm-5.2", StringComparison.Ordinal) && f.Contains("InputModalities", StringComparison.Ordinal));
    }

    [Fact]
    public void Image_parts_pass_through_untouched_and_are_reserved_at_a_fixed_figure_not_by_their_base64()
    {
        var options = Shipped();
        var credits = new CreditOptions { CreditsPerUsd = 100m };
        var route = options.Routes["research"];
        PreparedCall Prepare(int imageBytes, int images)
        {
            var parts = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "What is in these?" });
            for (var i = 0; i < images; i++)
            {
                parts.Add(new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = "data:image/png;base64," + Convert.ToBase64String(new byte[imageBytes]) } });
            }

            return ModelGateway.Prepare(options, credits, new ChatRequest { TaskType = "research", Messages = [new JsonObject { ["role"] = "user", ["content"] = parts }] }, route, stream: false);
        }

        var small = Prepare(10, 1);
        var large = Prepare(3_000_000, 1);
        Assert.Equal(small.PromptTokens, large.PromptTokens);
        Assert.Equal(small.ReservedCredits, large.ReservedCredits);
        Assert.True(large.WorstCaseUsd <= route.MaxCallUsd);
        var two = Prepare(10, 2);
        // One more image is its fixed figure, and the few bytes of its part's type.
        Assert.InRange(two.PromptTokens - small.PromptTokens, ReservationFormula.ImageTokens, ReservationFormula.ImageTokens + 16);
        var text = ModelGateway.Prepare(options, credits, new ChatRequest { TaskType = "research", Messages = [new JsonObject { ["role"] = "user", ["content"] = "What is in these?" }] }, route, stream: false);
        Assert.True(small.PromptTokens >= text.PromptTokens + ReservationFormula.ImageTokens);
        // Sent exactly as given: the data URL reaches the provider whole.
        var sent = large.Body["messages"]![0]!["content"]!.AsArray();
        Assert.Equal("image_url", sent[1]!["type"]!.GetValue<string>());
        Assert.Equal(3_000_000, Convert.FromBase64String(sent[1]!["image_url"]!["url"]!.GetValue<string>()["data:image/png;base64,".Length..]).Length);
    }

    [Fact]
    public void A_route_that_cannot_look_at_images_refuses_a_call_carrying_one_before_it_is_sent()
    {
        var options = Shipped();
        var request = new ChatRequest
        {
            TaskType = "chat",
            Messages = [new JsonObject { ["role"] = "user", ["content"] = new JsonArray(new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = "data:image/png;base64,AAAA" } }) }],
        };
        var refused = Assert.Throws<EndgameProblem>(() => ModelGateway.Prepare(options, new CreditOptions(), request, options.Routes["chat"], stream: false));
        Assert.Equal((422, "images_not_accepted"), (refused.Status, refused.Code));
    }

    [Fact]
    public void A_prompt_without_images_is_measured_exactly_as_before()
    {
        var messages = new JsonArray(new JsonObject { ["role"] = "user", ["content"] = "Plus + and <markup> & \"quotes\"" }, new JsonObject { ["role"] = "assistant", ["content"] = "ok" });
        Assert.Equal((Encoding.UTF8.GetByteCount(messages.ToJsonString()), 0), PromptMeasure.Of(messages));
    }

    // ------------------------------------------------------------------ helpers: real file headers, built by hand

    private static ModelGatewayOptions Shipped()
    {
        var configuration = new ConfigurationBuilder().AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json")).Build();
        return configuration.GetSection(ModelGatewayOptions.SectionName).Get<ModelGatewayOptions>()!;
    }

    private static InspectedFile Inspect(string? name, byte[] bytes) => ConversationAttachments.Inspect(name, bytes);

    private static EndgameProblem Refused(string? name, byte[] bytes) => Assert.Throws<EndgameProblem>(() => ConversationAttachments.Inspect(name, bytes));

    public static byte[] Png(int width, int height)
    {
        var bytes = new byte[33];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13 }.CopyTo(bytes, 0);
        "IHDR"u8.CopyTo(bytes.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(16), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20), (uint)height);
        bytes[24] = 8;
        bytes[25] = 6;
        return bytes;
    }

    private static byte[] Gif(int width, int height)
    {
        var bytes = new byte[13];
        "GIF89a"u8.CopyTo(bytes);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(6), (ushort)width);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(8), (ushort)height);
        return bytes;
    }

    private static byte[] WebP(int width, int height)
    {
        var bytes = new byte[30];
        "RIFF"u8.CopyTo(bytes);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), 22);
        "WEBP"u8.CopyTo(bytes.AsSpan(8));
        "VP8X"u8.CopyTo(bytes.AsSpan(12));
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(16), 10);
        void Write24(int at, int value)
        {
            bytes[at] = (byte)(value & 0xFF);
            bytes[at + 1] = (byte)((value >> 8) & 0xFF);
            bytes[at + 2] = (byte)((value >> 16) & 0xFF);
        }

        Write24(24, width - 1);
        Write24(27, height - 1);
        return bytes;
    }

    /// <summary>A JPEG header: SOI, an APP0 segment, then a baseline start-of-frame carrying the size.</summary>
    private static byte[] Jpeg(int width, int height)
    {
        var bytes = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10 };
        bytes.AddRange("JFIF\0"u8.ToArray());
        bytes.AddRange(new byte[9]);
        bytes.AddRange([0xFF, 0xC0, 0x00, 0x11, 0x08, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width, 0x03]);
        bytes.AddRange(new byte[9]);
        return [.. bytes];
    }

    /// <summary>A real, minimal PDF with one line of text on each page, offsets computed so any reader can open it.</summary>
    public static byte[] PdfWith(IReadOnlyList<string> pages)
    {
        var objects = new List<string>
        {
            "<< /Type /Catalog /Pages 2 0 R >>",
            $"<< /Type /Pages /Kids [{string.Join(' ', pages.Select((_, i) => $"{4 + (2 * i)} 0 R"))}] /Count {pages.Count} >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        };
        for (var i = 0; i < pages.Count; i++)
        {
            var content = $"BT /F1 12 Tf 72 720 Td ({pages[i].Replace("(", "\\(", StringComparison.Ordinal).Replace(")", "\\)", StringComparison.Ordinal)}) Tj ET";
            objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {5 + (2 * i)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>");
            objects.Add($"<< /Length {Encoding.ASCII.GetByteCount(content)} >>\nstream\n{content}\nendstream");
        }

        var pdf = new StringBuilder("%PDF-1.4\n");
        var offsets = new List<int>();
        for (var n = 0; n < objects.Count; n++)
        {
            offsets.Add(Encoding.ASCII.GetByteCount(pdf.ToString()));
            pdf.Append($"{n + 1} 0 obj\n{objects[n]}\nendobj\n");
        }

        var xref = Encoding.ASCII.GetByteCount(pdf.ToString());
        pdf.Append($"xref\n0 {objects.Count + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets)
        {
            pdf.Append($"{offset:D10} 00000 n \n");
        }

        pdf.Append($"trailer\n<< /Size {objects.Count + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
        return Encoding.ASCII.GetBytes(pdf.ToString());
    }
}
