namespace Library.Api.Genres;

/// <summary>A shelf genre. Each genre is its own class in this folder.</summary>
public interface IGenre
{
    /// <summary>Three upper-case letters, unique.</summary>
    string Code { get; }

    string Name { get; }

    /// <summary>How long a book of this genre may be borrowed for, in days.</summary>
    int MaxLoanDays { get; }

    /// <summary>A retired genre is kept for old records but no longer offered.</summary>
    bool Retired => false;
}
