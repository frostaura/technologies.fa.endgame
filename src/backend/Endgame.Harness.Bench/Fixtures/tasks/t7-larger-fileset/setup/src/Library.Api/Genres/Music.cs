namespace Library.Api.Genres;

/// <summary>Music. Reviewed every spring.</summary>
public sealed class Music : IGenre
{
    public string Code => "MUS";

    public string Name => "Music";

    public int MaxLoanDays => 21;
}
