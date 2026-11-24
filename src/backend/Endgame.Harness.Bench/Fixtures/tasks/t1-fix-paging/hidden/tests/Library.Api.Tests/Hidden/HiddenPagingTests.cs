using Library.Api.Services;

namespace Library.Api.Tests.Hidden;

public class HiddenPagingTests
{
    [Theory]
    [InlineData(0, 10, 0)]
    [InlineData(21, 7, 3)]
    [InlineData(22, 7, 4)]
    [InlineData(1, 1, 1)]
    [InlineData(101, 50, 3)]
    public void TotalPages_is_a_ceiling(int total, int size, int expected) =>
        Assert.Equal(expected, Paging.TotalPages(total, size));

    [Fact]
    public void Zero_page_size_still_throws() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => Paging.TotalPages(5, 0));
}
