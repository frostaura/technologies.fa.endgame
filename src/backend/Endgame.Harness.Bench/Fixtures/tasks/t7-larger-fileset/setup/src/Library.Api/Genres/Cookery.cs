namespace Library.Api.Genres;

/// <summary>Cookery. Popular with book clubs.</summary>
public sealed class Cookery : IGenre
{
    public string Code => "COO";

    public string Name => "Cookery";

    public int MaxLoanDays => 14;
}
