namespace Library.Api.Genres;

/// <summary>Classics. Shelved on the first floor.</summary>
public sealed class Classics : IGenre
{
    public string Code => "CLA";

    public string Name => "Classics";

    public int MaxLoanDays => 28;
}
