using System.Formats.Tar;
using Docker.DotNet;
using Docker.DotNet.Models;

namespace Endgame.Dock.Engine;

/// <summary>Copies files into and out of a container through the Engine's archive API.</summary>
public sealed class ContainerFiles(DockerClient docker)
{
    /// <summary>One file to place, relative to the extraction directory.</summary>
    public sealed record Entry(string RelativePath, byte[] Content, UnixFileMode Mode = DefaultFileMode);

    public const UnixFileMode DefaultFileMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead;

    private const UnixFileMode DirectoryMode = UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
        | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute;

    /// <summary>
    /// Writes <paramref name="entries"/> under <paramref name="directory"/>, owned by
    /// <paramref name="uid"/>, creating missing parent directories.
    /// </summary>
    public async Task WriteAsync(string container, string directory, IEnumerable<Entry> entries, int uid, CancellationToken cancellationToken)
    {
        using var tar = new MemoryStream();
        await using (var writer = new TarWriter(tar, TarEntryFormat.Pax, leaveOpen: true))
        {
            var directories = new SortedSet<string>(StringComparer.Ordinal);
            var files = entries.ToList();
            foreach (var file in files)
            {
                var parts = file.RelativePath.Split('/');
                for (var i = 1; i < parts.Length; i++)
                {
                    directories.Add(string.Join('/', parts[..i]));
                }
            }

            foreach (var dir in directories)
            {
                await writer.WriteEntryAsync(new PaxTarEntry(TarEntryType.Directory, dir + "/") { Mode = DirectoryMode, Uid = uid, Gid = uid }, cancellationToken);
            }

            foreach (var file in files)
            {
                var entry = new PaxTarEntry(TarEntryType.RegularFile, file.RelativePath)
                {
                    Mode = file.Mode,
                    Uid = uid,
                    Gid = uid,
                    DataStream = new MemoryStream(file.Content, writable: false),
                };
                await writer.WriteEntryAsync(entry, cancellationToken);
            }
        }

        tar.Position = 0;
        await docker.Containers.ExtractArchiveToContainerAsync(container, new CopyToContainerParameters { Path = directory, CopyUIDGID = true }, tar, cancellationToken);
    }

    /// <summary>Uploads a prepared tar archive, keeping the owners written in it.</summary>
    public Task WriteArchiveAsync(string container, string directory, Stream tar, CancellationToken cancellationToken) =>
        docker.Containers.ExtractArchiveToContainerAsync(container, new CopyToContainerParameters { Path = directory, CopyUIDGID = true }, tar, cancellationToken);

    /// <summary>
    /// Reads one regular file. Returns null when it does not exist; throws
    /// <see cref="FileTooLargeException"/> past <paramref name="maxBytes"/>.
    /// </summary>
    public async Task<byte[]?> ReadAsync(string container, string path, long maxBytes, CancellationToken cancellationToken)
    {
        using var file = await OpenReadAsync(container, path, maxBytes, cancellationToken);
        if (file is null)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    /// <summary>Copies one regular file out of the container to <paramref name="destination"/>.</summary>
    public async Task<bool> CopyOutAsync(string container, string path, string destination, long maxBytes, CancellationToken cancellationToken)
    {
        using var file = await OpenReadAsync(container, path, maxBytes, cancellationToken);
        if (file is null)
        {
            return false;
        }

        await using var output = File.Create(destination);
        await file.CopyToAsync(output, cancellationToken);
        return true;
    }

    public async Task<Stream?> OpenReadAsync(string container, string path, long maxBytes, CancellationToken cancellationToken)
    {
        ContainerArchiveResponse archive;
        try
        {
            archive = await docker.Containers.GetArchiveFromContainerAsync(container, new ContainerPathStatParameters { Path = path }, false, cancellationToken);
        }
        catch (DockerContainerNotFoundException)
        {
            return null;
        }
        catch (DockerApiException e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        if (archive.Stream is null)
        {
            return null;
        }

        if (archive.Stat?.Size > maxBytes)
        {
            archive.Stream.Dispose();
            throw new FileTooLargeException(archive.Stat.Size);
        }

        var reader = new TarReader(archive.Stream, leaveOpen: false);
        var entry = await reader.GetNextEntryAsync(copyData: false, cancellationToken);
        if (entry is null || entry.EntryType is not (TarEntryType.RegularFile or TarEntryType.V7RegularFile) || entry.DataStream is null)
        {
            await reader.DisposeAsync();
            return null;
        }

        return new OwnedStream(entry.DataStream, reader);
    }

    /// <summary>A tar entry's data that disposes its reader along with it.</summary>
    private sealed class OwnedStream(Stream inner, TarReader owner) : Stream
    {
        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => inner.Length;

        public override long Position { get => inner.Position; set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => inner.ReadAsync(buffer, cancellationToken);

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
                owner.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}

public sealed class FileTooLargeException(long size) : Exception($"The file is {size} bytes.")
{
    public long Size { get; } = size;
}
