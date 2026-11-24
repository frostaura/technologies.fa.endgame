using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Policy;

/// <summary>One network's outbound allow-list, keyed by its subnet (ARCH-005).</summary>
/// <param name="Key">A stable label for the rule: the network's name.</param>
/// <param name="Subnet">The source subnet the proxy matches requests against.</param>
/// <param name="Hosts">Allowed destination hosts; <c>*.example.com</c> allows every subdomain.</param>
/// <param name="Platform">Whether this network may reach the platform API.</param>
public sealed record EgressRule(string Key, Ipv4Cidr Subnet, IReadOnlyList<string> Hosts, bool Platform);

/// <summary>
/// Renders the egress proxy's policy: default deny, then one allow per network for exactly the
/// hosts it was given. The proxy matches on source subnet, so one app's allow-list is never
/// another's, and a network with no rule reaches nothing.
/// </summary>
public static partial class EgressRules
{
    private const int MaxHostLength = 253;

    /// <summary>
    /// Normalises an allow-list entry, or returns null when it is not a host name: lower case, no
    /// scheme, port or path; <c>*.</c> only as a whole leading label.
    /// </summary>
    public static string? NormaliseHost(string? entry)
    {
        if (string.IsNullOrWhiteSpace(entry))
        {
            return null;
        }

        var host = entry.Trim().ToLowerInvariant().TrimEnd('.');
        var wildcard = host.StartsWith("*.", StringComparison.Ordinal);
        var name = wildcard ? host[2..] : host;
        if (name.Length is 0 or > MaxHostLength || !HostName().IsMatch(name) || !name.Contains('.', StringComparison.Ordinal))
        {
            return null;
        }

        return wildcard ? "*." + name : name;
    }

    /// <summary>Normalises a whole list, refusing it if any entry is not a host.</summary>
    public static IReadOnlyList<string> NormaliseAll(IEnumerable<string>? entries, out IReadOnlyList<string> rejected)
    {
        var accepted = new SortedSet<string>(StringComparer.Ordinal);
        var bad = new List<string>();
        foreach (var entry in entries ?? [])
        {
            if (NormaliseHost(entry) is { } host)
            {
                accepted.Add(host);
            }
            else
            {
                bad.Add(entry);
            }
        }

        rejected = bad;
        return accepted.ToList();
    }

    /// <summary>The proxy configuration fragment for <paramref name="rules"/>, deterministic in order.</summary>
    public static string Render(IEnumerable<EgressRule> rules, string platformHost, int platformPort)
    {
        var text = new StringBuilder();
        text.AppendLine("# Written by Dock. Every line is regenerated; edits here are lost.");
        text.AppendLine(CultureInfo.InvariantCulture, $"acl endgame_platform_host dstdomain {platformHost}");
        text.AppendLine(CultureInfo.InvariantCulture, $"acl endgame_platform_port port {platformPort}");
        var ordered = rules.OrderBy(r => r.Key, StringComparer.Ordinal).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            var rule = ordered[i];
            text.AppendLine(CultureInfo.InvariantCulture, $"# {rule.Key}");
            text.AppendLine(CultureInfo.InvariantCulture, $"acl endgame_n{i}_src src {rule.Subnet}");
            if (rule.Platform)
            {
                text.AppendLine(CultureInfo.InvariantCulture, $"http_access allow endgame_n{i}_src endgame_platform_host endgame_platform_port");
            }
        }

        // Past the platform, nothing private: an allowed name that resolves inside is still refused.
        text.AppendLine("http_access deny endgame_private");
        for (var i = 0; i < ordered.Count; i++)
        {
            var domains = Collapse(ordered[i].Hosts);
            if (domains.Count > 0)
            {
                text.AppendLine(CultureInfo.InvariantCulture, $"acl endgame_n{i}_dst dstdomain {string.Join(' ', domains)}");
                text.AppendLine(CultureInfo.InvariantCulture, $"http_access allow endgame_n{i}_src endgame_n{i}_dst");
            }
        }

        return text.ToString();
    }

    // The proxy refuses a list holding both `example.com` and `.example.com`-style overlaps, so a
    // wildcard swallows the bare name and any narrower entry beneath it.
    private static List<string> Collapse(IEnumerable<string> hosts)
    {
        var normalised = hosts.Select(NormaliseHost).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
        var wildcards = normalised.Where(h => h.StartsWith("*.", StringComparison.Ordinal)).Select(h => h[2..]).ToList();
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var host in normalised)
        {
            var bare = host.StartsWith("*.", StringComparison.Ordinal) ? host[2..] : host;
            var coveredByWider = wildcards.Any(w => w != bare && bare.EndsWith("." + w, StringComparison.Ordinal));
            if (coveredByWider)
            {
                continue;
            }

            if (host.StartsWith("*.", StringComparison.Ordinal))
            {
                result.Add("." + bare);
            }
            else if (!wildcards.Contains(bare))
            {
                result.Add(bare);
            }
        }

        return result.ToList();
    }

    [GeneratedRegex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")]
    private static partial Regex HostName();
}
