namespace Library.Api.Genres;

/// <summary>Science. Popular with book clubs.</summary>
public sealed class Science : IGenre
{
    public string Code => "SCI";

    public string Name => "Science";

    public int MaxLoanDays => 28;
}
