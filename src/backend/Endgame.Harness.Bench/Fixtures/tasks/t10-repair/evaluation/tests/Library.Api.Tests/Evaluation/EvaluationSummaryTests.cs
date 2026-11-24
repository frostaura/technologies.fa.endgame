using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Library.Api.Tests.Evaluation;

public class EvaluationSummaryTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public EvaluationSummaryTests(LibraryFactory factory) => _client = factory.CreateClient();

    private async Task<int> Create(int year)
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "T " + Guid.NewGuid(), author = "A", year });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task A_summary_says_whether_the_book_is_a_classic_fifty_years_or_more_after_publication()
    {
        var thisYear = DateTime.UtcNow.Year;
        var old = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{await Create(thisYear - 50)}/summary");
        Assert.True(old.TryGetProperty("isClassic", out var oldClassic), "The summary must carry isClassic (boolean): true when the book was published 50 or more years ago.");
        Assert.True(oldClassic.GetBoolean(), "A book published exactly 50 years ago is a classic.");
        var young = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{await Create(thisYear - 49)}/summary");
        Assert.False(young.GetProperty("isClassic").GetBoolean(), "A book published 49 years ago is not a classic.");
        Assert.Equal(49, young.GetProperty("age").GetInt32());
    }

    [Fact]
    public async Task An_unknown_book_is_404_with_the_api_error_code()
    {
        var res = await _client.GetAsync("/api/books/999999/summary");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("book_not_found", (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }
}
