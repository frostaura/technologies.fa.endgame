using System.Text.RegularExpressions;

namespace Endgame.Domain.Tree;

/// <summary>
/// The address segment of a node in the cascade (ARCH-004): lower-case letters, digits and single
/// hyphens between them, 2 to 40 characters, unique among siblings. An organisation's slug becomes
/// its subdomain, so it must also be one DNS label and may not take a name FrostAura uses itself.
/// </summary>
public static partial class SlugRules
{
    public const int MinLength = 2;

    public const int MaxLength = 40;

    /// <summary>Subdomains of frostaura.net that an organisation may never take.</summary>
    public static readonly IReadOnlySet<string> ReservedOrganisationSlugs = new HashSet<string>(StringComparer.Ordinal)
    {
        "www", "api", "app", "apps", "admin", "endgame", "console", "mail", "smtp", "status", "docs",
        "auth", "login", "internal", "static", "assets", "cdn", "god", "operator", "support",
    };

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    public static bool IsValid(string? value) =>
        !string.IsNullOrEmpty(value) && value.Length is >= MinLength and <= MaxLength && Pattern().IsMatch(value);

    public static string Require(string? value) =>
        IsValid(value)
            ? value!
            : throw new DomainException(
                $"'{value}' is not a valid slug: use {MinLength}-{MaxLength} lower-case letters, digits and single hyphens, starting and ending with a letter or digit.");

    public static string RequireOrganisationSlug(string? value)
    {
        var slug = Require(value);
        return ReservedOrganisationSlugs.Contains(slug)
            ? throw new DomainException($"'{slug}' is reserved and cannot name an organisation.")
            : slug;
    }
}
