using System.Security.Cryptography;
using System.Text;

namespace Endgame.Dock.Policy;

/// <summary>
/// An app's database, role and password, derived from its id with Dock's secret key — opaque, so a
/// listing of databases reveals nothing about whose they are (ARCH-005), and stable, so Dock keeps
/// no credential store: the same key always yields the same name and password.
/// </summary>
public sealed class OpaqueNames(byte[] key)
{
    public const string DatabasePrefix = "d_";
    public const string RolePrefix = "r_";

    public string Database(Guid appId) => DatabasePrefix + Hex("database", appId, 12);

    public string Role(Guid appId) => RolePrefix + Hex("role", appId, 12);

    public string Password(Guid appId) =>
        Convert.ToBase64String(Mac("password", appId)).TrimEnd('=').Replace('+', 'A').Replace('/', 'B');

    /// <summary>True for a name this scheme could have produced: lowercase hex after the prefix.</summary>
    public static bool IsAppDatabase(string name) =>
        name.StartsWith(DatabasePrefix, StringComparison.Ordinal)
        && name.Length == DatabasePrefix.Length + 24
        && name[DatabasePrefix.Length..].All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f'));

    private string Hex(string purpose, Guid appId, int bytes) =>
        Convert.ToHexString(Mac(purpose, appId), 0, bytes).ToLowerInvariant();

    private byte[] Mac(string purpose, Guid appId) =>
        HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"endgame-dock:{purpose}:{appId:D}"));
}
