using System.Text.Json;
using System.Text.Json.Serialization;

namespace Endgame.Ops.Backups;

/// <summary>
/// The archive's inventory, written as its <b>last</b> entry (so it can describe everything before
/// it). A restore checks the archive against it before touching anything.
/// </summary>
public sealed record BackupManifest(
    string Format,
    string Id,
    DateTimeOffset CreatedAt,
    string PostgresVersion,
    ArchivedFile Globals,
    IReadOnlyList<ArchivedDatabase> Databases,
    IReadOnlyList<ArchivedVolume> Volumes)
{
    public const string CurrentFormat = "endgame-backup/1";
    public const string EntryName = "manifest.json";
    public const string GlobalsEntry = "postgres/globals.sql";
    public const string DatabasePrefix = "postgres/databases/";
    public const string VolumePrefix = "volumes/";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string DatabaseEntry(string database) => $"{DatabasePrefix}{database}.dump";
}

public sealed record ArchivedFile(long Bytes, string Sha256);

public sealed record ArchivedDatabase(string Name, long Bytes, string Sha256);

/// <summary>A directory: its file count, total bytes and a SHA-256 over every file's path and contents, in archive order.</summary>
public sealed record ArchivedVolume(string Name, long Files, long Bytes, string Sha256);

/// <summary>What a backup did, for the log, <c>/health</c> and the rehearsal's report.</summary>
public sealed record BackupResult(
    string Id,
    string Name,
    string Destination,
    long ArchiveBytes,
    long PlaintextBytes,
    double Seconds,
    IReadOnlyList<string> Databases,
    IReadOnlyList<ArchivedVolume> Volumes,
    IReadOnlyList<string> Pruned);

/// <summary>What a restore did.</summary>
public sealed record RestoreResult(
    string Id,
    double VerifySeconds,
    double RestoreSeconds,
    IReadOnlyList<string> Databases,
    IReadOnlyList<ArchivedVolume> Volumes);
