using System.Net;
using System.Net.Http.Json;

namespace Library.Api.Tests.Hidden;

public class HiddenLimitTests : IClassFixture<LibraryFactory>
{
    private readonly HttpClient _client;
    public HiddenLimitTests(LibraryFactory factory) => _client = factory.CreateClient();

    [Fact]
    public async Task Every_tier_in_the_policies_has_its_limit()
    {
        var res = await _client.GetAsync("/api/limits");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var got = await res.Content.ReadFromJsonAsync<Dictionary<string, int>>();
        var expected = new Dictionary<string, int> { ["BRONZE"] = 3, ["SILVER"] = 5, ["GOLD"] = 8, ["PLATINUM"] = 12, ["STUDENT"] = 6, ["SENIOR"] = 7, ["FAMILY"] = 15, ["STAFF"] = 20, ["VISITOR"] = 1, ["SCHOOL"] = 30, ["RESEARCH"] = 25, ["JUNIOR"] = 4, ["PATRON"] = 10, ["ARCHIVE"] = 2 };
        Assert.Equal(expected.OrderBy(kv => kv.Key), got!.OrderBy(kv => kv.Key));
    }
}
