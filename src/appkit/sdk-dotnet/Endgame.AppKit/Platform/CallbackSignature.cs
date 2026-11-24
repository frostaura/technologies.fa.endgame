using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Endgame.AppKit;

/// <summary>
/// How the platform signs the calls it makes into an app (schedule runs):
/// <c>X-Endgame-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256(app token, "&lt;t&gt;." + body)&gt;</c>.
/// Public so the platform and its tests can produce exactly what the kit checks.
/// </summary>
public static class CallbackSignature
{
    /// <summary>The header name.</summary>
    public const string Header = "X-Endgame-Signature";

    /// <summary>How far the timestamp may drift from now.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    /// <summary>The header value for <paramref name="body"/> signed at <paramref name="at"/>.</summary>
    public static string Create(string appToken, ReadOnlySpan<byte> body, DateTimeOffset at)
    {
        var t = at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        return $"t={t},v1={Convert.ToHexStringLower(Mac(appToken, t, body))}";
    }

    /// <summary>True when <paramref name="header"/> is a valid, fresh signature of <paramref name="body"/>.</summary>
    public static bool Verify(string appToken, string? header, ReadOnlySpan<byte> body, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(header))
        {
            return false;
        }

        string? t = null, v1 = null;
        foreach (var part in header.Split(','))
        {
            var kv = part.Split('=', 2);
            if (kv.Length != 2)
            {
                continue;
            }

            if (kv[0] == "t")
            {
                t = kv[1];
            }
            else if (kv[0] == "v1")
            {
                v1 = kv[1];
            }
        }

        if (t is null || v1 is null || !long.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds))
        {
            return false;
        }

        if ((now - DateTimeOffset.FromUnixTimeSeconds(seconds)).Duration() > Tolerance)
        {
            return false;
        }

        byte[] given;
        try
        {
            given = Convert.FromHexString(v1);
        }
        catch (FormatException)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(given, Mac(appToken, t, body));
    }

    private static byte[] Mac(string appToken, string t, ReadOnlySpan<byte> body)
    {
        var prefix = Encoding.UTF8.GetBytes(t + ".");
        var message = new byte[prefix.Length + body.Length];
        prefix.CopyTo(message, 0);
        body.CopyTo(message.AsSpan(prefix.Length));
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(appToken), message);
    }
}
