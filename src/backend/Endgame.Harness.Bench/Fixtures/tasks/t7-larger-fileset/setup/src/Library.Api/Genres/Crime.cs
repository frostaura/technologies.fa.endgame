namespace Library.Api.Genres;

/// <summary>Crime. Reviewed every spring.</summary>
public sealed class Crime : IGenre
{
    public string Code => "CRI";

    public string Name => "Crime";

    public int MaxLoanDays => 14;
}
