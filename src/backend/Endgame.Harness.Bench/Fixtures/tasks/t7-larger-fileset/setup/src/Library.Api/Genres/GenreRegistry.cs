namespace Library.Api.Genres;

/// <summary>The genres the library offers. Started by hand; it is out of date.</summary>
public static class GenreRegistry
{
    public static IReadOnlyList<IGenre> All { get; } = [new Fantasy(), new Crime(), new History()];
}
