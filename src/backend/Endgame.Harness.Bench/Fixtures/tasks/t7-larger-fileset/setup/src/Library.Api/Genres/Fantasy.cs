namespace Library.Api.Genres;

/// <summary>Fantasy. Shelved on the first floor.</summary>
public sealed class Fantasy : IGenre
{
    public string Code => "FAN";

    public string Name => "Fantasy";

    public int MaxLoanDays => 21;
}
