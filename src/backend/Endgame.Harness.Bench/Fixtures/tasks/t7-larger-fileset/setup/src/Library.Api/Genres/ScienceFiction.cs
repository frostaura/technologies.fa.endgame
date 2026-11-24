namespace Library.Api.Genres;

/// <summary>Science fiction. Popular with book clubs.</summary>
public sealed class ScienceFiction : IGenre
{
    public string Code => "SFI";

    public string Name => "Science fiction";

    public int MaxLoanDays => 21;
}
