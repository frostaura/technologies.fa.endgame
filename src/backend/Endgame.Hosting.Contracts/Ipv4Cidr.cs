using System.Globalization;
using System.Net;

namespace Endgame.Hosting.Contracts;

/// <summary>An IPv4 network in CIDR form: app subnets, and the pool Dock cuts them from.</summary>
public readonly record struct Ipv4Cidr(uint Network, int PrefixLength)
{
    public uint Size => PrefixLength == 0 ? uint.MaxValue : 1u << (32 - PrefixLength);

    public uint Last => Network + (Size - 1);

    public static bool TryParse(string? text, out Ipv4Cidr cidr)
    {
        cidr = default;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var parts = text.Split('/');
        if (parts.Length != 2
            || !IPAddress.TryParse(parts[0], out var address)
            || address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var prefix)
            || prefix is < 0 or > 32)
        {
            return false;
        }

        var bytes = address.GetAddressBytes();
        var value = ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) | ((uint)bytes[2] << 8) | bytes[3];
        var mask = prefix == 0 ? 0u : uint.MaxValue << (32 - prefix);
        cidr = new Ipv4Cidr(value & mask, prefix);
        return true;
    }

    public static Ipv4Cidr Parse(string text) =>
        TryParse(text, out var cidr) ? cidr : throw new FormatException($"'{text}' is not an IPv4 CIDR.");

    public bool Overlaps(Ipv4Cidr other) => Network <= other.Last && other.Network <= Last;

    public override string ToString() =>
        $"{Network >> 24}.{(Network >> 16) & 0xFF}.{(Network >> 8) & 0xFF}.{Network & 0xFF}/{PrefixLength}";
}
