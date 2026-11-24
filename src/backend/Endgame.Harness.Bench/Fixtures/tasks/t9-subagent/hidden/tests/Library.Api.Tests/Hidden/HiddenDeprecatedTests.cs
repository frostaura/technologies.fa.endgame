using System.Net;
using System.Net.Http.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenDeprecatedTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenDeprecatedTests(LibraryFactory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Only_the_obsolete_handlers_routes_are_listed_sorted()
    {
        var res = await _client.GetAsync("/api/deprecated-routes");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(new[] { "/api/v1/catalogue/import-11", "/api/v1/holds/export-12", "/api/v1/holds/renew-03", "/api/v1/holds/renew-18", "/api/v1/loans/export-07", "/api/v1/loans/search-21", "/api/v1/loans/search-26", "/api/v1/members/close-29" }, await res.Content.ReadFromJsonAsync<string[]>());
    }
}
