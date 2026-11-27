using System.Net;
using System.Net.Http.Json;
using App.Data;
using App.Notes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace App.Tests;

/// <summary>
/// A person's own record (AGENTS.md), by its example: following a note. It is keyed by the platform's stable user id, so
/// someone who leaves and comes back — a new session, the same person — is found again: they see "following", and
/// following again answers the follow they have, never a second one. The database's unique index holds that too.
/// </summary>
public sealed class NoteFollowTests(EndgameAppFactory<Program> app) : IClassFixture<EndgameAppFactory<Program>>
{
    private async Task<Guid> NoteAsync()
    {
        using var author = app.CreateClientFor("author@example.test");
        var created = await author.PostAsJsonAsync("/api/notes", new { title = "Dive briefing" });
        return (await created.Content.ReadFromJsonAsync<NoteDetail>())!.Id;
    }

    [Fact]
    public async Task Someone_who_comes_back_is_found_again_and_following_again_makes_no_second_follow()
    {
        var note = await NoteAsync();
        NoteFollowView first;
        using (var visit = app.CreateClientFor("ada@example.test"))
        {
            var before = await visit.GetFromJsonAsync<NoteFollowView>($"/api/notes/{note}/follow");
            Assert.False(before!.Following);
            var followed = await visit.PutAsync($"/api/notes/{note}/follow", null);
            Assert.Equal(HttpStatusCode.Created, followed.StatusCode);
            first = (await followed.Content.ReadFromJsonAsync<NoteFollowView>())!;
            Assert.True(first.Following);
            Assert.NotNull(first.Id);
        }

        // Later: a new session for the same person. The page reads their own record, and finds it.
        using var later = app.CreateClientFor("ada@example.test");
        var back = await later.GetFromJsonAsync<NoteFollowView>($"/api/notes/{note}/follow");
        Assert.Equal((first.Id, true, 1), (back!.Id, back.Following, back.Followers));

        // Asked to follow again (an old tab, a second click), they get the follow they already have.
        var again = await later.PutAsync($"/api/notes/{note}/follow", null);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(first.Id, (await again.Content.ReadFromJsonAsync<NoteFollowView>())!.Id);

        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        Assert.Equal(1, await db.NoteFollows.CountAsync(f => f.NoteId == note));
    }

    [Fact]
    public async Task Each_person_has_their_own_and_signed_out_nobody_follows()
    {
        var note = await NoteAsync();
        using var ada = app.CreateClientFor("ada@example.test");
        using var grace = app.CreateClientFor("grace@example.test");
        await ada.PutAsync($"/api/notes/{note}/follow", null);
        var graces = await grace.GetFromJsonAsync<NoteFollowView>($"/api/notes/{note}/follow");
        Assert.Equal((false, 1), (graces!.Following, graces.Followers));
        Assert.Equal(HttpStatusCode.Created, (await grace.PutAsync($"/api/notes/{note}/follow", null)).StatusCode);

        var signedOut = await app.CreateClient().GetFromJsonAsync<NoteFollowView>($"/api/notes/{note}/follow");
        Assert.Equal((false, false, 2), (signedOut!.SignedIn, signedOut.Following, signedOut.Followers));
        Assert.Equal(HttpStatusCode.Unauthorized, (await app.CreateClient().PutAsync($"/api/notes/{note}/follow", null)).StatusCode);

        var stopped = await (await ada.DeleteAsync($"/api/notes/{note}/follow")).Content.ReadFromJsonAsync<NoteFollowView>();
        Assert.Equal((false, 1), (stopped!.Following, stopped.Followers));
    }

    [Fact]
    public async Task The_database_refuses_a_second_follow_for_the_same_person_whatever_the_code_does()
    {
        var note = await NoteAsync();
        await using var scope = app.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.NoteFollows.Add(new NoteFollow { NoteId = note, PersonId = "usr_same", PersonName = "Ada" });
        await db.SaveChangesAsync();
        db.NoteFollows.Add(new NoteFollow { NoteId = note, PersonId = "usr_same", PersonName = "Ada" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task A_missing_note_cannot_be_followed()
    {
        using var ada = app.CreateClientFor("ada@example.test");
        Assert.Equal(HttpStatusCode.NotFound, (await ada.PutAsync($"/api/notes/{Guid.NewGuid()}/follow", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ada.GetAsync($"/api/notes/{Guid.NewGuid()}/follow")).StatusCode);
    }
}
