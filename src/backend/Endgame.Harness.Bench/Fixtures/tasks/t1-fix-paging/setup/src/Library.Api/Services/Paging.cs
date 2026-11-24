namespace Library.Api.Services;

public static class Paging
{
    public const int MaxPageSize = 50;

    public static int TotalPages(int totalItems, int pageSize)
    {
        if (pageSize <= 0) throw new ArgumentOutOfRangeException(nameof(pageSize));
        return totalItems / pageSize;
    }

    public static int Skip(int page, int pageSize) => (Math.Max(page, 1) - 1) * pageSize;

    public static int ClampPageSize(int pageSize) => Math.Clamp(pageSize, 1, MaxPageSize);
}
