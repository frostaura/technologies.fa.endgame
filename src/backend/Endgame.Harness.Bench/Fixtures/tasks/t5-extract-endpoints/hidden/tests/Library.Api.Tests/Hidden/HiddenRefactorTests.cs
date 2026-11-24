using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Routing;

namespace Library.Api.Tests.Hidden;

public class HiddenRefactorTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenRefactorTests(LibraryFactory factory) => _client = factory.CreateClient();

    [Fact]
    public void BookEndpoints_exposes_the_extension()
    {
        var type = typeof(Program).Assembly.GetType("Library.Api.Endpoints.BookEndpoints");
        Assert.NotNull(type);
        Assert.True(type!.IsAbstract && type.IsSealed, "BookEndpoints must be static");
        var m = type.GetMethod("MapBookEndpoints", BindingFlags.Public | BindingFlags.Static);
        Assert.NotNull(m);
        Assert.True(m!.IsDefined(typeof(System.Runtime.CompilerServices.ExtensionAttribute), false));
        Assert.Equal(typeof(IEndpointRouteBuilder), m.GetParameters()[0].ParameterType);
        Assert.Equal(typeof(IEndpointRouteBuilder), m.ReturnType);
        var handlers = type.GetMethods(BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Public)
            .Where(x => x.Name != "MapBookEndpoints" && !x.Name.Contains('<')).ToList();
        Assert.True(handlers.Count >= 3, $"expected >= 3 named handler methods, found {handlers.Count}");
    }

    [Fact]
    public async Task Behaviour_is_unchanged()
    {
        var created = await _client.PostAsJsonAsync("/api/books", new { title = " Refactor ", author = " Kent ", year = 1999 });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Refactor", body.GetProperty("title").GetString());
        Assert.Equal($"/api/books/{body.GetProperty("id").GetInt32()}", created.Headers.Location!.OriginalString);
        var bad = await _client.PostAsJsonAsync("/api/books", new { title = "x", author = "", year = 1 });
        Assert.Equal("validation_failed", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        var missing = await _client.GetAsync("/api/books/424242");
        Assert.Equal("book_not_found", (await missing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        var page = await _client.GetFromJsonAsync<JsonElement>("/api/books?page=2&pageSize=500");
        Assert.Equal(50, page.GetProperty("pageSize").GetInt32());
        Assert.Equal(2, page.GetProperty("page").GetInt32());
    }
}
