using System.Formats.Tar;

namespace Endgame.Dock.Engine;

/// <summary>Copies a tar archive with every entry re-owned, so a non-root container can write to what it unpacks.</summary>
public static class TarOwnership
{
    public static async Task RewriteAsync(Stream input, Stream output, int uid, CancellationToken cancellationToken)
    {
        await using var reader = new TarReader(input, leaveOpen: true);
        await using var writer = new TarWriter(output, TarEntryFormat.Pax, leaveOpen: true);
        while (await reader.GetNextEntryAsync(copyData: false, cancellationToken) is { } entry)
        {
            if (entry.EntryType is TarEntryType.GlobalExtendedAttributes)
            {
                continue; // git archive's commit-id header: not a file
            }

            var copy = new PaxTarEntry(entry.EntryType == TarEntryType.V7RegularFile ? TarEntryType.RegularFile : entry.EntryType, entry.Name)
            {
                Mode = entry.Mode,
                Uid = uid,
                Gid = uid,
                ModificationTime = entry.ModificationTime,
                DataStream = entry.DataStream,
            };
            if (entry.EntryType is TarEntryType.SymbolicLink or TarEntryType.HardLink)
            {
                copy.LinkName = entry.LinkName;
            }

            await writer.WriteEntryAsync(copy, cancellationToken);
        }
    }
}
