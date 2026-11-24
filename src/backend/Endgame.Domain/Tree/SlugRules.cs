using System.Text.RegularExpressions;

namespace Endgame.Domain.Tree;

/// <summary>
/// The address segment of a node in the cascade. Lower-case letters, digits and single hyphens
/// between them, at most 63 characters: the rules of one DNS label, because an organisation's
/// slug becomes its subdomain and every slug appears in the path form of an address.
/// </summary>
public static partial class SlugRules
{
    public const int MaxLength = 63;

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    public static bool IsValid(string? value) =>
        !string.IsNullOrEmpty(value) && value.Length <= MaxLength && Pattern().IsMatch(value);

    public static string Require(string? value) =>
        IsValid(value)
            ? value!
            : throw new DomainException(
                $"'{value}' is not a valid slug: use 1-{MaxLength} lower-case letters, digits and single hyphens, starting and ending with a letter or digit.");
}
