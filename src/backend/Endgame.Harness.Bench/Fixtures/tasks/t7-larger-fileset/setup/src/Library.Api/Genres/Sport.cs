namespace Library.Api.Genres;

/// <summary>Sport. Reviewed every spring.</summary>
public sealed class Sport : IGenre
{
    public string Code => "SPO";

    public string Name => "Sport";

    public int MaxLoanDays => 7;

    public bool Retired => true;
}
