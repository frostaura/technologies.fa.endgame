namespace Library.Api.Genres;

/// <summary>Technology. Mostly donated stock.</summary>
public sealed class Technology : IGenre
{
    public string Code => "TEC";

    public string Name => "Technology";

    public int MaxLoanDays => 14;
}
