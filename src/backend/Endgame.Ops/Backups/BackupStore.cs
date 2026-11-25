using System.Globalization;
using System.Text.RegularExpressions;

namespace Endgame.Ops.Backups;

/// <summary>One archive in a store. <see cref="Id"/> is what <c>make restore BACKUP=</c> takes.</summary>
public sealed record StoredBackup(string Id, string Name, long Bytes, DateTimeOffset CreatedAt);

/// <summary>An archive being written: <see cref="Stream"/> takes the sealed bytes; nothing is visible until <see cref="CommitAsync"/>.</summary>
public interface IBackupUpload : IAsyncDisposable
{
    Stream Stream { get; }

    Task CommitAsync(CancellationToken cancellationToken);

    Task AbortAsync(CancellationToken cancellationToken);
}

/// <summary>Where archives live: a bucket (offsite) or a host directory (local development).</summary>
public interface IBackupStore
{
    bool Offsite { get; }

    /// <summary>Plain words for <c>/health</c>: where backups are going.</summary>
    string Describe { get; }

    Task<IReadOnlyList<StoredBackup>> ListAsync(CancellationToken cancellationToken);

    Task<IBackupUpload> BeginUploadAsync(string name, CancellationToken cancellationToken);

    Task<Stream> OpenReadAsync(string name, CancellationToken cancellationToken);

    Task DeleteAsync(string name, CancellationToken cancellationToken);
}

/// <summary>Archive names: <c>endgame-20261125T010000Z.egbk</c>, id <c>20261125T010000Z</c>.</summary>
public static partial class BackupNames
{
    public const string Extension = ".egbk";
    private const string Format = "yyyyMMdd'T'HHmmss'Z'";

    public static string IdFor(DateTimeOffset at) => at.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture);

    public static string FileName(string id) => $"endgame-{id}{Extension}";

    /// <summary>The store entry for a file name, or null when it is not an archive this service wrote.</summary>
    public static StoredBackup? Parse(string fileName, long bytes)
    {
        var match = NamePattern().Match(fileName);
        if (!match.Success)
        {
            return null;
        }

        var id = match.Groups["id"].Value;
        var at = DateTime.ParseExact(id, Format, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
        return new StoredBackup(id, fileName, bytes, new DateTimeOffset(at, TimeSpan.Zero));
    }

    /// <summary>Accepts an id, a file name, or a store key ending in one.</summary>
    public static string NormaliseId(string given)
    {
        var name = given.Trim().Split('/')[^1];
        var match = NamePattern().Match(name);
        if (match.Success)
        {
            return match.Groups["id"].Value;
        }

        return IdPattern().IsMatch(name)
            ? name
            : throw new ArgumentException($"'{given}' is not a backup id (they look like 20261125T010000Z; `make ops-backups` lists them).");
    }

    [GeneratedRegex(@"^endgame-(?<id>\d{8}T\d{6}Z)\.egbk$")]
    private static partial Regex NamePattern();

    [GeneratedRegex(@"^\d{8}T\d{6}Z$")]
    private static partial Regex IdPattern();
}

/// <summary>A host directory: the local-development default, and never offsite.</summary>
public sealed class LocalDirectoryStore(string directory) : IBackupStore
{
    public bool Offsite => false;

    public string Describe => $"a directory on this machine ({directory}), not offsite: no bucket is configured";

    public Task<IReadOnlyList<StoredBackup>> ListAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(directory))
        {
            return Task.FromResult<IReadOnlyList<StoredBackup>>([]);
        }

        IReadOnlyList<StoredBackup> found = new DirectoryInfo(directory).EnumerateFiles("*" + BackupNames.Extension)
            .Select(f => BackupNames.Parse(f.Name, f.Length))
            .OfType<StoredBackup>()
            .OrderBy(b => b.CreatedAt)
            .ToList();
        return Task.FromResult(found);
    }

    public Task<IBackupUpload> BeginUploadAsync(string name, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        var final = Path.Combine(directory, name);
        var partial = Path.Combine(directory, $".{name}.partial");
        var stream = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true);
        return Task.FromResult<IBackupUpload>(new Upload(stream, partial, final));
    }

    public Task<Stream> OpenReadAsync(string name, CancellationToken cancellationToken)
    {
        var path = Path.Combine(directory, name);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"There is no backup {name} in {directory}.");
        }

        return Task.FromResult<Stream>(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true));
    }

    public Task DeleteAsync(string name, CancellationToken cancellationToken)
    {
        File.Delete(Path.Combine(directory, name));
        return Task.CompletedTask;
    }

    private sealed class Upload(FileStream stream, string partial, string final) : IBackupUpload
    {
        private bool done;

        public Stream Stream => stream;

        public async Task CommitAsync(CancellationToken cancellationToken)
        {
            await stream.FlushAsync(cancellationToken);
            stream.Flush(flushToDisk: true);
            await stream.DisposeAsync();
            File.Move(partial, final);
            done = true;
        }

        public async Task AbortAsync(CancellationToken cancellationToken)
        {
            await stream.DisposeAsync();
            File.Delete(partial);
            done = true;
        }

        public async ValueTask DisposeAsync()
        {
            if (!done)
            {
                await AbortAsync(CancellationToken.None);
            }
        }
    }
}
