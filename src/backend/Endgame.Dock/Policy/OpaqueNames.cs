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
    public const string TestRolePrefix = "t_";
    public const string TestDatabasePrefix = "w_";

    public string Database(Guid appId) => DatabasePrefix + Hex("database", appId, 12);

    public string Role(Guid appId) => RolePrefix + Hex("role", appId, 12);

    public string Password(Guid appId) =>
        Convert.ToBase64String(Mac("password", appId)).TrimEnd('=').Replace('+', 'A').Replace('/', 'B');

    /// <summary>A workspace's test role: may create and drop databases of its own, nothing else.</summary>
    public string TestRole(Guid runId) => TestRolePrefix + Hex("test-role", runId, 12);

    /// <summary>The database a workspace's test role connects to first.</summary>
    public string TestDatabase(Guid runId) => TestDatabasePrefix + Hex("test-database", runId, 12);

    public string TestPassword(Guid runId) =>
        Convert.ToBase64String(Mac("test-password", runId)).TrimEnd('=').Replace('+', 'A').Replace('/', 'B');

    /// <summary>True for an app's or a workspace's database: never a platform database.</summary>
    public static bool IsAppDatabase(string name) => HasOpaqueForm(name, DatabasePrefix) || HasOpaqueForm(name, TestDatabasePrefix);

    /// <summary>True for a role name this scheme could have produced.</summary>
    public static bool IsAppRole(string name) => HasOpaqueForm(name, RolePrefix) || HasOpaqueForm(name, TestRolePrefix);

    private static bool HasOpaqueForm(string name, string prefix) =>
        name.StartsWith(prefix, StringComparison.Ordinal)
        && name.Length == prefix.Length + 24
        && name[prefix.Length..].All(c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f'));

    private string Hex(string purpose, Guid appId, int bytes) =>
        Convert.ToHexString(Mac(purpose, appId), 0, bytes).ToLowerInvariant();

    private byte[] Mac(string purpose, Guid appId) =>
        HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"endgame-dock:{purpose}:{appId:D}"));
}
