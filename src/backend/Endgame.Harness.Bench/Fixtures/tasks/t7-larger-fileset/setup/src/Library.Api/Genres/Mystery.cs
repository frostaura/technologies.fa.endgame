namespace Library.Api.Genres;

/// <summary>Mystery. Includes large-print editions.</summary>
public sealed class Mystery : IGenre
{
    public string Code => "MYS";

    public string Name => "Mystery";

    public int MaxLoanDays => 14;
}
