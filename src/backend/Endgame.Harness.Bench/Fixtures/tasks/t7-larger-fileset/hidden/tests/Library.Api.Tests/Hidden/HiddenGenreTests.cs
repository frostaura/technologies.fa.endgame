using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenGenreTests : IClassFixture<LibraryFactory>
{
    private static readonly (string Code, string Name, int Days)[] Expected =
    [
        ("ADV", "Adventure", 14),
        ("BIO", "Biography", 21),
        ("CHI", "Children", 7),
        ("CLA", "Classics", 28),
        ("COO", "Cookery", 14),
        ("CRI", "Crime", 14),
        ("DRA", "Drama", 21),
        ("FAN", "Fantasy", 21),
        ("HIS", "History", 28),
        ("HOR", "Horror", 14),
        ("MUS", "Music", 21),
        ("MYS", "Mystery", 14),
        ("PHI", "Philosophy", 28),
        ("POE", "Poetry", 21),
        ("ROM", "Romance", 14),
        ("SCI", "Science", 28),
        ("SFI", "Science fiction", 21),
        ("TEC", "Technology", 14),
        ("TRA", "Travel", 21),
        ("YOU", "Young adult", 14),
    ];

    private readonly HttpClient _client;
    public HiddenGenreTests(LibraryFactory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Every_offered_genre_is_listed_sorted_by_code_and_retired_ones_are_not()
    {
        var res = await _client.GetAsync("/api/genres");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var got = body.EnumerateArray().Select(g => (g.GetProperty("code").GetString()!, g.GetProperty("name").GetString()!, g.GetProperty("maxLoanDays").GetInt32())).ToArray();
        Assert.Equal(Expected, got);
    }

    [Fact]
    public void The_registry_lists_the_same_genres()
    {
        var codes = Library.Api.Genres.GenreRegistry.All.Select(g => g.Code).Order().ToArray();
        Assert.Equal(Expected.Select(e => e.Code).ToArray(), codes);
    }
}
