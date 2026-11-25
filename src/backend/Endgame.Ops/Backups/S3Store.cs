using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace Endgame.Ops.Backups;

/// <summary>
/// AWS Signature Version 4 for S3's REST API, header form, as Cloudflare R2 and MinIO accept it.
/// Spec: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — the unit
/// tests reproduce that page's "GET Object" example signature.
/// </summary>
public static class SigV4
{
    public const string EmptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    /// <summary>
    /// The <c>Authorization</c> header for a request. <paramref name="headers"/> are the headers to
    /// sign (lower-case names), and must include <c>host</c>, <c>x-amz-date</c> and <c>x-amz-content-sha256</c>.
    /// </summary>
    public static string Authorization(
        string method,
        string canonicalPath,
        IReadOnlyList<KeyValuePair<string, string>> query,
        IReadOnlyDictionary<string, string> headers,
        string payloadHash,
        DateTimeOffset at,
        string region,
        string accessKeyId,
        string secretAccessKey,
        string service = "s3")
    {
        var date = at.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var amzDate = at.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        var signed = headers.Keys.Select(k => k.ToLowerInvariant()).Order(StringComparer.Ordinal).ToList();
        var canonicalHeaders = string.Concat(signed.Select(k => $"{k}:{headers[k].Trim()}\n"));
        var canonicalQuery = string.Join('&', query
            .Select(p => (Key: Encode(p.Key), Value: Encode(p.Value)))
            .OrderBy(p => p.Key, StringComparer.Ordinal)
            .ThenBy(p => p.Value, StringComparer.Ordinal)
            .Select(p => $"{p.Key}={p.Value}"));
        var signedHeaders = string.Join(';', signed);
        var canonicalRequest = $"{method}\n{canonicalPath}\n{canonicalQuery}\n{canonicalHeaders}\n{signedHeaders}\n{payloadHash}";
        var scope = $"{date}/{region}/{service}/aws4_request";
        var stringToSign = $"AWS4-HMAC-SHA256\n{amzDate}\n{scope}\n{Hex(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalRequest)))}";
        var key = Hmac(Encoding.UTF8.GetBytes("AWS4" + secretAccessKey), date);
        key = Hmac(key, region);
        key = Hmac(key, service);
        key = Hmac(key, "aws4_request");
        var signature = Hex(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(stringToSign)));
        return $"AWS4-HMAC-SHA256 Credential={accessKeyId}/{scope},SignedHeaders={signedHeaders},Signature={signature}";
    }

    /// <summary>RFC 3986 encoding of everything but the unreserved characters, as SigV4 requires.</summary>
    public static string Encode(string value, bool keepSlash = false)
    {
        var builder = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            var c = (char)b;
            if (c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-' or '_' or '.' or '~' || (keepSlash && c == '/'))
            {
                builder.Append(c);
            }
            else
            {
                builder.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
        }

        return builder.ToString();
    }

    public static string Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(bytes);

    private static byte[] Hmac(byte[] key, string data) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(data));
}

/// <summary>An S3 call that failed, with the service's own error code.</summary>
public sealed class S3Exception(HttpStatusCode status, string code, string message)
    : Exception($"The bucket refused the request ({(int)status} {code}): {message}")
{
    public HttpStatusCode Status { get; } = status;

    public string Code { get; } = code;
}

/// <summary>
/// The handful of S3 operations backups need, path-style (<c>{endpoint}/{bucket}/{key}</c>), signed
/// with <see cref="SigV4"/>. Operation reference: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_Simple_Storage_Service.html;
/// R2's support for each: https://developers.cloudflare.com/r2/api/s3/api/.
/// </summary>
public sealed class S3Client(HttpClient http, BackupOptions options, TimeProvider clock)
{
    private static readonly XNamespace Ns = "http://s3.amazonaws.com/doc/2006-03-01/";
    private readonly Uri endpoint = new(options.S3Endpoint.TrimEnd('/') + "/");

    public string Bucket => options.S3Bucket;

    /// <summary>ListObjectsV2 — https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html</summary>
    public async Task<IReadOnlyList<(string Key, long Size, DateTimeOffset LastModified)>> ListAsync(string prefix, CancellationToken cancellationToken)
    {
        var found = new List<(string, long, DateTimeOffset)>();
        string? token = null;
        do
        {
            var query = new List<KeyValuePair<string, string>> { new("list-type", "2"), new("prefix", prefix) };
            if (token is not null)
            {
                query.Add(new("continuation-token", token));
            }

            using var response = await SendAsync(HttpMethod.Get, "", query, null, cancellationToken);
            var xml = XDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            var root = xml.Root!;
            var ns = root.Name.Namespace == XNamespace.None ? XNamespace.None : Ns;
            foreach (var item in root.Elements(ns + "Contents"))
            {
                found.Add((
                    (string)item.Element(ns + "Key")!,
                    long.Parse((string)item.Element(ns + "Size")!, CultureInfo.InvariantCulture),
                    DateTimeOffset.Parse((string)item.Element(ns + "LastModified")!, CultureInfo.InvariantCulture)));
            }

            token = string.Equals((string?)root.Element(ns + "IsTruncated"), "true", StringComparison.OrdinalIgnoreCase)
                ? (string?)root.Element(ns + "NextContinuationToken")
                : null;
        }
        while (token is not null);

        return found;
    }

    /// <summary>CreateMultipartUpload — https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateMultipartUpload.html</summary>
    public async Task<string> CreateMultipartUploadAsync(string key, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Post, key, [new("uploads", "")], null, cancellationToken);
        var xml = XDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return xml.Descendants().First(e => e.Name.LocalName == "UploadId").Value;
    }

    /// <summary>UploadPart — https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPart.html. Returns the part's ETag.</summary>
    public async Task<string> UploadPartAsync(string key, string uploadId, int partNumber, ReadOnlyMemory<byte> body, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            HttpMethod.Put,
            key,
            [new("partNumber", partNumber.ToString(CultureInfo.InvariantCulture)), new("uploadId", uploadId)],
            body,
            cancellationToken);
        return response.Headers.ETag?.Tag ?? throw new S3Exception(response.StatusCode, "NoETag", "The bucket answered a part upload without an ETag.");
    }

    /// <summary>
    /// CompleteMultipartUpload — https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html.
    /// That page warns the call can answer 200 with an error in the body; that is checked.
    /// </summary>
    public async Task CompleteMultipartUploadAsync(string key, string uploadId, IReadOnlyList<string> etags, CancellationToken cancellationToken)
    {
        var body = new XElement(
            Ns + "CompleteMultipartUpload",
            etags.Select((etag, i) => new XElement(Ns + "Part", new XElement(Ns + "PartNumber", i + 1), new XElement(Ns + "ETag", etag))));
        var bytes = Encoding.UTF8.GetBytes(body.ToString(SaveOptions.DisableFormatting));
        using var response = await SendAsync(HttpMethod.Post, key, [new("uploadId", uploadId)], bytes, cancellationToken);
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (text.Contains("<Error>", StringComparison.Ordinal))
        {
            var error = XDocument.Parse(text).Root!;
            throw new S3Exception(response.StatusCode, (string?)error.Element("Code") ?? "Error", (string?)error.Element("Message") ?? text);
        }
    }

    /// <summary>AbortMultipartUpload — https://docs.aws.amazon.com/AmazonS3/latest/API/API_AbortMultipartUpload.html</summary>
    public async Task AbortMultipartUploadAsync(string key, string uploadId, CancellationToken cancellationToken)
    {
        using var _ = await SendAsync(HttpMethod.Delete, key, [new("uploadId", uploadId)], null, cancellationToken);
    }

    /// <summary>GetObject — https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html. Streams; the caller disposes.</summary>
    public async Task<Stream> GetAsync(string key, CancellationToken cancellationToken)
    {
        var response = await SendAsync(HttpMethod.Get, key, [], null, cancellationToken, HttpCompletionOption.ResponseHeadersRead);
        return new ResponseStream(response, await response.Content.ReadAsStreamAsync(cancellationToken));
    }

    /// <summary>DeleteObject — https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html</summary>
    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        using var _ = await SendAsync(HttpMethod.Delete, key, [], null, cancellationToken);
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string key,
        IReadOnlyList<KeyValuePair<string, string>> query,
        ReadOnlyMemory<byte>? body,
        CancellationToken cancellationToken,
        HttpCompletionOption completion = HttpCompletionOption.ResponseContentRead)
    {
        var path = "/" + SigV4.Encode(options.S3Bucket) + (key.Length > 0 ? "/" + SigV4.Encode(key, keepSlash: true) : "");
        var basePath = endpoint.AbsolutePath.TrimEnd('/');
        var canonicalPath = basePath + path;
        var queryText = string.Join('&', query.Select(p => p.Value.Length == 0 && p.Key == "uploads" ? "uploads" : $"{SigV4.Encode(p.Key)}={SigV4.Encode(p.Value)}"));
        var uri = new Uri(endpoint, canonicalPath + (queryText.Length > 0 ? "?" + queryText : ""));
        var payloadHash = body is { } b ? SigV4.Hex(SHA256.HashData(b.Span)) : SigV4.EmptyPayloadHash;
        var now = clock.GetUtcNow();
        var host = uri.IsDefaultPort ? uri.Host : uri.Authority;
        var headers = new Dictionary<string, string>
        {
            ["host"] = host,
            ["x-amz-content-sha256"] = payloadHash,
            ["x-amz-date"] = now.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture),
        };
        using var request = new HttpRequestMessage(method, uri);
        request.Headers.TryAddWithoutValidation("x-amz-content-sha256", payloadHash);
        request.Headers.TryAddWithoutValidation("x-amz-date", headers["x-amz-date"]);
        request.Headers.TryAddWithoutValidation(
            "Authorization",
            SigV4.Authorization(method.Method, canonicalPath, query, headers, payloadHash, now, options.S3Region, options.S3AccessKeyId, options.S3SecretAccessKey));
        if (body is { } content)
        {
            request.Content = new ReadOnlyMemoryContent(content);
        }

        var response = await http.SendAsync(request, completion, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            response.Dispose();
            var code = "Error";
            var message = text.Length > 300 ? text[..300] : text;
            try
            {
                var error = XDocument.Parse(text).Root!;
                code = (string?)error.Element("Code") ?? code;
                message = (string?)error.Element("Message") ?? message;
            }
            catch (System.Xml.XmlException)
            {
            }

            throw new S3Exception(response.StatusCode, code, message);
        }

        return response;
    }

    private sealed class ResponseStream(HttpResponseMessage response, Stream inner) : Stream
    {
        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => inner.ReadAsync(buffer, cancellationToken);

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            inner.ReadAsync(buffer, offset, count, cancellationToken);

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                inner.Dispose();
                response.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}

/// <summary>An S3-compatible bucket: Cloudflare R2 in production, MinIO in the rehearsal.</summary>
public sealed class S3Store(S3Client client, BackupOptions options) : IBackupStore
{
    private string Prefix => options.S3Prefix;

    public bool Offsite => true;

    public string Describe => $"the bucket '{options.S3Bucket}' at {new Uri(options.S3Endpoint).Host}, encrypted before upload";

    public async Task<IReadOnlyList<StoredBackup>> ListAsync(CancellationToken cancellationToken) =>
        (await client.ListAsync(Prefix, cancellationToken))
            .Select(o => BackupNames.Parse(o.Key[Prefix.Length..], o.Size))
            .OfType<StoredBackup>()
            .OrderBy(b => b.CreatedAt)
            .ToList();

    public async Task<IBackupUpload> BeginUploadAsync(string name, CancellationToken cancellationToken)
    {
        var key = Prefix + name;
        var uploadId = await client.CreateMultipartUploadAsync(key, cancellationToken);
        return new MultipartUpload(client, key, uploadId, Math.Max(5, options.PartSizeMb) * 1024 * 1024);
    }

    public Task<Stream> OpenReadAsync(string name, CancellationToken cancellationToken) => client.GetAsync(Prefix + name, cancellationToken);

    public Task DeleteAsync(string name, CancellationToken cancellationToken) => client.DeleteAsync(Prefix + name, cancellationToken);

    /// <summary>Buffers one part at a time (memory is the part size, whatever the archive), uploading each as it fills.</summary>
    private sealed class MultipartUpload(S3Client client, string key, string uploadId, int partSize) : IBackupUpload
    {
        private readonly PartStream stream = new(client, key, uploadId, partSize);
        private bool done;

        public Stream Stream => stream;

        public async Task CommitAsync(CancellationToken cancellationToken)
        {
            await stream.FlushPartAsync(cancellationToken);
            await client.CompleteMultipartUploadAsync(key, uploadId, stream.ETags, cancellationToken);
            done = true;
        }

        public async Task AbortAsync(CancellationToken cancellationToken)
        {
            done = true;
            await client.AbortMultipartUploadAsync(key, uploadId, cancellationToken);
        }

        public async ValueTask DisposeAsync()
        {
            if (!done)
            {
                try
                {
                    await AbortAsync(CancellationToken.None);
                }
                catch (Exception ex) when (ex is S3Exception or HttpRequestException)
                {
                    // An upload never completed is never visible; the bucket's own lifecycle removes the parts.
                }
            }
        }
    }

    private sealed class PartStream(S3Client client, string key, string uploadId, int partSize) : Stream
    {
        private readonly byte[] buffer = new byte[partSize];
        private int filled;

        public List<string> ETags { get; } = [];

        public override bool CanRead => false;

        public override bool CanSeek => false;

        public override bool CanWrite => true;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override void Write(byte[] buffer, int offset, int count) => WriteAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> data, CancellationToken cancellationToken = default)
        {
            while (data.Length > 0)
            {
                var take = Math.Min(buffer.Length - filled, data.Length);
                data[..take].CopyTo(buffer.AsMemory(filled));
                filled += take;
                data = data[take..];
                if (filled == buffer.Length)
                {
                    await FlushPartAsync(cancellationToken);
                }
            }
        }

        public async Task FlushPartAsync(CancellationToken cancellationToken)
        {
            if (filled == 0 && ETags.Count > 0)
            {
                return;
            }

            ETags.Add(await client.UploadPartAsync(key, uploadId, ETags.Count + 1, buffer.AsMemory(0, filled), cancellationToken));
            filled = 0;
        }

        public override void Flush()
        {
        }

        public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
