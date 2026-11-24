using System.Text.Json;

namespace Endgame.Dock.Engine;

/// <summary>
/// A small JSON document on Dock's data volume, written atomically. Dock keeps almost no state of
/// its own — names, subnets and owners live on the Docker resources themselves — so only what the
/// engine cannot hold (renewed leases, allow-lists) is here.
/// </summary>
public sealed class StateFile<T>(string path)
    where T : class, new()
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<T> ReadAsync(CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            return await ReadUnlockedAsync(cancellationToken);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<T> UpdateAsync(Action<T> change, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var value = await ReadUnlockedAsync(cancellationToken);
            change(value);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(value, Json), cancellationToken);
            File.Move(temporary, path, overwrite: true);
            return value;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<T> ReadUnlockedAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(path))
        {
            return new T();
        }

        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<T>(stream, Json, cancellationToken) ?? new T();
    }
}
