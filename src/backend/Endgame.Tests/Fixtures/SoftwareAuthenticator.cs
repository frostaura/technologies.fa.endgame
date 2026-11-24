using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// A software passkey: an ES256 key pair that answers WebAuthn creation and request options the way
/// a platform authenticator does ("none" attestation), so the real Identity passkey code is exercised
/// end to end with no browser.
/// </summary>
public sealed class SoftwareAuthenticator : IDisposable
{
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly byte[] credentialId = RandomNumberGenerator.GetBytes(32);
    private string? userHandle;
    private uint signCount;

    public string Origin { get; init; } = "https://localhost";

    public string CredentialId => B64(credentialId);

    /// <summary>Answers <c>navigator.credentials.create()</c> for the given options (the <c>publicKey</c> member).</summary>
    public JsonObject Create(JsonNode publicKey, string? originOverride = null)
    {
        ArgumentNullException.ThrowIfNull(publicKey);
        var rpId = publicKey["rp"]?["id"]?.GetValue<string>() ?? new Uri(Origin).Host;
        userHandle = publicKey["user"]!["id"]!.GetValue<string>();
        var clientData = ClientData("webauthn.create", publicKey["challenge"]!.GetValue<string>(), originOverride);
        var parameters = key.ExportParameters(false);
        var coseKey = Cbor.Map(
            (Cbor.Int(1), Cbor.Int(2)),
            (Cbor.Int(3), Cbor.Int(-7)),
            (Cbor.Int(-1), Cbor.Int(1)),
            (Cbor.Int(-2), Cbor.Bytes(parameters.Q.X!)),
            (Cbor.Int(-3), Cbor.Bytes(parameters.Q.Y!)));
        var authData = Concat(
            SHA256.HashData(Encoding.UTF8.GetBytes(rpId)),
            [0x45], // user present, user verified, attested credential data
            BigEndian(signCount),
            new byte[16], // AAGUID
            [(byte)(credentialId.Length >> 8), (byte)credentialId.Length],
            credentialId,
            coseKey);
        var attestation = Cbor.Map(
            (Cbor.Text("fmt"), Cbor.Text("none")),
            (Cbor.Text("attStmt"), Cbor.Map()),
            (Cbor.Text("authData"), Cbor.Bytes(authData)));
        return new JsonObject
        {
            ["id"] = CredentialId,
            ["rawId"] = CredentialId,
            ["type"] = "public-key",
            ["authenticatorAttachment"] = "platform",
            ["clientExtensionResults"] = new JsonObject(),
            ["response"] = new JsonObject
            {
                ["clientDataJSON"] = B64(clientData),
                ["attestationObject"] = B64(attestation),
                ["transports"] = new JsonArray("internal"),
            },
        };
    }

    /// <summary>Answers <c>navigator.credentials.get()</c> for the given options (the <c>publicKey</c> member).</summary>
    public JsonObject Get(JsonNode publicKey)
    {
        ArgumentNullException.ThrowIfNull(publicKey);
        var rpId = publicKey["rpId"]?.GetValue<string>() ?? new Uri(Origin).Host;
        var clientData = ClientData("webauthn.get", publicKey["challenge"]!.GetValue<string>(), null);
        signCount++;
        var authData = Concat(SHA256.HashData(Encoding.UTF8.GetBytes(rpId)), [0x05], BigEndian(signCount));
        var signature = key.SignData(Concat(authData, SHA256.HashData(clientData)), HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
        return new JsonObject
        {
            ["id"] = CredentialId,
            ["rawId"] = CredentialId,
            ["type"] = "public-key",
            ["authenticatorAttachment"] = "platform",
            ["clientExtensionResults"] = new JsonObject(),
            ["response"] = new JsonObject
            {
                ["clientDataJSON"] = B64(clientData),
                ["authenticatorData"] = B64(authData),
                ["signature"] = B64(signature),
                ["userHandle"] = userHandle,
            },
        };
    }

    public void Dispose() => key.Dispose();

    private byte[] ClientData(string type, string challenge, string? originOverride) =>
        Encoding.UTF8.GetBytes(new JsonObject { ["type"] = type, ["challenge"] = challenge, ["origin"] = originOverride ?? Origin, ["crossOrigin"] = false }.ToJsonString());

    private static byte[] BigEndian(uint value) => [(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value];

    private static byte[] Concat(params byte[][] parts) => parts.SelectMany(p => p).ToArray();

    public static string B64(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>The handful of CBOR encodings WebAuthn needs: small maps, integers, byte and text strings.</summary>
    private static class Cbor
    {
        public static byte[] Int(long value) => value >= 0 ? Head(0, (ulong)value) : Head(1, (ulong)(-1 - value));

        public static byte[] Bytes(byte[] value) => [.. Head(2, (ulong)value.Length), .. value];

        public static byte[] Text(string value)
        {
            var bytes = Encoding.UTF8.GetBytes(value);
            return [.. Head(3, (ulong)bytes.Length), .. bytes];
        }

        public static byte[] Map(params (byte[] Key, byte[] Value)[] entries) =>
            [.. Head(5, (ulong)entries.Length), .. entries.SelectMany(e => e.Key.Concat(e.Value))];

        private static byte[] Head(int major, ulong length) => length switch
        {
            < 24 => [(byte)((major << 5) | (int)length)],
            < 256 => [(byte)((major << 5) | 24), (byte)length],
            < 65536 => [(byte)((major << 5) | 25), (byte)(length >> 8), (byte)length],
            _ => [(byte)((major << 5) | 26), (byte)(length >> 24), (byte)(length >> 16), (byte)(length >> 8), (byte)length],
        };
    }
}
