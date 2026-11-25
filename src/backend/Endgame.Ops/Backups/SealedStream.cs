using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Endgame.Ops.Backups;

/// <summary>
/// The archive's encryption: AES-256-GCM over 64 KiB chunks, so memory stays flat however large
/// the archive. Layout (ARCH-007):
/// <code>
/// header  "EGBK" | version 0x01 | key id (8) | salt (32)                          45 bytes
/// chunk   last (1: 0 or 1) | length (4, big-endian, ≤ 65536) | ciphertext | tag (16)
/// </code>
/// Each archive gets its own key, HKDF-SHA256(backup key, salt). Chunk <c>i</c>'s nonce is
/// <c>i</c> (8 bytes, big-endian) | 0 0 0 | last, and its associated data is the header plus the
/// chunk's own last flag and length — so chunks cannot be reordered, dropped, truncated or moved
/// between archives without failing authentication, and an archive is complete only when its
/// final chunk says so.
/// </summary>
public static class SealedFormat
{
    public const int ChunkSize = 64 * 1024;
    public const int TagSize = 16;
    public const int HeaderSize = 45;
    public static readonly byte[] Magic = "EGBK"u8.ToArray();
    public const byte Version = 1;

    private static readonly byte[] KeyInfo = "endgame-backup v1 aes-256-gcm"u8.ToArray();
    private static readonly byte[] KeyIdLabel = "endgame-backup key id"u8.ToArray();

    /// <summary>Eight bytes that name the backup key without revealing it, so a wrong key is told apart from a damaged archive.</summary>
    public static byte[] KeyId(byte[] backupKey) => HMACSHA256.HashData(backupKey, KeyIdLabel)[..8];

    public static string KeyIdHex(byte[] backupKey) => Convert.ToHexStringLower(KeyId(backupKey));

    internal static byte[] FileKey(byte[] backupKey, byte[] salt) => HKDF.DeriveKey(HashAlgorithmName.SHA256, backupKey, 32, salt, KeyInfo);

    internal static void Nonce(Span<byte> nonce, long counter, bool last)
    {
        nonce.Clear();
        BinaryPrimitives.WriteInt64BigEndian(nonce, counter);
        nonce[11] = last ? (byte)1 : (byte)0;
    }

    internal static byte[] AssociatedData(byte[] header, bool last, int length)
    {
        var aad = new byte[header.Length + 5];
        header.CopyTo(aad, 0);
        aad[header.Length] = last ? (byte)1 : (byte)0;
        BinaryPrimitives.WriteInt32BigEndian(aad.AsSpan(header.Length + 1), length);
        return aad;
    }
}

/// <summary>Why an archive could not be opened. The message is written for the person restoring.</summary>
public sealed class ArchiveIntegrityException(string message) : Exception(message);

/// <summary>Write-only: encrypts everything written to it into <paramref name="inner"/>.</summary>
/// <remarks>
/// <see cref="FinishAsync"/> seals the final chunk. Disposing without finishing deliberately leaves
/// the archive incomplete, so a backup that failed half-way can never read as a whole one.
/// </remarks>
public sealed class SealingStream : Stream
{
    private readonly Stream inner;
    private readonly bool leaveOpen;
    private readonly AesGcm aes;
    private readonly byte[] header;
    private readonly byte[] buffer = new byte[SealedFormat.ChunkSize];
    private readonly byte[] cipher = new byte[SealedFormat.ChunkSize];
    private int buffered;
    private long counter;
    private bool headerWritten;
    private bool finished;

    public SealingStream(Stream inner, byte[] backupKey, bool leaveOpen = false)
    {
        this.inner = inner;
        this.leaveOpen = leaveOpen;
        var salt = RandomNumberGenerator.GetBytes(32);
        header = [.. SealedFormat.Magic, SealedFormat.Version, .. SealedFormat.KeyId(backupKey), .. salt];
        aes = new AesGcm(SealedFormat.FileKey(backupKey, salt), SealedFormat.TagSize);
    }

    /// <summary>Plaintext bytes written so far.</summary>
    public long PlaintextBytes { get; private set; }

    /// <summary>Bytes written to the inner stream so far.</summary>
    public long SealedBytes { get; private set; }

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => !finished;

    public override long Length => throw new NotSupportedException();

    public override long Position { get => PlaintextBytes; set => throw new NotSupportedException(); }

    public override void Write(byte[] buffer, int offset, int count) => WriteAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override void Write(ReadOnlySpan<byte> data) => WriteAsync(data.ToArray()).AsTask().GetAwaiter().GetResult();

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> data, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(finished, this);
        while (data.Length > 0)
        {
            // A full buffer is sealed only once more data arrives: until then it may be the last chunk.
            if (buffered == SealedFormat.ChunkSize)
            {
                await SealAsync(last: false, cancellationToken);
            }

            var take = Math.Min(SealedFormat.ChunkSize - buffered, data.Length);
            data.Span[..take].CopyTo(buffer.AsSpan(buffered));
            buffered += take;
            PlaintextBytes += take;
            data = data[take..];
        }
    }

    /// <summary>Seals the final chunk. The archive is complete only after this.</summary>
    public async Task FinishAsync(CancellationToken cancellationToken = default)
    {
        if (finished)
        {
            return;
        }

        await SealAsync(last: true, cancellationToken);
        await inner.FlushAsync(cancellationToken);
        finished = true;
    }

    public override void Flush()
    {
    }

    public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            aes.Dispose();
            if (!leaveOpen)
            {
                inner.Dispose();
            }
        }

        finished = true;
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        aes.Dispose();
        if (!leaveOpen)
        {
            await inner.DisposeAsync();
        }

        finished = true;
        GC.SuppressFinalize(this);
    }

    private async Task SealAsync(bool last, CancellationToken cancellationToken)
    {
        if (!headerWritten)
        {
            await inner.WriteAsync(header, cancellationToken);
            SealedBytes += header.Length;
            headerWritten = true;
        }

        var frame = new byte[5];
        frame[0] = last ? (byte)1 : (byte)0;
        BinaryPrimitives.WriteInt32BigEndian(frame.AsSpan(1), buffered);
        var nonce = new byte[12];
        SealedFormat.Nonce(nonce, counter, last);
        var tag = new byte[SealedFormat.TagSize];
        aes.Encrypt(nonce, buffer.AsSpan(0, buffered), cipher.AsSpan(0, buffered), tag, SealedFormat.AssociatedData(header, last, buffered));
        await inner.WriteAsync(frame, cancellationToken);
        await inner.WriteAsync(cipher.AsMemory(0, buffered), cancellationToken);
        await inner.WriteAsync(tag, cancellationToken);
        SealedBytes += frame.Length + buffered + tag.Length;
        counter++;
        buffered = 0;
    }
}

/// <summary>Read-only: decrypts a <see cref="SealingStream"/>'s output, failing on any damage.</summary>
public sealed class UnsealingStream(Stream inner, byte[] backupKey, bool leaveOpen = false) : Stream
{
    private readonly byte[] plain = new byte[SealedFormat.ChunkSize];
    private readonly byte[] cipher = new byte[SealedFormat.ChunkSize];
    private AesGcm? aes;
    private byte[] header = [];
    private int available;
    private int offset;
    private long counter;
    private bool sawLast;

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();

    public override int Read(Span<byte> buffer)
    {
        var rented = new byte[buffer.Length];
        var n = ReadAsync(rented).AsTask().GetAwaiter().GetResult();
        rented.AsSpan(0, n).CopyTo(buffer);
        return n;
    }

    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override async ValueTask<int> ReadAsync(Memory<byte> destination, CancellationToken cancellationToken = default)
    {
        if (destination.Length == 0)
        {
            return 0;
        }

        while (available == offset)
        {
            if (sawLast)
            {
                return 0;
            }

            await NextChunkAsync(cancellationToken);
        }

        var take = Math.Min(available - offset, destination.Length);
        plain.AsMemory(offset, take).CopyTo(destination);
        offset += take;
        return take;
    }

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
            aes?.Dispose();
            if (!leaveOpen)
            {
                inner.Dispose();
            }
        }

        base.Dispose(disposing);
    }

    private async Task NextChunkAsync(CancellationToken cancellationToken)
    {
        if (aes is null)
        {
            header = new byte[SealedFormat.HeaderSize];
            if (!await FillAsync(header, cancellationToken))
            {
                throw new ArchiveIntegrityException("This is not an Endgame backup: it is shorter than the archive header.");
            }

            if (!header.AsSpan(0, 4).SequenceEqual(SealedFormat.Magic))
            {
                throw new ArchiveIntegrityException("This is not an Endgame backup: the archive header is missing.");
            }

            if (header[4] != SealedFormat.Version)
            {
                throw new ArchiveIntegrityException($"This backup uses archive format {header[4]}, which this version cannot read.");
            }

            if (!CryptographicOperations.FixedTimeEquals(header.AsSpan(5, 8), SealedFormat.KeyId(backupKey)))
            {
                throw new ArchiveIntegrityException(
                    $"This backup was sealed with a different ENDGAME_BACKUP_KEY (archive key id {Convert.ToHexStringLower(header.AsSpan(5, 8))}, configured {SealedFormat.KeyIdHex(backupKey)}).");
            }

            aes = new AesGcm(SealedFormat.FileKey(backupKey, header[13..]), SealedFormat.TagSize);
        }

        var frame = new byte[5];
        if (!await FillAsync(frame, cancellationToken))
        {
            throw new ArchiveIntegrityException("The backup is truncated: it ends before its final chunk.");
        }

        var last = frame[0] switch
        {
            0 => false,
            1 => true,
            _ => throw new ArchiveIntegrityException($"The backup is damaged: chunk {counter} has an invalid frame."),
        };
        var length = BinaryPrimitives.ReadInt32BigEndian(frame.AsSpan(1));
        if (length is < 0 or > SealedFormat.ChunkSize)
        {
            throw new ArchiveIntegrityException($"The backup is damaged: chunk {counter} claims {length} bytes.");
        }

        var tag = new byte[SealedFormat.TagSize];
        if (!await FillAsync(cipher.AsMemory(0, length), cancellationToken) || !await FillAsync(tag, cancellationToken))
        {
            throw new ArchiveIntegrityException("The backup is truncated: its last chunk is cut short.");
        }

        var nonce = new byte[12];
        SealedFormat.Nonce(nonce, counter, last);
        try
        {
            aes.Decrypt(nonce, cipher.AsSpan(0, length), tag, plain.AsSpan(0, length), SealedFormat.AssociatedData(header, last, length));
        }
        catch (AuthenticationTagMismatchException)
        {
            throw new ArchiveIntegrityException($"The backup failed its integrity check at chunk {counter}: it has been altered or damaged.");
        }

        counter++;
        available = length;
        offset = 0;
        if (last)
        {
            sawLast = true;
            var probe = new byte[1];
            if (await inner.ReadAsync(probe, cancellationToken) != 0)
            {
                throw new ArchiveIntegrityException("The backup is damaged: there is data after its final chunk.");
            }
        }
    }

    /// <summary>Fills <paramref name="target"/>; false when the stream ends first.</summary>
    private async Task<bool> FillAsync(Memory<byte> target, CancellationToken cancellationToken)
    {
        var read = 0;
        while (read < target.Length)
        {
            var n = await inner.ReadAsync(target[read..], cancellationToken);
            if (n == 0)
            {
                return false;
            }

            read += n;
        }

        return true;
    }
}

/// <summary>A pass-through that counts and hashes what flows through it.</summary>
internal sealed class HashingWriteStream(Stream inner) : Stream
{
    private readonly IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

    public long Bytes { get; private set; }

    public string Sha256Hex() => Convert.ToHexStringLower(hash.GetCurrentHash());

    public override bool CanRead => false;

    public override bool CanSeek => false;

    public override bool CanWrite => true;

    public override long Length => Bytes;

    public override long Position { get => Bytes; set => throw new NotSupportedException(); }

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));

    public override void Write(ReadOnlySpan<byte> buffer)
    {
        hash.AppendData(buffer);
        Bytes += buffer.Length;
        inner.Write(buffer);
    }

    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        hash.AppendData(buffer.Span);
        Bytes += buffer.Length;
        await inner.WriteAsync(buffer, cancellationToken);
    }

    public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    public override void Flush() => inner.Flush();

    public override Task FlushAsync(CancellationToken cancellationToken) => inner.FlushAsync(cancellationToken);

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            hash.Dispose();
        }

        base.Dispose(disposing);
    }
}

