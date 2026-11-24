using System.Net;
using System.Net.Http.Json;
using Library.Api.Contracts;

namespace Library.Api.Tests;

public class BooksApiTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;

    public BooksApiTests(LibraryFactory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Create_then_get_round_trips()
    {
        var created = await _client.PostAsJsonAsync("/api/books", new { title = "Dune", author = "Frank Herbert", year = 1965 });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var book = await created.Content.ReadFromJsonAsync<BookDto>();

        var fetched = await _client.GetFromJsonAsync<BookDto>($"/api/books/{book!.Id}");
        Assert.Equal("Dune", fetched!.Title);
        Assert.Equal(1965, fetched.Year);
    }

    [Fact]
    public async Task Missing_title_is_rejected()
    {
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "", author = "Nobody", year = 2000 });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var err = await res.Content.ReadFromJsonAsync<ApiError>();
        Assert.Equal("validation_failed", err!.Code);
    }

    [Fact]
    public async Task Duplicate_is_a_conflict()
    {
        await _client.PostAsJsonAsync("/api/books", new { title = "Emma", author = "Jane Austen", year = 1815 });
        var res = await _client.PostAsJsonAsync("/api/books", new { title = "Emma", author = "Jane Austen", year = 1815 });
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Unknown_book_is_404()
    {
        var res = await _client.GetAsync("/api/books/999999");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task List_is_paged()
    {
        var page = await _client.GetFromJsonAsync<PagedResult<BookDto>>("/api/books?page=1&pageSize=1");
        Assert.True(page!.PageSize == 1);
    }
}
