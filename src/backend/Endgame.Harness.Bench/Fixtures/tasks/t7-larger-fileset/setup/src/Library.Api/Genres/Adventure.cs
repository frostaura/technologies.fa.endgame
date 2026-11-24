namespace Library.Api.Genres;

/// <summary>Adventure. Popular with book clubs.</summary>
public sealed class Adventure : IGenre
{
    public string Code => "ADV";

    public string Name => "Adventure";

    public int MaxLoanDays => 14;
}
