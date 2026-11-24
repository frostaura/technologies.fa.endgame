using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using App.Notes;

namespace App.Tests;

/// <summary>
/// The notes API end to end: the real app, its own throwaway database, the dev platform fake.
/// One factory (and so one database) per test class.
/// </summary>
public sealed class NotesApiTests(EndgameAppFactory<Program> app) : IClassFixture<EndgameAppFactory<Program>>
{
    [Fact]
    public async Task A_written_note_can_be_listed_and_read_back()
    {
        using var ada = app.CreateClientFor("ada@example.test");
        var created = await ada.PostAsJsonAsync("/api/notes", new { title = "  Groceries  ", body = "Milk" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var note = await created.Content.ReadFromJsonAsync<NoteDetail>();
        Assert.NotNull(note);
        Assert.Equal("Groceries", note.Title);
        Assert.Equal("ada", note.AuthorName);
        Assert.Equal($"notes/{note.Id}", created.Headers.Location?.OriginalString);

        // Reading needs no sign-in.
        using var anyone = app.CreateClient();
        var list = await anyone.GetFromJsonAsync<List<NoteSummary>>("/api/notes");
        Assert.Contains(list!, n => n.Id == note.Id);
        var read = await anyone.GetFromJsonAsync<NoteDetail>($"/api/notes/{note.Id}");
        Assert.Equal("Milk", read!.Body);
    }

    [Fact]
    public async Task Writing_needs_a_signed_in_user()
    {
        using var anyone = app.CreateClient();
        var response = await anyone.PostAsJsonAsync("/api/notes", new { title = "Nope" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith("/_endgame/auth/sign-in", problem.GetProperty("signInUrl").GetString());
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public async Task A_note_without_a_title_is_refused_field_by_field(string? title)
    {
        using var ada = app.CreateClientFor("ada@example.test");
        var response = await ada.PostAsJsonAsync("/api/notes", new { title, body = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("errors").TryGetProperty("Title", out _), problem.ToString());
    }

    [Fact]
    public async Task A_missing_note_is_a_404_problem_not_an_empty_body()
    {
        var response = await app.CreateClient().GetAsync($"/api/notes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Writing_a_note_records_a_product_event()
    {
        using var ada = app.CreateClientFor("ada@example.test");
        await ada.PostAsJsonAsync("/api/notes", new { title = "Tracked" });
        for (var i = 0; i < 60 && !app.Platform.Events.Any(e => e["name"]?.GetValue<string>() == "note.created"); i++)
        {
            await Task.Delay(50);
        }

        Assert.Contains(app.Platform.Events, e => e["name"]?.GetValue<string>() == "note.created");
    }
}
