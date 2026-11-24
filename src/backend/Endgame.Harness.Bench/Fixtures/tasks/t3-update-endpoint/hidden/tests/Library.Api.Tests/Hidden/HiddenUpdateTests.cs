using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenUpdateTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenUpdateTests(LibraryFactory factory) => _client = factory.CreateClient();

    private async Task<int> Create(string title, string author, int year = 2000)
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title, author, year });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    private static async Task<string> Code(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;

    [Fact]
    public async Task Update_succeeds_and_trims()
    {
        var id = await Create("Old " + Guid.NewGuid(), "Someone");
        var res = await _client.PutAsJsonAsync($"/api/books/{id}", new { title = "  New Title X1 ", author = " New Author ", year = 1999 });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("New Title X1", body.GetProperty("title").GetString());
        Assert.Equal("New Author", body.GetProperty("author").GetString());
        Assert.Equal(1999, body.GetProperty("year").GetInt32());
        var fetched = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{id}");
        Assert.Equal("New Title X1", fetched.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Unknown_id_is_404_with_existing_code()
    {
        var res = await _client.PutAsJsonAsync("/api/books/987654", new { title = "T", author = "A", year = 2000 });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("book_not_found", await Code(res));
    }

    [Theory]
    [InlineData("", "A", 2000)]
    [InlineData("T", "  ", 2000)]
    [InlineData(null, "A", 2000)]
    [InlineData("T", "A", 1449)]
    [InlineData("T", "A", 3000)]
    public async Task Invalid_body_is_400(string? title, string? author, int year)
    {
        var id = await Create("Valid " + Guid.NewGuid(), "V");
        var res = await _client.PutAsJsonAsync($"/api/books/{id}", new { title, author, year });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal("validation_failed", await Code(res));
    }

    [Fact]
    public async Task Boundary_years_are_valid()
    {
        var id = await Create("Boundary " + Guid.NewGuid(), "B");
        var a = await _client.PutAsJsonAsync($"/api/books/{id}", new { title = "Boundary A " + id, author = "B", year = 1450 });
        Assert.Equal(HttpStatusCode.OK, a.StatusCode);
        var b = await _client.PutAsJsonAsync($"/api/books/{id}", new { title = "Boundary A " + id, author = "B", year = DateTime.UtcNow.Year });
        Assert.Equal(HttpStatusCode.OK, b.StatusCode);
    }

    [Fact]
    public async Task Clash_with_another_book_is_409_but_self_is_fine()
    {
        var suffix = Guid.NewGuid().ToString("N");
        await Create("Taken " + suffix, "Writer");
        var id = await Create("Mine " + suffix, "Writer");
        var clash = await _client.PutAsJsonAsync($"/api/books/{id}", new { title = "Taken " + suffix, author = "Writer", year = 2000 });
        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);
        Assert.Equal("duplicate_book", await Code(clash));
        var same = await _client.PutAsJsonAsync($"/api/books/{id}", new { title = "Mine " + suffix, author = "Writer", year = 2005 });
        Assert.Equal(HttpStatusCode.OK, same.StatusCode);
    }
}
