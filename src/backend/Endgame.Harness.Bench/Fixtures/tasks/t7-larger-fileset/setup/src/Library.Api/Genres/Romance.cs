namespace Library.Api.Genres;

/// <summary>Romance. Mostly donated stock.</summary>
public sealed class Romance : IGenre
{
    public string Code => "ROM";

    public string Name => "Romance";

    public int MaxLoanDays => 14;
}
