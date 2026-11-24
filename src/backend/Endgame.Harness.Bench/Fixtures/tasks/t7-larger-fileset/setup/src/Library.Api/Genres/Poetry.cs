namespace Library.Api.Genres;

/// <summary>Poetry. Reviewed every spring.</summary>
public sealed class Poetry : IGenre
{
    public string Code => "POE";

    public string Name => "Poetry";

    public int MaxLoanDays => 21;
}
