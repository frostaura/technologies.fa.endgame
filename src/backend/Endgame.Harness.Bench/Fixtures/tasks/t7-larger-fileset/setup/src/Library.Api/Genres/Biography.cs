namespace Library.Api.Genres;

/// <summary>Biography. Includes large-print editions.</summary>
public sealed class Biography : IGenre
{
    public string Code => "BIO";

    public string Name => "Biography";

    public int MaxLoanDays => 21;
}
