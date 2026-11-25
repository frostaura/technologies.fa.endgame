using System.Diagnostics;
using System.Formats.Tar;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Endgame.Ops.Backups;

/// <summary>A backup or restore could not take the lease: another one is running.</summary>
public sealed class BackupBusyException() : Exception("Another backup or restore is running; try again when it has finished.");

/// <summary>A restore refused to run. Nothing was changed.</summary>
public sealed class RestoreRefusedException(string message) : Exception(message);

/// <summary>
/// One archive of everything: every database (roles first, then each database as <c>pg_dump</c>'s
/// custom format), the app repositories volume and the uploaded-files volume if there is one —
/// tarred, sealed (<see cref="SealingStream"/>) and streamed to the store, so memory stays flat.
/// </summary>
public sealed class BackupService(
    BackupOptions options,
    IBackupStore store,
    PostgresTools postgres,
    BackupStatus status,
    TimeProvider clock,
    ILogger<BackupService> logger)
{
    private byte[] Key => BackupKey.Parse(options.Key);

    public Task<IReadOnlyList<StoredBackup>> ListAsync(CancellationToken cancellationToken) => store.ListAsync(cancellationToken);

    /// <summary>
    /// Whether any database holds anything yet. The nightly run skips a server that is still empty —
    /// a stack waiting to be restored onto — so it never files an empty archive as the newest.
    /// </summary>
    public async Task<bool> HasDataAsync(CancellationToken cancellationToken)
    {
        foreach (var database in await postgres.DatabasesAsync(cancellationToken))
        {
            if (await postgres.UserObjectCountAsync(database, cancellationToken) > 0)
            {
                return true;
            }
        }

        return false;
    }

    public async Task<BackupResult> BackupAsync(string trigger, CancellationToken cancellationToken)
    {
        if (options.WhyRefused() is { } why)
        {
            throw new InvalidOperationException(why);
        }

        await using var lease = await postgres.TryLeaseAsync(cancellationToken) ?? throw new BackupBusyException();
        var started = clock.GetUtcNow();
        status.Started(started, trigger);
        try
        {
            var result = await WriteAsync(started, cancellationToken);
            status.Succeeded(clock.GetUtcNow(), result);
            return result;
        }
        catch (Exception ex)
        {
            status.Failed(clock.GetUtcNow(), ex.Message);
            logger.LogError(ex, "Backup failed: {Message}", ex.Message);
            throw;
        }
    }

    /// <summary>Reads an archive end to end and checks it against its manifest. Changes nothing.</summary>
    public async Task<BackupManifest> VerifyAsync(string id, CancellationToken cancellationToken)
    {
        var name = BackupNames.FileName(BackupNames.NormaliseId(id));
        await using var source = await store.OpenReadAsync(name, cancellationToken);
        return await ReadAsync(source, restore: null, cancellationToken);
    }

    /// <summary>
    /// Restores an archive onto this stack's server and volumes: verified in full first, then refused
    /// if any target already holds data — unless <paramref name="overwrite"/>, which replaces it.
    /// </summary>
    public async Task<RestoreResult> RestoreAsync(string id, bool overwrite, Action<string> progress, CancellationToken cancellationToken)
    {
        if (options.Key.Length == 0 || options.Postgres.Length == 0)
        {
            throw new RestoreRefusedException(options.WhyRefused() ?? "Backups are not configured.");
        }

        id = BackupNames.NormaliseId(id);
        var name = BackupNames.FileName(id);
        await using var lease = await postgres.TryLeaseAsync(cancellationToken) ?? throw new BackupBusyException();

        progress($"Verifying {name} from {store.Describe}...");
        var watch = Stopwatch.StartNew();
        BackupManifest manifest;
        await using (var source = await store.OpenReadAsync(name, cancellationToken))
        {
            manifest = await ReadAsync(source, restore: null, cancellationToken);
        }

        var verifySeconds = watch.Elapsed.TotalSeconds;
        progress($"Verified: {manifest.Databases.Count} database(s), {manifest.Volumes.Sum(v => v.Files)} file(s), every chunk authenticated ({verifySeconds:0.0} s).");

        var occupied = new List<string>();
        foreach (var database in manifest.Databases)
        {
            if (await postgres.ExistsAsync(database.Name, cancellationToken) && await postgres.UserObjectCountAsync(database.Name, cancellationToken) > 0)
            {
                occupied.Add($"database {database.Name}");
            }
        }

        foreach (var volume in manifest.Volumes)
        {
            if (VolumeRoot(volume.Name) is { } root && Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any(e => Path.GetFileName(e) != "lost+found"))
            {
                occupied.Add($"volume {volume.Name} ({root})");
            }
        }

        if (occupied.Count > 0 && !overwrite)
        {
            throw new RestoreRefusedException(
                $"Refusing to restore over data that is already here: {string.Join(", ", occupied)}. Restore onto an empty stack, or pass OVERWRITE=1 to replace it.");
        }

        if (occupied.Count > 0)
        {
            progress($"Replacing what is already here (OVERWRITE): {string.Join(", ", occupied)}.");
        }

        watch.Restart();
        await using (var source = await store.OpenReadAsync(name, cancellationToken))
        {
            await ReadAsync(source, new RestoreTarget(manifest, overwrite, progress), cancellationToken);
        }

        var restoreSeconds = watch.Elapsed.TotalSeconds;
        progress($"Restored {name} in {restoreSeconds:0.0} s.");
        return new RestoreResult(id, verifySeconds, restoreSeconds, manifest.Databases.Select(d => d.Name).ToList(), manifest.Volumes);
    }

    private string? VolumeRoot(string volume) => volume switch
    {
        "repositories" when options.RepositoriesDirectory.Length > 0 => options.RepositoriesDirectory,
        "uploads" when options.UploadsDirectory.Length > 0 => options.UploadsDirectory,
        _ => null,
    };

    private async Task<BackupResult> WriteAsync(DateTimeOffset started, CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var existing = await store.ListAsync(cancellationToken);
        var at = started;
        while (existing.Any(b => b.Id == BackupNames.IdFor(at)))
        {
            at = at.AddSeconds(1);
        }

        var id = BackupNames.IdFor(at);
        var name = BackupNames.FileName(id);
        Directory.CreateDirectory(options.WorkDirectory);
        var databases = await postgres.DatabasesAsync(cancellationToken);
        var version = await postgres.ServerVersionAsync(cancellationToken);
        logger.LogInformation("Backup {Name}: {Count} database(s) to {Destination}", name, databases.Count, store.Describe);

        await using var upload = await store.BeginUploadAsync(name, cancellationToken);
        var sealing = new SealingStream(upload.Stream, Key, leaveOpen: true);
        ArchivedFile globals;
        var archivedDatabases = new List<ArchivedDatabase>();
        var volumes = new List<ArchivedVolume>();
        await using (var tar = new TarWriter(sealing, TarEntryFormat.Pax, leaveOpen: true))
        {
            globals = await DumpIntoAsync(tar, BackupManifest.GlobalsEntry, "pg_dumpall", ["--globals-only", "--no-tablespaces"], cancellationToken);
            foreach (var database in databases)
            {
                var file = await DumpIntoAsync(tar, BackupManifest.DatabaseEntry(database), "pg_dump", ["--format=custom", "--compress=6", "--dbname", database], cancellationToken);
                archivedDatabases.Add(new ArchivedDatabase(database, file.Bytes, file.Sha256));
            }

            foreach (var volume in new[] { "repositories", "uploads" })
            {
                if (VolumeRoot(volume) is { } root && Directory.Exists(root))
                {
                    volumes.Add(await ArchiveVolumeAsync(tar, volume, root, cancellationToken));
                }
            }

            var manifest = new BackupManifest(BackupManifest.CurrentFormat, id, at, version, globals, archivedDatabases, volumes);
            var json = JsonSerializer.SerializeToUtf8Bytes(manifest, BackupManifest.Json);
            await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.RegularFile, BackupManifest.EntryName)
            {
                DataStream = new MemoryStream(json),
                ModificationTime = at,
            }, cancellationToken);
        }

        await sealing.FinishAsync(cancellationToken);
        await sealing.DisposeAsync();
        await upload.CommitAsync(cancellationToken);
        var seconds = watch.Elapsed.TotalSeconds;
        logger.LogInformation("Backup {Name} written: {Bytes} bytes sealed in {Seconds:0.0} s", name, sealing.SealedBytes, seconds);

        var pruned = new List<string>();
        var (_, delete) = Retention.Apply(await store.ListAsync(cancellationToken), options.KeepDaily, options.KeepWeekly);
        foreach (var old in delete)
        {
            await store.DeleteAsync(old.Name, cancellationToken);
            pruned.Add(old.Id);
            logger.LogInformation("Backup {Name} pruned by retention", old.Name);
        }

        return new BackupResult(id, name, store.Describe, sealing.SealedBytes, sealing.PlaintextBytes, seconds, databases, volumes, pruned);
    }

    /// <summary>Spools a tool's output to the work directory (an archive entry needs its length first), hashing it, then archives it.</summary>
    private async Task<ArchivedFile> DumpIntoAsync(TarWriter tar, string entryName, string tool, IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        var spool = Path.Combine(options.WorkDirectory, $"{Guid.NewGuid():N}.spool");
        try
        {
            ArchivedFile file;
            await using (var output = new FileStream(spool, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
            {
                using var hashing = new HashingWriteStream(output);
                await postgres.RunAsync(tool, arguments, hashing, null, cancellationToken);
                file = new ArchivedFile(hashing.Bytes, hashing.Sha256Hex());
            }

            await using var data = new FileStream(spool, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16, useAsync: true);
            await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.RegularFile, entryName) { DataStream = data, ModificationTime = clock.GetUtcNow() }, cancellationToken);
            return file;
        }
        finally
        {
            File.Delete(spool);
        }
    }

    private static async Task<ArchivedVolume> ArchiveVolumeAsync(TarWriter tar, string volume, string root, CancellationToken cancellationToken)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long files = 0;
        long bytes = 0;
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.TryPop(out var directory))
        {
            IEnumerable<FileSystemInfo> children;
            try
            {
                children = new DirectoryInfo(directory).EnumerateFileSystemInfos().OrderBy(c => c.Name, StringComparer.Ordinal).ToList();
            }
            catch (DirectoryNotFoundException)
            {
                continue; // removed while we walked: it was not there to back up
            }

            foreach (var child in children)
            {
                var relative = Path.GetRelativePath(root, child.FullName).Replace(Path.DirectorySeparatorChar, '/');
                var entryName = $"{BackupManifest.VolumePrefix}{volume}/{relative}";
                if (child.LinkTarget is { } target)
                {
                    VolumeHash.Link(hash, relative, target);
                    await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.SymbolicLink, entryName) { LinkName = target, ModificationTime = child.LastWriteTimeUtc }, cancellationToken);
                    files++;
                }
                else if (child is DirectoryInfo)
                {
                    VolumeHash.Directory(hash, relative);
                    await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.Directory, entryName + "/") { Mode = ModeOf(child), ModificationTime = child.LastWriteTimeUtc }, cancellationToken);
                    pending.Push(child.FullName);
                }
                else if (child is FileInfo file)
                {
                    FileStream data;
                    try
                    {
                        data = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, useAsync: true);
                    }
                    catch (FileNotFoundException)
                    {
                        continue; // removed while we walked
                    }

                    await using (data)
                    {
                        await VolumeHash.FileAsync(hash, relative, data, cancellationToken);
                        data.Position = 0;
                        await tar.WriteEntryAsync(new PaxTarEntry(TarEntryType.RegularFile, entryName) { DataStream = data, Mode = ModeOf(child), ModificationTime = file.LastWriteTimeUtc }, cancellationToken);
                        files++;
                        bytes += data.Length;
                    }
                }
            }
        }

        return new ArchivedVolume(volume, files, bytes, Convert.ToHexStringLower(hash.GetCurrentHash()));
    }

    private static UnixFileMode ModeOf(FileSystemInfo info) => OperatingSystem.IsWindows()
        ? UnixFileMode.UserRead | UnixFileMode.UserWrite
        : info.UnixFileMode;

    /// <summary>
    /// Reads an archive. With <paramref name="restore"/> null it only verifies; otherwise it also
    /// restores each entry as it passes. Either way, any mismatch with the manifest throws.
    /// </summary>
    private async Task<BackupManifest> ReadAsync(Stream source, RestoreTarget? restore, CancellationToken cancellationToken)
    {
        await using var unsealing = new UnsealingStream(source, Key, leaveOpen: true);
        await using var tar = new TarReader(unsealing, leaveOpen: true);
        ArchivedFile? globals = null;
        var databases = new List<ArchivedDatabase>();
        var volumes = new Dictionary<string, (IncrementalHash Hash, long Files, long Bytes)>(StringComparer.Ordinal);
        BackupManifest? manifest = null;
        var restoredVolumes = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            TarEntry? entry;
            while ((entry = await tar.GetNextEntryAsync(copyData: false, cancellationToken)) is not null)
            {
                if (manifest is not null)
                {
                    throw new ArchiveIntegrityException("The backup is damaged: it has entries after its manifest.");
                }

                var name = entry.Name;
                if (name == BackupManifest.EntryName)
                {
                    manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(entry.DataStream!, BackupManifest.Json, cancellationToken)
                        ?? throw new ArchiveIntegrityException("The backup's manifest is empty.");
                }
                else if (name == BackupManifest.GlobalsEntry)
                {
                    using var buffer = new MemoryStream();
                    using (var hashing = new HashingWriteStream(buffer))
                    {
                        await entry.DataStream!.CopyToAsync(hashing, cancellationToken);
                        globals = new ArchivedFile(hashing.Bytes, hashing.Sha256Hex());
                    }

                    if (restore is not null)
                    {
                        Expect(restore.Manifest.Globals, globals, "the roles");
                        restore.Progress("Restoring roles...");
                        var prepared = PostgresTools.PrepareGlobals(Encoding.UTF8.GetString(buffer.ToArray()), postgres.User);
                        using var input = new MemoryStream(Encoding.UTF8.GetBytes(prepared));
                        await postgres.RunAsync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", "postgres"], null, input, cancellationToken);
                    }
                }
                else if (name.StartsWith(BackupManifest.DatabasePrefix, StringComparison.Ordinal) && name.EndsWith(".dump", StringComparison.Ordinal))
                {
                    var database = name[BackupManifest.DatabasePrefix.Length..^".dump".Length];
                    databases.Add(await ReadDatabaseAsync(database, entry.DataStream!, restore, cancellationToken));
                }
                else if (name.StartsWith(BackupManifest.VolumePrefix, StringComparison.Ordinal))
                {
                    var rest = name[BackupManifest.VolumePrefix.Length..];
                    var slash = rest.IndexOf('/', StringComparison.Ordinal);
                    var volume = rest[..slash];
                    var relative = rest[(slash + 1)..].TrimEnd('/');
                    if (!volumes.TryGetValue(volume, out var state))
                    {
                        state = (IncrementalHash.CreateHash(HashAlgorithmName.SHA256), 0, 0);
                    }

                    string? root = null;
                    if (restore is not null)
                    {
                        root = VolumeRoot(volume) ?? throw new RestoreRefusedException($"The backup holds a volume '{volume}' that this stack has no directory for.");
                        if (restoredVolumes.Add(volume))
                        {
                            restore.Progress($"Restoring the {volume} volume into {root}...");
                            Directory.CreateDirectory(root);
                            if (restore.Overwrite)
                            {
                                foreach (var existing in new DirectoryInfo(root).EnumerateFileSystemInfos().Where(e => e.Name != "lost+found"))
                                {
                                    if (existing is DirectoryInfo d && d.LinkTarget is null)
                                    {
                                        d.Delete(recursive: true);
                                    }
                                    else
                                    {
                                        existing.Delete();
                                    }
                                }
                            }
                        }
                    }

                    var target = root is null ? null : SafePath(root, relative);
                    switch (entry.EntryType)
                    {
                        case TarEntryType.Directory:
                            VolumeHash.Directory(state.Hash, relative);
                            if (target is not null)
                            {
                                Directory.CreateDirectory(target);
                                SetMode(target, entry.Mode);
                            }

                            break;
                        case TarEntryType.SymbolicLink:
                            VolumeHash.Link(state.Hash, relative, entry.LinkName);
                            state.Files++;
                            if (target is not null)
                            {
                                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                                File.CreateSymbolicLink(target, entry.LinkName);
                            }

                            break;
                        case TarEntryType.RegularFile:
                            state.Files++;
                            state.Bytes += entry.Length;
                            if (target is null)
                            {
                                await VolumeHash.FileAsync(state.Hash, relative, entry.DataStream ?? Stream.Null, cancellationToken);
                            }
                            else
                            {
                                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                                await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
                                {
                                    await VolumeHash.FileAsync(state.Hash, relative, entry.DataStream ?? Stream.Null, cancellationToken, copyTo: output);
                                }

                                SetMode(target, entry.Mode);
                                File.SetLastWriteTimeUtc(target, entry.ModificationTime.UtcDateTime);
                            }

                            break;
                        default:
                            throw new ArchiveIntegrityException($"The backup holds an entry of a kind it never writes ({entry.EntryType}: {name}).");
                    }

                    volumes[volume] = state;
                }
                else
                {
                    throw new ArchiveIntegrityException($"The backup holds an entry it does not recognise: {name}.");
                }
            }

            if (manifest is null)
            {
                throw new ArchiveIntegrityException("The backup has no manifest: it is incomplete.");
            }

            if (manifest.Format != BackupManifest.CurrentFormat)
            {
                throw new ArchiveIntegrityException($"The backup's manifest is format {manifest.Format}; this version reads {BackupManifest.CurrentFormat}.");
            }

            Expect(manifest.Globals, globals ?? throw new ArchiveIntegrityException("The backup has no roles."), "the roles");
            if (!manifest.Databases.Select(d => d.Name).SequenceEqual(databases.Select(d => d.Name)))
            {
                throw new ArchiveIntegrityException("The backup's databases do not match its manifest.");
            }

            foreach (var (expected, actual) in manifest.Databases.Zip(databases))
            {
                Expect(new ArchivedFile(expected.Bytes, expected.Sha256), new ArchivedFile(actual.Bytes, actual.Sha256), $"database {expected.Name}");
            }

            foreach (var expected in manifest.Volumes)
            {
                var (hash, files, bytes) = volumes.TryGetValue(expected.Name, out var s) ? s : (IncrementalHash.CreateHash(HashAlgorithmName.SHA256), 0, 0);
                var actual = new ArchivedVolume(expected.Name, files, bytes, Convert.ToHexStringLower(hash.GetCurrentHash()));
                if (actual != expected)
                {
                    throw new ArchiveIntegrityException($"The {expected.Name} volume does not match the backup's manifest ({actual.Files} files, expected {expected.Files}).");
                }
            }

            return manifest;
        }
        finally
        {
            foreach (var (hash, _, _) in volumes.Values)
            {
                hash.Dispose();
            }
        }
    }

    private async Task<ArchivedDatabase> ReadDatabaseAsync(string database, Stream data, RestoreTarget? restore, CancellationToken cancellationToken)
    {
        if (restore is null)
        {
            using var hashing = new HashingWriteStream(Stream.Null);
            await data.CopyToAsync(hashing, cancellationToken);
            return new ArchivedDatabase(database, hashing.Bytes, hashing.Sha256Hex());
        }

        // pg_restore reads its custom format from a file: from a pipe, out-of-order items can fail.
        Directory.CreateDirectory(options.WorkDirectory);
        var spool = Path.Combine(options.WorkDirectory, $"{Guid.NewGuid():N}.spool");
        try
        {
            ArchivedDatabase archived;
            await using (var output = new FileStream(spool, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
            {
                using var hashing = new HashingWriteStream(output);
                await data.CopyToAsync(hashing, cancellationToken);
                archived = new ArchivedDatabase(database, hashing.Bytes, hashing.Sha256Hex());
            }

            var expected = restore.Manifest.Databases.FirstOrDefault(d => d.Name == database)
                ?? throw new ArchiveIntegrityException($"The backup holds database {database}, which its manifest does not list.");
            Expect(new ArchivedFile(expected.Bytes, expected.Sha256), new ArchivedFile(archived.Bytes, archived.Sha256), $"database {database}");

            restore.Progress($"Restoring database {database}...");
            if (await postgres.ExistsAsync(database, cancellationToken))
            {
                // Empty (checked before anything was touched) or OVERWRITE was given: --create makes it afresh, with its owner and grants.
                await postgres.DropAsync(database, cancellationToken);
            }

            await postgres.RunAsync("pg_restore", ["--create", "--exit-on-error", "--dbname", "postgres", spool], null, null, cancellationToken);
            return archived;
        }
        finally
        {
            File.Delete(spool);
        }
    }

    private static void Expect(ArchivedFile expected, ArchivedFile actual, string what)
    {
        if (expected != actual)
        {
            throw new ArchiveIntegrityException($"The backup's copy of {what} does not match its manifest.");
        }
    }

    private static string SafePath(string root, string relative)
    {
        var full = Path.GetFullPath(Path.Combine(root, relative));
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return full.StartsWith(prefix, StringComparison.Ordinal)
            ? full
            : throw new ArchiveIntegrityException($"The backup holds a path that leaves its volume: {relative}.");
    }

    private static void SetMode(string path, UnixFileMode mode)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, mode);
        }
    }

    private sealed record RestoreTarget(BackupManifest Manifest, bool Overwrite, Action<string> Progress);
}

/// <summary>The volume digest: every path in archive order, with each file's size and contents.</summary>
internal static class VolumeHash
{
    public static void Directory(IncrementalHash hash, string relative) => hash.AppendData(Encoding.UTF8.GetBytes($"d\0{relative}\0"));

    public static void Link(IncrementalHash hash, string relative, string target) => hash.AppendData(Encoding.UTF8.GetBytes($"l\0{relative}\0{target}\0"));

    public static async Task FileAsync(IncrementalHash hash, string relative, Stream data, CancellationToken cancellationToken, Stream? copyTo = null)
    {
        hash.AppendData(Encoding.UTF8.GetBytes($"f\0{relative}\0"));
        var buffer = new byte[1 << 16];
        int n;
        while ((n = await data.ReadAsync(buffer, cancellationToken)) > 0)
        {
            hash.AppendData(buffer, 0, n);
            if (copyTo is not null)
            {
                await copyTo.WriteAsync(buffer.AsMemory(0, n), cancellationToken);
            }
        }

        hash.AppendData("\0"u8);
    }
}
