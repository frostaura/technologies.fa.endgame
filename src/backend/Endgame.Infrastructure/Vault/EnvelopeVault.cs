using System.Security.Cryptography;
using System.Text;
using Endgame.Application.Common;
using Microsoft.Extensions.Configuration;

namespace Endgame.Infrastructure.Vault;

/// <summary>
/// Envelope encryption for the secrets vault. The master key comes from the environment
/// (<c>ENDGAME_VAULT_MASTER_KEY</c>: 32 bytes as base64 or hex) and never touches the database. Each
/// secret gets its own random data key; the value is sealed with AES-256-GCM under the data key, and
/// the data key is sealed under the master key. Both seals bind the row the value belongs to as
/// associated data, so a ciphertext copied onto another secret or another organisation cannot be
/// opened there. Nothing here logs a value.
/// </summary>
public sealed class EnvelopeVault
{
    public const string MasterKeyVariable = "ENDGAME_VAULT_MASTER_KEY";
    private const string Format = "egv1";
    private const int KeySize = 32;
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly byte[]? master;
    private readonly string? keyId;

    public EnvelopeVault(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        master = Parse(configuration[MasterKeyVariable]);
        keyId = master is null ? null : Convert.ToHexStringLower(SHA256.HashData(master))[..8];
    }

    public bool IsConfigured => master is not null;

    /// <summary>Seals <paramref name="plaintext"/> for the row named by <paramref name="binding"/>.</summary>
    public string Seal(string plaintext, string binding)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        var key = RequireMaster();
        var associated = Encoding.UTF8.GetBytes(binding);
        var dataKey = RandomNumberGenerator.GetBytes(KeySize);
        try
        {
            var (wrapNonce, wrapped) = Encrypt(key, dataKey, associated);
            var (nonce, ciphertext) = Encrypt(dataKey, Encoding.UTF8.GetBytes(plaintext), associated);
            return string.Join('.', Format, keyId, B64(wrapNonce), B64(wrapped), B64(nonce), B64(ciphertext));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    /// <summary>True when <paramref name="value"/> was sealed by this vault's format (any key).</summary>
    public static bool IsSealed(string? value) => value?.StartsWith(Format + ".", StringComparison.Ordinal) == true;

    /// <summary>Opens a sealed value. Throws when it was sealed for another row or under another master key.</summary>
    public string Open(string sealedValue, string binding)
    {
        ArgumentNullException.ThrowIfNull(sealedValue);
        var key = RequireMaster();
        var parts = sealedValue.Split('.');
        if (parts.Length != 6 || parts[0] != Format)
        {
            throw new CryptographicException("Not a sealed vault value.");
        }

        if (parts[1] != keyId)
        {
            throw new EndgameProblem(503, "vault_key_mismatch", "The vault cannot open this secret",
                "The secret was sealed under a different master key than the one configured. Restore the original ENDGAME_VAULT_MASTER_KEY.");
        }

        var associated = Encoding.UTF8.GetBytes(binding);
        var dataKey = Decrypt(key, FromB64(parts[2]), FromB64(parts[3]), associated);
        try
        {
            return Encoding.UTF8.GetString(Decrypt(dataKey, FromB64(parts[4]), FromB64(parts[5]), associated));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    /// <summary>A key derived from the master key for one purpose (HKDF-SHA256), e.g. deriving app tokens.</summary>
    public byte[] DeriveKey(string purpose) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, RequireMaster(), KeySize, salt: [], info: Encoding.UTF8.GetBytes("endgame:" + purpose));

    private byte[] RequireMaster() => master ?? throw new EndgameProblem(503, "vault_unconfigured", "The vault is not configured",
        $"{MasterKeyVariable} is not set, so secrets cannot be sealed or opened and app tokens cannot be issued.");

    private static (byte[] Nonce, byte[] Sealed) Encrypt(byte[] key, byte[] plaintext, byte[] associated)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var output = new byte[plaintext.Length + TagSize];
        using var aes = new AesGcm(key, TagSize);
        aes.Encrypt(nonce, plaintext, output.AsSpan(0, plaintext.Length), output.AsSpan(plaintext.Length), associated);
        return (nonce, output);
    }

    private static byte[] Decrypt(byte[] key, byte[] nonce, byte[] sealedBytes, byte[] associated)
    {
        if (sealedBytes.Length < TagSize || nonce.Length != NonceSize)
        {
            throw new CryptographicException("A sealed vault value is truncated.");
        }

        var plaintext = new byte[sealedBytes.Length - TagSize];
        using var aes = new AesGcm(key, TagSize);
        aes.Decrypt(nonce, sealedBytes.AsSpan(0, plaintext.Length), sealedBytes.AsSpan(plaintext.Length), plaintext, associated);
        return plaintext;
    }

    private static byte[]? Parse(string? configured)
    {
        var text = configured?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        byte[] bytes;
        try
        {
            bytes = text.Length == KeySize * 2 && text.All(Uri.IsHexDigit) ? Convert.FromHexString(text) : Convert.FromBase64String(text);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException($"{MasterKeyVariable} is neither base64 nor hex.");
        }

        return bytes.Length == KeySize
            ? bytes
            : throw new InvalidOperationException($"{MasterKeyVariable} must be exactly {KeySize} bytes (base64 or {KeySize * 2} hex characters); generate one with `openssl rand -base64 32`.");
    }

    private static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromB64(string text)
    {
        var padded = text.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(padded.PadRight(padded.Length + ((4 - (padded.Length % 4)) % 4), '='));
    }
}
