using Library.Api.Models;

namespace Library.Api.Contracts;

public record BookDto(int Id, string Title, string Author, int Year)
{
    public static BookDto From(Book b) => new(b.Id, b.Title, b.Author, b.Year);
}

public record CreateBookRequest(string? Title, string? Author, int Year);

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalItems, int TotalPages);
