using System.Security.Cryptography;
using Endgame.Ops.Backups;

namespace Endgame.Ops.Tests;

public sealed class SealedStreamTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);

    private static async Task<byte[]> SealAsync(byte[] plaintext, byte[] key, int writeSize = 7_777, bool finish = true)
    {
        using var output = new MemoryStream();
        await using (var sealing = new SealingStream(output, key, leaveOpen: true))
        {
            for (var i = 0; i < plaintext.Length; i += writeSize)
            {
                await sealing.WriteAsync(plaintext.AsMemory(i, Math.Min(writeSize, plaintext.Length - i)));
            }

            if (finish)
            {
                await sealing.FinishAsync();
            }
        }

        return output.ToArray();
    }

    private static async Task<byte[]> UnsealAsync(byte[] sealedBytes, byte[] key)
    {
        await using var unsealing = new UnsealingStream(new MemoryStream(sealedBytes), key);
        using var output = new MemoryStream();
        await unsealing.CopyToAsync(output, 5_000);
        return output.ToArray();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(SealedFormat.ChunkSize - 1)]
    [InlineData(SealedFormat.ChunkSize)]
    [InlineData(SealedFormat.ChunkSize + 1)]
    [InlineData(3 * SealedFormat.ChunkSize)]
    [InlineData(1_000_003)]
    public async Task What_is_sealed_unseals_byte_for_byte(int length)
    {
        var plaintext = RandomNumberGenerator.GetBytes(length);
        var sealedBytes = await SealAsync(plaintext, Key);
        Assert.Equal(plaintext, await UnsealAsync(sealedBytes, Key));
        // Header, then per chunk 5 bytes of frame and a 16-byte tag; one final (possibly empty) chunk.
        var chunks = Math.Max(1, (length + SealedFormat.ChunkSize - 1) / SealedFormat.ChunkSize);
        Assert.Equal(SealedFormat.HeaderSize + length + (chunks * 21), sealedBytes.Length);
    }

    [Fact]
    public async Task The_plaintext_never_appears_in_the_archive()
    {
        var plaintext = "REHEARSAL_SECRET=correct horse battery staple, repeated "u8.ToArray();
        var big = Enumerable.Repeat(plaintext, 2_000).SelectMany(b => b).ToArray();
        var sealedBytes = await SealAsync(big, Key);
        Assert.Equal(-1, sealedBytes.AsSpan().IndexOf("correct horse"u8));
        Assert.Equal("EGBK"u8.ToArray(), sealedBytes[..4]);
    }

    [Fact]
    public async Task Two_archives_of_the_same_bytes_differ()
    {
        var plaintext = RandomNumberGenerator.GetBytes(1000);
        Assert.NotEqual(await SealAsync(plaintext, Key), await SealAsync(plaintext, Key));
    }

    [Fact]
    public async Task A_different_key_is_named_as_such()
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(100), Key);
        var error = await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync(sealedBytes, RandomNumberGenerator.GetBytes(32)));
        Assert.Contains("different ENDGAME_BACKUP_KEY", error.Message);
    }

    [Theory]
    [InlineData(SealedFormat.HeaderSize + 10)]                 // ciphertext of the first chunk
    [InlineData(SealedFormat.HeaderSize + 1)]                  // a chunk's length
    [InlineData(20)]                                           // the salt
    [InlineData(-3)]                                           // the last tag
    public async Task Any_altered_byte_fails_the_integrity_check(int position)
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(150_000), Key);
        var at = position < 0 ? sealedBytes.Length + position : position;
        sealedBytes[at] ^= 0x01;
        await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync(sealedBytes, Key));
    }

    [Fact]
    public async Task A_truncated_archive_is_refused_even_at_a_chunk_boundary()
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(3 * SealedFormat.ChunkSize), Key);
        var firstTwoChunks = SealedFormat.HeaderSize + (2 * (SealedFormat.ChunkSize + 21));
        var error = await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync(sealedBytes[..firstTwoChunks], Key));
        Assert.Contains("truncated", error.Message);
    }

    [Fact]
    public async Task An_archive_never_finished_is_refused()
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(3 * SealedFormat.ChunkSize), Key, finish: false);
        await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync(sealedBytes, Key));
    }

    [Fact]
    public async Task Bytes_after_the_final_chunk_are_refused()
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(10), Key);
        var error = await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync([.. sealedBytes, 0], Key));
        Assert.Contains("after its final chunk", error.Message);
    }

    [Fact]
    public async Task Swapping_two_chunks_fails()
    {
        var sealedBytes = await SealAsync(RandomNumberGenerator.GetBytes(2 * SealedFormat.ChunkSize + 5), Key);
        var size = SealedFormat.ChunkSize + 21;
        var first = sealedBytes.AsSpan(SealedFormat.HeaderSize, size).ToArray();
        var second = sealedBytes.AsSpan(SealedFormat.HeaderSize + size, size).ToArray();
        second.CopyTo(sealedBytes, SealedFormat.HeaderSize);
        first.CopyTo(sealedBytes, SealedFormat.HeaderSize + size);
        await Assert.ThrowsAsync<ArchiveIntegrityException>(() => UnsealAsync(sealedBytes, Key));
    }

    [Fact]
    public void The_key_is_read_as_hex_or_base64_and_must_be_32_bytes()
    {
        var key = RandomNumberGenerator.GetBytes(32);
        Assert.True(BackupKey.TryParse(Convert.ToHexString(key), out var fromHex));
        Assert.Equal(key, fromHex);
        Assert.True(BackupKey.TryParse(Convert.ToBase64String(key), out var fromBase64));
        Assert.Equal(key, fromBase64);
        Assert.False(BackupKey.TryParse(Convert.ToHexString(key)[..62], out _));
        Assert.False(BackupKey.TryParse("not a key", out _));
        Assert.False(BackupKey.TryParse(Convert.ToBase64String(new byte[16]), out _));
    }
}
