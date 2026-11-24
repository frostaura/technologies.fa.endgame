using Library.Api.Services;

namespace Library.Api.Tests;

public class PagingTests
{
    [Theory]
    [InlineData(10, 3, 4)]
    [InlineData(9, 3, 3)]
    [InlineData(1, 20, 1)]
    public void TotalPages_rounds_up(int total, int size, int expected) =>
        Assert.Equal(expected, Paging.TotalPages(total, size));

    [Fact]
    public void Skip_starts_at_zero_on_first_page() => Assert.Equal(0, Paging.Skip(1, 20));
}
