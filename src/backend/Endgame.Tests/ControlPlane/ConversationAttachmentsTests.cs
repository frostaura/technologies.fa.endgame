using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Work;
using Endgame.Tests.Fixtures;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// Files a person attaches to a conversation message, end to end on the real control plane and Postgres (ARCH-012): who may
/// upload, read and remove one, how it is served, the limits a message is held to when it is sent, what the estimate and the
/// history make of it, and what the Runner is given.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ConversationAttachmentsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private FakeOpenRouter openRouter = null!;
    private HttpClient owner = null!;
    private HttpClient service = null!;

    public async Task InitializeAsync()
    {
        openRouter = await FakeOpenRouter.StartAsync();
        app = await ControlPlaneApp.StartAsync(postgres, openRouter);
        owner = await app.OwnerWithOrganisationAsync();
        await owner.DivisionAsync("frostaura", "labs");
        service = app.Internal();
    }

    public async Task DisposeAsync()
    {
        await app.DisposeAsync();
        await openRouter.DisposeAsync();
    }

    private static MultipartFormDataContent Form(string scope, string name, byte[] bytes, Guid? employeeId = null)
    {
        var form = new MultipartFormDataContent { { new StringContent(scope), "scope" }, { new ByteArrayContent(bytes), "file", name } };
        if (employeeId is { } id)
        {
            form.Add(new StringContent(id.ToString()), "employeeId");
        }

        return form;
    }

    private static async Task<JsonNode> UploadAsync(HttpClient client, string scope, string name, byte[] bytes, Guid? employeeId = null)
    {
        using var form = Form(scope, name, bytes, employeeId);
        return await ControlPlaneApp.Created(client.PostAsync("/api/conversations/attachments", form));
    }

    private static async Task<HttpResponseMessage> TryUploadAsync(HttpClient client, string scope, string name, byte[] bytes)
    {
        using var form = Form(scope, name, bytes);
        return await client.PostAsync("/api/conversations/attachments", form);
    }

    private static string Id(JsonNode node) => node["id"]!.GetValue<string>();

    private async Task<HttpClient> MemberAsync(string email, string role, string scope = "frostaura/labs")
    {
        var person = await app.SignInAsync(email);
        await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/members", new { scope, email, role }));
        return person;
    }

    private async Task<Guid> EmployeeAsync(string tier) =>
        Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/labs", name = "Iris", role = "Researcher", modelTier = tier })))["id"]!.GetValue<string>());

    [Fact]
    public async Task An_upload_is_checked_by_its_bytes_and_answered_in_the_console_shape()
    {
        var text = await UploadAsync(owner, "frostaura/labs", "notes.md", "# Courts\nSeven of them."u8.ToArray());
        Assert.Equal(("notes.md", "text", "text/plain; charset=utf-8", 23L, 23), (text["name"]!.GetValue<string>(), text["kind"]!.GetValue<string>(), text["contentType"]!.GetValue<string>(), text["bytes"]!.GetValue<long>(), text["characters"]!.GetValue<int>()));
        Assert.Null(text["runId"]);
        Assert.Null(text["pages"]);
        var pdf = await UploadAsync(owner, "frostaura/labs", "minutes.pdf", AttachmentChecksTests.PdfWith(["Courts open at seven", "Members only"]));
        Assert.Equal(("pdf", 2), (pdf["kind"]!.GetValue<string>(), pdf["pages"]!.GetValue<int>()));
        var image = await UploadAsync(owner, "frostaura/labs", "court.png", AttachmentChecksTests.Png(800, 600));
        Assert.Equal(("image", "image/png"), (image["kind"]!.GetValue<string>(), image["contentType"]!.GetValue<string>()));
        Assert.Null(image["characters"]);

        // A hostile file is refused with a plain sentence that names no infrastructure.
        var svg = await ControlPlaneApp.Expect(await TryUploadAsync(owner, "frostaura/labs", "logo.png", "<svg onload=\"x()\"/>"u8.ToArray()), HttpStatusCode.UnsupportedMediaType);
        Assert.Contains("SVG", svg["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        var zip = await ControlPlaneApp.Expect(await TryUploadAsync(owner, "frostaura/labs", "notes.txt", [0x1F, 0x8B, 8, 0, 0, 0, 0, 0]), HttpStatusCode.UnsupportedMediaType);
        Assert.DoesNotContain("container", zip["detail"]!.GetValue<string>(), StringComparison.OrdinalIgnoreCase);
        await ControlPlaneApp.Expect(await TryUploadAsync(owner, "frostaura/labs", "empty.txt", []), HttpStatusCode.BadRequest);
        await ControlPlaneApp.Expect(await TryUploadAsync(owner, "frostaura/labs", "big.txt", new byte[ConversationAttachments.MaxFileBytes + 1]), HttpStatusCode.RequestEntityTooLarge);
        await ControlPlaneApp.Expect(await TryUploadAsync(owner, "frostaura/labs", "bomb.png", AttachmentChecksTests.Png(100_000, 100_000)), HttpStatusCode.RequestEntityTooLarge);
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations/attachments", new { scope = "frostaura/labs" }), HttpStatusCode.UnsupportedMediaType);
    }

    [Fact]
    public async Task Only_a_builder_may_upload_and_a_form_from_another_site_is_refused()
    {
        var viewer = await MemberAsync("viewer@example.com", "viewer");
        await ControlPlaneApp.Expect(await TryUploadAsync(viewer, "frostaura/labs", "notes.txt", "x"u8.ToArray()), HttpStatusCode.Forbidden);
        var builder = await MemberAsync("builder@example.com", "builder");
        await UploadAsync(builder, "frostaura/labs", "notes.txt", "x"u8.ToArray());
        // Outside the builder's branch the scope does not exist for them.
        await ControlPlaneApp.Expect(await TryUploadAsync(builder, "frostaura", "notes.txt", "x"u8.ToArray()), HttpStatusCode.NotFound);

        // A form posted from another site carries the person's cookie but not this origin.
        using var forged = new HttpRequestMessage(HttpMethod.Post, "/api/conversations/attachments") { Content = Form("frostaura/labs", "notes.txt", "x"u8.ToArray()) };
        forged.Headers.Remove("Origin");
        forged.Headers.Add("Origin", "https://club.example.net");
        await ControlPlaneApp.Expect(await owner.SendAsync(forged), HttpStatusCode.Forbidden);
        using var sibling = new HttpRequestMessage(HttpMethod.Post, "/api/conversations/attachments") { Content = Form("frostaura/labs", "notes.txt", "x"u8.ToArray()) };
        sibling.Headers.Add("Sec-Fetch-Site", "same-site");
        await ControlPlaneApp.Expect(await owner.SendAsync(sibling), HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task A_file_is_served_as_what_it_was_checked_to_be_and_never_run()
    {
        var page = await UploadAsync(owner, "frostaura/labs", "page.html", "<script>alert(1)</script>"u8.ToArray());
        using var text = await owner.GetAsync($"/api/conversations/attachments/{Id(page)}/content");
        Assert.Equal(HttpStatusCode.OK, text.StatusCode);
        Assert.Equal("text/plain; charset=utf-8", text.Content.Headers.ContentType!.ToString());
        Assert.Equal("nosniff", string.Join(",", text.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal("sandbox; default-src 'none'", string.Join(",", text.Headers.GetValues("Content-Security-Policy")));
        // Never cached where others could read it: private, or not at all when the session cookie was renewed on the way.
        var cache = text.Headers.CacheControl!;
        Assert.True(cache.Private || cache.NoStore, cache.ToString());
        Assert.False(cache.Public);
        Assert.Equal("attachment", text.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("<script>alert(1)</script>", await text.Content.ReadAsStringAsync());

        var image = await UploadAsync(owner, "frostaura/labs", "Court plan é.png", AttachmentChecksTests.Png(20, 10));
        using var served = await owner.GetAsync($"/api/conversations/attachments/{Id(image)}/content");
        Assert.Equal("image/png", served.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", served.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("Court plan é.png", served.Content.Headers.ContentDisposition.FileNameStar);
        Assert.Equal(AttachmentChecksTests.Png(20, 10), await served.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task An_unsent_file_is_its_uploaders_alone_and_another_organisation_never_sees_one()
    {
        var file = await UploadAsync(owner, "frostaura/labs", "draft.txt", "Not sent yet."u8.ToArray());
        var colleague = await MemberAsync("colleague@example.com", "admin");
        await ControlPlaneApp.Expect(await colleague.GetAsync($"/api/conversations/attachments/{Id(file)}/content"), HttpStatusCode.NotFound);
        await ControlPlaneApp.Expect(await colleague.DeleteAsync($"/api/conversations/attachments/{Id(file)}"), HttpStatusCode.NotFound);
        // Nor can it be sent by anyone else.
        var refused = await ControlPlaneApp.Expect(await colleague.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Mine now.", attachmentIds = new[] { Id(file) } }), HttpStatusCode.NotFound);
        Assert.Contains("file attached to this message", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);

        // Once sent it is the conversation's: everyone who may read the conversation may read it.
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Here it is.", attachmentIds = new[] { Id(file) } }));
        var viewer = await MemberAsync("viewer2@example.com", "viewer");
        Assert.Equal("Not sent yet.", await (await viewer.GetAsync($"/api/conversations/attachments/{Id(file)}/content")).Content.ReadAsStringAsync());

        // Someone of no organisation here: not found. Another organisation: not even a row under its own tenant session.
        var stranger = await app.SignInAsync("stranger@example.com");
        await ControlPlaneApp.Expect(await stranger.GetAsync($"/api/conversations/attachments/{Id(file)}/content"), HttpStatusCode.NotFound);
        await ControlPlaneApp.Expect(await stranger.DeleteAsync($"/api/conversations/attachments/{Id(file)}"), HttpStatusCode.NotFound);
        var acme = Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = Provisioning.Description, screening = Provisioning.Manual })))["id"]!.GetValue<string>());
        var frostaura = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree?organisation=frostaura")))["organisation"]!["id"]!.GetValue<string>());
        Assert.Equal(0, await CountAsync(acme, "SELECT count(*) FROM conversation_attachments"));
        Assert.Equal(1, await CountAsync(frostaura, "SELECT count(*) FROM conversation_attachments"));
    }

    [Fact]
    public async Task An_unsent_file_can_be_removed_by_its_uploader_and_a_sent_one_cannot()
    {
        var keep = await UploadAsync(owner, "frostaura/labs", "keep.txt", "Keep."u8.ToArray());
        var drop = await UploadAsync(owner, "frostaura/labs", "drop.txt", "Drop."u8.ToArray());
        await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/conversations/attachments/{Id(drop)}"), HttpStatusCode.NoContent);
        await ControlPlaneApp.Expect(await owner.GetAsync($"/api/conversations/attachments/{Id(drop)}/content"), HttpStatusCode.NotFound);
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Keep this.", attachmentIds = new[] { Id(keep) } }));
        var sent = await ControlPlaneApp.Expect(await owner.DeleteAsync($"/api/conversations/attachments/{Id(keep)}"), HttpStatusCode.Conflict);
        Assert.Equal("attachment_sent", sent["code"]!.GetValue<string>());
        // A file goes with one message only.
        var again = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Again.", attachmentIds = new[] { Id(keep) } }), HttpStatusCode.Conflict);
        Assert.Equal("attachment_sent", again["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task Unsent_files_older_than_a_day_are_cleared_when_their_uploader_next_uploads()
    {
        var old = await UploadAsync(owner, "frostaura/labs", "old.txt", "Old."u8.ToArray());
        var frostaura = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync("/api/tree")))["organisation"]!["id"]!.GetValue<string>());
        await ExecuteAsync(frostaura, $"UPDATE conversation_attachments SET created_at = now() - interval '25 hours' WHERE id = '{Id(old)}'");
        await UploadAsync(owner, "frostaura/labs", "new.txt", "New."u8.ToArray());
        await ControlPlaneApp.Expect(await owner.GetAsync($"/api/conversations/attachments/{Id(old)}/content"), HttpStatusCode.NotFound);
        Assert.Equal(1, await CountAsync(frostaura, "SELECT count(*) FROM conversation_attachments"));
    }

    [Fact]
    public async Task A_message_is_held_to_its_file_limits_when_it_is_sent()
    {
        var ids = new List<string>();
        for (var i = 0; i < ConversationAttachments.MaxFiles + 1; i++)
        {
            ids.Add(Id(await UploadAsync(owner, "frostaura/labs", $"n{i}.txt", Encoding.UTF8.GetBytes($"note {i}"))));
        }

        var many = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "All of them.", attachmentIds = ids }), HttpStatusCode.BadRequest);
        Assert.Equal("too_many_attachments", many["code"]!.GetValue<string>());
        foreach (var id in ids)
        {
            await owner.DeleteAsync($"/api/conversations/attachments/{id}");
        }

        // Three files of 9 MB each: each is allowed, together they are more than a message may carry.
        var big = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            big.Add(Id(await UploadAsync(owner, "frostaura/labs", $"log{i}.log", Encoding.UTF8.GetBytes(new string((char)('a' + i), 9 * 1024 * 1024)))));
        }

        var heavy = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Read these logs.", attachmentIds = big }), HttpStatusCode.RequestEntityTooLarge);
        Assert.Equal("attachments_too_large", heavy["code"]!.GetValue<string>());
        // Nothing was sent: no conversation turn was made.
        Assert.Empty((await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura/labs")))["messages"]!.AsArray());

        // A file attached in one conversation is not sent in another.
        var elsewhere = await UploadAsync(owner, "frostaura", "here.txt", "Here."u8.ToArray());
        var moved = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "There.", attachmentIds = new[] { Id(elsewhere) } }), HttpStatusCode.Conflict);
        Assert.Equal("attachment_elsewhere", moved["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_image_is_refused_where_whoever_answers_reads_text_only_and_sent_where_it_can_look()
    {
        var photo = await UploadAsync(owner, "frostaura/labs", "court.png", AttachmentChecksTests.Png(64, 64));
        // Endgame's own assistant answers on the chat route, one of whose models reads text only.
        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "What is this?", attachmentIds = new[] { Id(photo) } }), (HttpStatusCode)422);
        Assert.Equal("images_not_accepted", refused["code"]!.GetValue<string>());
        Assert.Contains("reads text only", refused["detail"]!.GetValue<string>(), StringComparison.Ordinal);
        await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations/estimate", new { scope = "frostaura/labs", attachmentIds = new[] { Id(photo) } }), (HttpStatusCode)422);

        // An employee who thinks on the research route can look at it.
        var iris = await EmployeeAsync("research");
        var hers = await UploadAsync(owner, "frostaura/labs", "court.png", AttachmentChecksTests.Png(64, 64), iris);
        var run = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", employeeId = iris, message = "What is this?", attachmentIds = new[] { Id(hers) } }));
        var files = await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{Id(run)}/attachments?taskType=research"));
        Assert.True(files["imagesAccepted"]!.GetValue<bool>());
        var image = Assert.Single(files["attachments"]!.AsArray())!;
        Assert.Equal(AttachmentChecksTests.Png(64, 64), Convert.FromBase64String(image["data"]!.GetValue<string>()));
        Assert.False((await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{Id(run)}/attachments?taskType=chat")))["imagesAccepted"]!.GetValue<bool>());
    }

    [Fact]
    public async Task The_estimate_counts_reading_the_files_and_its_ceiling_covers_every_step()
    {
        var bare = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/conversations/estimate", new { scope = "frostaura/labs" }));
        var notes = await UploadAsync(owner, "frostaura/labs", "notes.txt", Encoding.UTF8.GetBytes(new string('n', 150_000)));
        var with = await ControlPlaneApp.Ok(owner.PostAsJsonAsync("/api/conversations/estimate", new { scope = "frostaura/labs", attachmentIds = new[] { Id(notes) } }));
        Assert.True(with["credits"]!.GetValue<decimal>() > bare["credits"]!.GetValue<decimal>());
        Assert.True(with["ceiling"]!.GetValue<decimal>() > bare["ceiling"]!.GetValue<decimal>());
        Assert.Contains("reading the 1 attached file", with["basis"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Contains("one for every four characters", with["basis"]!.GetValue<string>(), StringComparison.Ordinal);

        // What the message then carries is what was estimated: its log opens with that figure.
        var run = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Summarise it.", attachmentIds = new[] { Id(notes) } }));
        var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{Id(run)}/events"))).AsArray();
        Assert.Equal(with["credits"]!.GetValue<decimal>(), events.Single(e => e!["type"]!.GetValue<string>() == "estimate.made")!["payload"]!["credits"]!.GetValue<decimal>());

        // More text than one call on the chat route may read is refused before anything is sent.
        var tooMuch = new List<string>();
        for (var i = 0; i < 4; i++)
        {
            tooMuch.Add(Id(await UploadAsync(owner, "frostaura/labs", $"part{i}.txt", Encoding.UTF8.GetBytes(new string('p', 200_000)))));
        }

        var refused = await ControlPlaneApp.Expect(await owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", message = "Read all of it.", attachmentIds = tooMuch }), HttpStatusCode.RequestEntityTooLarge);
        Assert.Equal("attachments_too_much", refused["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_history_carries_each_owner_messages_files_and_each_turns_tools_and_the_work_it_started()
    {
        var notes = await UploadAsync(owner, "frostaura/labs", "notes.txt", "Seven courts."u8.ToArray());
        var minutes = await UploadAsync(owner, "frostaura/labs", "minutes.pdf", AttachmentChecksTests.PdfWith(["Open at seven"]));
        var first = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new
        {
            scope = "frostaura/labs",
            message = "Start an idea from these.",
            attachmentIds = new[] { Id(notes), Id(minutes) },
            narrow = new { noWebSearch = true, answerOnly = false },
        }));
        var firstId = Id(first);
        var events = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{firstId}/events"))).AsArray();
        var said = events.First(e => e!["type"]!.GetValue<string>() == "message")!["payload"]!;
        Assert.Equal(["notes.txt", "minutes.pdf"], said["attachments"]!.AsArray().Select(a => a!["name"]!.GetValue<string>()));
        Assert.Equal(["bytes", "contentType", "id", "kind", "name"], said["attachments"]![0]!.AsObject().Select(p => p.Key).Order(StringComparer.Ordinal));
        Assert.Equal("""{"noWebSearch":true}""", said["narrow"]!.ToJsonString());

        // The Runner's turn: two tools asked for, and an idea's research started.
        var research = Guid.NewGuid();
        await ControlPlaneApp.Ok(service.PostAsJsonAsync($"/internal/runs/{firstId}/events", new
        {
            events = new object[]
            {
                new { type = "tool.requested", payload = new { callId = "c1", name = "read_organisation" } },
                new { type = "tool.requested", payload = new { callId = "c2", name = "start_idea" } },
                new { type = "message", payload = new { kind = "work.started", runId = research.ToString(), workKind = "research", title = "A court booking app" } },
                new { type = "message", payload = new { from = "assistant", text = "I started researching it." } },
            },
        }));
        // A message of files alone is a message too.
        var alone = await UploadAsync(owner, "frostaura/labs", "more.txt", "More."u8.ToArray());
        var second = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/conversations", new { scope = "frostaura/labs", attachmentIds = new[] { Id(alone) } }));
        Assert.Equal("Sent more.txt", second["title"]!.GetValue<string>());

        var history = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations?scope=frostaura/labs"));
        var messages = history["messages"]!.AsArray();
        Assert.Equal(["owner", "assistant", "owner"], messages.Select(m => m!["from"]!.GetValue<string>()));
        Assert.Equal(["notes.txt", "minutes.pdf"], messages[0]!["attachments"]!.AsArray().Select(a => a!["name"]!.GetValue<string>()));
        Assert.Equal(firstId, messages[0]!["attachments"]![0]!["runId"]!.GetValue<string>());
        Assert.Equal(1, messages[0]!["attachments"]![1]!["pages"]!.GetValue<int>());
        Assert.Empty(messages[1]!["attachments"]!.AsArray());
        Assert.Equal("", messages[2]!["text"]!.GetValue<string>());
        Assert.Equal("more.txt", messages[2]!["attachments"]![0]!["name"]!.GetValue<string>());

        var turns = history["turns"]!.AsArray();
        Assert.Equal([firstId, Id(second)], turns.Select(t => t!["runId"]!.GetValue<string>()));
        Assert.Equal(2, turns[0]!["toolCalls"]!.GetValue<int>());
        Assert.Equal("queued", turns[1]!["status"]!.GetValue<string>());
        var started = Assert.Single(turns[0]!["started"]!.AsArray())!;
        Assert.Equal((research.ToString(), "research", "A court booking app"), (started["runId"]!.GetValue<string>(), started["kind"]!.GetValue<string>(), started["title"]!.GetValue<string>()));
        Assert.Empty(turns[1]!["started"]!.AsArray());

        // What the Runner is given: each file's text, in the order attached.
        var files = (await ControlPlaneApp.Ok(service.GetAsync($"/internal/runs/{firstId}/attachments?taskType=chat")))["attachments"]!.AsArray();
        Assert.Equal("Seven courts.", files[0]!["text"]!.GetValue<string>());
        Assert.Contains("Open at seven", files[1]!["text"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Null(files[0]!["data"]);
        Assert.False(files[0]!["truncated"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Capabilities_say_what_whoever_answers_here_can_use_from_what_is_true_there()
    {
        var empty = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations/capabilities?scope=frostaura/labs"));
        Assert.Equal(("assistant", "chat"), (empty["answerer"]!["kind"]!.GetValue<string>(), empty["answerer"]!["tier"]!.GetValue<string>()));
        Assert.Equal(["read_organisation", "start_idea", "change_app", "try_again", "adjust_setting"], empty["tools"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal(["start_idea", "change_app", "try_again", "adjust_setting"], empty["asks"]!.AsArray().Select(t => t!.GetValue<string>()));
        // No app and nothing stopped: a change and a try again make no sense here yet.
        Assert.Equal(["start_idea", "adjust_setting"], empty["actions"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal(0, empty["apps"]!.GetValue<int>());
        Assert.Equal(["identity", "models", "secrets", "email", "schedules", "webhooks", "telemetry"], empty["services"]!.AsArray().Select(s => s!["id"]!.GetValue<string>()));
        Assert.All(empty["services"]!.AsArray(), s => Assert.Null(s!["detail"]));
        Assert.False(empty["webSearch"]!["available"]!.GetValue<bool>());
        Assert.False(empty["narrowing"]!["noWebSearch"]!.GetValue<bool>());
        Assert.True(empty["narrowing"]!["answerOnly"]!.GetValue<bool>());
        Assert.False(empty["attachments"]!["images"]!.GetValue<bool>());
        Assert.Equal(ConversationAttachments.MaxFiles, empty["attachments"]!["maxFiles"]!.GetValue<int>());
        Assert.Contains(".pdf", empty["attachments"]!["extensions"]!.AsArray().Select(e => e!.GetValue<string>()));
        var skills = empty["skills"]!.AsArray();
        Assert.Contains(skills, s => s!["name"]!.GetValue<string>() == "add-an-entity" && s["usedBy"]!.GetValue<string>() == "builders");
        Assert.Contains(skills, s => s!["name"]!.GetValue<string>() == "security-review-checklist" && s["usedBy"]!.GetValue<string>() == "security review");

        // An app, a stopped build, a secret, and an assistant key: each shows up.
        await owner.ProjectAsync("frostaura/labs", "courts");
        await owner.AppAsync("frostaura/labs/courts", "bookings");
        var build = await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/runs", new { scope = "frostaura/labs/courts/bookings", kind = "build", title = "Build: bookings" }));
        await ControlPlaneApp.Ok(owner.PostAsync($"/api/runs/{Id(build)}/cancel", null));
        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/secrets", new { scope = "frostaura/labs", name = "API_KEY", value = "never-shown" }));
        await ControlPlaneApp.TokenAsync(owner, "frostaura");
        var full = await ControlPlaneApp.Ok(owner.GetAsync("/api/conversations/capabilities?scope=frostaura/labs"));
        Assert.Equal(["start_idea", "change_app", "try_again", "adjust_setting"], full["actions"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal(1, full["apps"]!.GetValue<int>());
        Assert.Equal("1 secret set here", full["services"]!.AsArray().Single(s => s!["id"]!.GetValue<string>() == "secrets")!["detail"]!.GetValue<string>());
        var key = Assert.Single(full["assistants"]!.AsArray())!;
        Assert.Equal("test client", key["name"]!.GetValue<string>());
        Assert.Null(key["lastUsedAt"]);
        Assert.DoesNotContain("never-shown", full.ToJsonString(), StringComparison.Ordinal);

        // An employee on the research route can search and look at images; the rules decide whether it may search.
        var iris = await EmployeeAsync("research");
        var her = await ControlPlaneApp.Ok(owner.GetAsync($"/api/conversations/capabilities?scope=frostaura/labs&employeeId={iris}"));
        Assert.Equal(("employee", "Iris", "Researcher", "research"), (her["answerer"]!["kind"]!.GetValue<string>(), her["answerer"]!["name"]!.GetValue<string>(), her["answerer"]!["role"]!.GetValue<string>(), her["answerer"]!["tier"]!.GetValue<string>()));
        Assert.Equal(["read_organisation", "start_idea", "change_app", "try_again", "adjust_setting", "remember", "web_search"], her["tools"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.Equal(("may", true, true), (her["webSearch"]!["rule"]!.GetValue<string>(), her["webSearch"]!["available"]!.GetValue<bool>(), her["attachments"]!["images"]!.GetValue<bool>()));
        Assert.True(her["narrowing"]!["noWebSearch"]!.GetValue<bool>());

        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura", stage = "conversation", ask = new[] { "web_search" } }));
        var asks = await ControlPlaneApp.Ok(owner.GetAsync($"/api/conversations/capabilities?scope=frostaura/labs&employeeId={iris}"));
        Assert.Equal(("asks", "frostaura"), (asks["webSearch"]!["rule"]!.GetValue<string>(), asks["webSearch"]!["setAtPath"]!.GetValue<string>()));
        Assert.Contains("web_search", asks["asks"]!.AsArray().Select(t => t!.GetValue<string>()));

        await ControlPlaneApp.Ok(owner.PutAsJsonAsync("/api/autonomy/rule-sets", new { scope = "frostaura/labs", stage = "all", deny = new[] { "web_search", "change_app" } }));
        var denied = await ControlPlaneApp.Ok(owner.GetAsync($"/api/conversations/capabilities?scope=frostaura/labs&employeeId={iris}"));
        Assert.Equal(("may-not", "frostaura/labs"), (denied["webSearch"]!["rule"]!.GetValue<string>(), denied["webSearch"]!["setAtPath"]!.GetValue<string>()));
        Assert.DoesNotContain("web_search", denied["tools"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.DoesNotContain("change_app", denied["actions"]!.AsArray().Select(t => t!.GetValue<string>()));
        Assert.False(denied["narrowing"]!["noWebSearch"]!.GetValue<bool>());
    }

    [Fact]
    public async Task An_image_part_reaches_the_provider_whole_and_a_text_only_route_refuses_it()
    {
        var operatorClient = await app.SignInAsync("dean@frostaura.net");
        await operatorClient.TopUpAsync("frostaura", 50m);
        var data = Convert.ToBase64String(AttachmentChecksTests.Png(64, 64));
        object Call(string taskType) => new
        {
            taskType,
            scope = "frostaura/labs",
            messages = new object[]
            {
                new
                {
                    role = "user",
                    content = new object[]
                    {
                        new { type = "text", text = "What is in this picture?" },
                        new { type = "image_url", image_url = new { url = $"data:image/png;base64,{data}" } },
                    },
                },
            },
        };
        await ControlPlaneApp.Ok(service.PostAsJsonAsync("/internal/model/chat", Call("research")));
        var sent = Assert.Single(openRouter.Requests)["messages"]![0]!["content"]!.AsArray();
        Assert.Equal("What is in this picture?", sent[0]!["text"]!.GetValue<string>());
        Assert.Equal($"data:image/png;base64,{data}", sent[1]!["image_url"]!["url"]!.GetValue<string>());

        var refused = await ControlPlaneApp.Expect(await service.PostAsJsonAsync("/internal/model/chat", Call("chat")), (HttpStatusCode)422);
        Assert.Equal("images_not_accepted", refused["code"]!.GetValue<string>());
        Assert.Single(openRouter.Requests);
    }

    private async Task<long> CountAsync(Guid organisation, string sql)
    {
        await using var connection = await TenantAsync(organisation);
        await using var command = new NpgsqlCommand(sql, connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task ExecuteAsync(Guid organisation, string sql)
    {
        await using var connection = await TenantAsync(organisation);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>A connection as the platform's tenant role in one organisation: row-level security decides what it sees.</summary>
    private async Task<NpgsqlConnection> TenantAsync(Guid organisation)
    {
        var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"SET ROLE {TenantSession.AppRole}; SELECT set_config('endgame.organisation_id', @org, false);", connection);
        command.Parameters.AddWithValue("org", organisation.ToString());
        await command.ExecuteNonQueryAsync();
        return connection;
    }
}
