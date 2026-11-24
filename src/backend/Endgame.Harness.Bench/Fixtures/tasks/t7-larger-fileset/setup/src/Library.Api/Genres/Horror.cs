namespace Library.Api.Genres;

/// <summary>Horror. Popular with book clubs.</summary>
public sealed class Horror : IGenre
{
    public string Code => "HOR";

    public string Name => "Horror";

    public int MaxLoanDays => 14;
}
