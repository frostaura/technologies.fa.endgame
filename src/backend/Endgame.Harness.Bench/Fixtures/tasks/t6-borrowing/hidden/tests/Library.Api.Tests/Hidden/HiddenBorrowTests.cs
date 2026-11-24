using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenBorrowTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenBorrowTests(LibraryFactory factory) => _client = factory.CreateClient();

    private async Task<JsonElement> Create()
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "Loanable " + Guid.NewGuid(), author = "L", year = 2001 });
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static void AssertApiError(JsonElement e)
    {
        Assert.False(string.IsNullOrWhiteSpace(e.GetProperty("code").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(e.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task New_books_are_available()
    {
        var book = await Create();
        Assert.True(book.GetProperty("isAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, book.GetProperty("dueDate").ValueKind);
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/books?pageSize=50");
        Assert.All(page.GetProperty("items").EnumerateArray(), b => Assert.True(b.TryGetProperty("isAvailable", out _)));
    }

    [Fact]
    public async Task Borrow_sets_due_date_from_the_configured_policy_and_return_clears_it()
    {
        var id = (await Create()).GetProperty("id").GetInt32();
        var borrowed = await _client.PostAsync($"/api/books/{id}/borrow", null);
        Assert.Equal(HttpStatusCode.OK, borrowed.StatusCode);
        var b = await borrowed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(b.GetProperty("isAvailable").GetBoolean());
        var due = b.GetProperty("dueDate").GetString();
        var expected = new[] { DateTime.UtcNow, DateTime.Now }.Select(d => DateOnly.FromDateTime(d).AddDays(21).ToString("yyyy-MM-dd"));
        Assert.Contains(due, expected);

        var fetched = await _client.GetFromJsonAsync<JsonElement>($"/api/books/{id}");
        Assert.False(fetched.GetProperty("isAvailable").GetBoolean());
        Assert.Equal(due, fetched.GetProperty("dueDate").GetString());

        var again = await _client.PostAsync($"/api/books/{id}/borrow", null);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        AssertApiError(await again.Content.ReadFromJsonAsync<JsonElement>());

        var returned = await _client.PostAsync($"/api/books/{id}/return", null);
        Assert.Equal(HttpStatusCode.OK, returned.StatusCode);
        var r = await returned.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(r.GetProperty("isAvailable").GetBoolean());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("dueDate").ValueKind);

        var returnAgain = await _client.PostAsync($"/api/books/{id}/return", null);
        Assert.Equal(HttpStatusCode.Conflict, returnAgain.StatusCode);
        AssertApiError(await returnAgain.Content.ReadFromJsonAsync<JsonElement>());
    }

    [Fact]
    public async Task Unknown_ids_are_404()
    {
        var a = await _client.PostAsync("/api/books/888888/borrow", null);
        Assert.Equal(HttpStatusCode.NotFound, a.StatusCode);
        Assert.Equal("book_not_found", (await a.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        var b = await _client.PostAsync("/api/books/888888/return", null);
        Assert.Equal(HttpStatusCode.NotFound, b.StatusCode);
    }
}
