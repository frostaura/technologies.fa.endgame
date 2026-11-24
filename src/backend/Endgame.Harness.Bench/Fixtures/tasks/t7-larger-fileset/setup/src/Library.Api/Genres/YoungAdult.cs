namespace Library.Api.Genres;

/// <summary>Young adult. Reviewed every spring.</summary>
public sealed class YoungAdult : IGenre
{
    public string Code => "YOU";

    public string Name => "Young adult";

    public int MaxLoanDays => 14;
}
