using System.Globalization;
using System.Text.RegularExpressions;

namespace Endgame.Tests.Hosting;

/// <summary>The egress proxy's configuration (<c>src/egress/squid.conf</c>), read as shipped.</summary>
public sealed partial class EgressConfigTests
{
    private static string Config()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var file = Path.Combine(dir.FullName, "src", "egress", "squid.conf");
            if (File.Exists(file))
            {
                return File.ReadAllText(file);
            }
        }

        throw new FileNotFoundException("src/egress/squid.conf was not found above the test assembly.");
    }

    [Fact]
    public void A_peer_that_restarts_on_a_new_address_is_found_again_within_seconds()
    {
        // A control plane restarted by a redeploy gets a new address; squid's default keeps the old
        // one for hours, sending every app's platform calls to whatever container holds it now.
        var match = PositiveTtl().Match(Config());
        Assert.True(match.Success, "squid.conf sets no positive_dns_ttl: squid's default caches a name for hours.");
        Assert.InRange(int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture), 1, 30);
    }

    [Fact]
    public void Everything_not_allowed_is_denied()
    {
        var config = Config();
        Assert.EndsWith("http_access deny all", config.TrimEnd(), StringComparison.Ordinal);
        Assert.Contains("forwarded_for delete", config, StringComparison.Ordinal);
    }

    [GeneratedRegex(@"^positive_dns_ttl\s+(\d+)\s+seconds?\s*$", RegexOptions.Multiline)]
    private static partial Regex PositiveTtl();
}
