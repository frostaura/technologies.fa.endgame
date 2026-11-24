namespace Library.Api.Genres;

/// <summary>Humour. Mostly donated stock.</summary>
public sealed class Humour : IGenre
{
    public string Code => "HUM";

    public string Name => "Humour";

    public int MaxLoanDays => 7;

    public bool Retired => true;
}
