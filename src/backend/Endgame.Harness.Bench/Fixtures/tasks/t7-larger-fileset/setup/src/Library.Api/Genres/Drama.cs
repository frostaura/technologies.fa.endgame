namespace Library.Api.Genres;

/// <summary>Drama. Includes large-print editions.</summary>
public sealed class Drama : IGenre
{
    public string Code => "DRA";

    public string Name => "Drama";

    public int MaxLoanDays => 21;
}
