namespace Library.Api.Genres;

/// <summary>Art. Mostly donated stock.</summary>
public sealed class Art : IGenre
{
    public string Code => "ART";

    public string Name => "Art";

    public int MaxLoanDays => 21;

    public bool Retired => true;
}
