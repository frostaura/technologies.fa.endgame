namespace Library.Api.Genres;

/// <summary>War. Shelved on the first floor.</summary>
public sealed class War : IGenre
{
    public string Code => "WAR";

    public string Name => "War";

    public int MaxLoanDays => 21;

    public bool Retired => true;
}
