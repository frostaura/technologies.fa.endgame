using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenIsbnTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenIsbnTests(LibraryFactory factory) => _client = factory.CreateClient();

    private static string? Isbn(JsonElement e) =>
        e.TryGetProperty("isbn", out var v) ? (v.ValueKind == JsonValueKind.Null ? null : v.GetString()) : throw new Exception("no isbn property");

    [Fact]
    public async Task Isbn_round_trips_trimmed()
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "Neuromancer", author = "William Gibson", year = 1984, isbn = "  978-0441569595 " });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var created = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("978-0441569595", Isbn(created));
        var id = created.GetProperty("id").GetInt32();
        var fetched = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{id}");
        Assert.Equal("978-0441569595", Isbn(fetched));
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/books?pageSize=50");
        var item = page.GetProperty("items").EnumerateArray().Single(b => b.GetProperty("id").GetInt32() == id);
        Assert.Equal("978-0441569595", Isbn(item));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_isbn_is_null(string? isbn)
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "Book " + Guid.NewGuid(), author = "A", year = 2000, isbn });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var created = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Null(Isbn(created));
        var fetched = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{created.GetProperty("id").GetInt32()}");
        Assert.Null(Isbn(fetched));
    }

    [Fact]
    public async Task Missing_isbn_property_is_accepted()
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "No isbn " + Guid.NewGuid(), author = "B", year = 2001 });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }
}
