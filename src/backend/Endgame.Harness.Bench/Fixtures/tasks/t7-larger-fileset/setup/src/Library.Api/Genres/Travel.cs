namespace Library.Api.Genres;

/// <summary>Travel. Reviewed every spring.</summary>
public sealed class Travel : IGenre
{
    public string Code => "TRA";

    public string Name => "Travel";

    public int MaxLoanDays => 21;
}
