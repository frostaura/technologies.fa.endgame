namespace Library.Api.Genres;

/// <summary>Philosophy. Popular with book clubs.</summary>
public sealed class Philosophy : IGenre
{
    public string Code => "PHI";

    public string Name => "Philosophy";

    public int MaxLoanDays => 28;
}
