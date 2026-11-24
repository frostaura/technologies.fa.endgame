namespace Library.Api.Genres;

/// <summary>Children. Reviewed every spring.</summary>
public sealed class Children : IGenre
{
    public string Code => "CHI";

    public string Name => "Children";

    public int MaxLoanDays => 7;
}
