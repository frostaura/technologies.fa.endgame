namespace Library.Api.Genres;

/// <summary>History. Includes large-print editions.</summary>
public sealed class History : IGenre
{
    public string Code => "HIS";

    public string Name => "History";

    public int MaxLoanDays => 28;
}
