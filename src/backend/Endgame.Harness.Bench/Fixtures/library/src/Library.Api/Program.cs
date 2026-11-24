using Library.Api.Contracts;
using Library.Api.Data;
using Library.Api.Models;
using Library.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<LibraryDb>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Library")));
builder.Services.Configure<LoanPolicy>(builder.Configuration.GetSection(LoanPolicy.Section));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<LibraryDb>().Database.Migrate();
}

app.MapGet("/api/books", async (LibraryDb db, int page = 1, int pageSize = 20) =>
{
    pageSize = Paging.ClampPageSize(pageSize);
    var total = await db.Books.CountAsync();
    var items = await db.Books
        .OrderBy(b => b.Id)
        .Skip(Paging.Skip(page, pageSize))
        .Take(pageSize)
        .Select(b => BookDto.From(b))
        .ToListAsync();
    return Results.Ok(new PagedResult<BookDto>(items, page, pageSize, total, Paging.TotalPages(total, pageSize)));
});

app.MapGet("/api/books/{id:int}", async (int id, LibraryDb db) =>
    await db.Books.FindAsync(id) is { } book
        ? Results.Ok(BookDto.From(book))
        : Results.NotFound(new ApiError("book_not_found", $"No book with id {id}.")));

app.MapPost("/api/books", async (CreateBookRequest req, LibraryDb db) =>
{
    if (string.IsNullOrWhiteSpace(req.Title) || string.IsNullOrWhiteSpace(req.Author))
        return Results.BadRequest(new ApiError("validation_failed", "Title and author are required."));

    var title = req.Title.Trim();
    var author = req.Author.Trim();
    if (await db.Books.AnyAsync(b => b.Title == title && b.Author == author))
        return Results.Conflict(new ApiError("duplicate_book", "That book is already in the library."));

    var book = new Book { Title = title, Author = author, Year = req.Year };
    db.Books.Add(book);
    await db.SaveChangesAsync();
    return Results.Created($"/api/books/{book.Id}", BookDto.From(book));
});

app.Run();

public partial class Program;
