using System.Text;

namespace Endgame.Dock.Policy;

/// <summary>
/// Keeps the first and last part of a stream that may be far larger than an agent should read:
/// the head shows what ran, the tail shows how it ended, and the middle is counted, not kept.
/// </summary>
public sealed class OutputCapture(int maxBytes)
{
    private readonly int headLimit = Math.Max(0, maxBytes / 2);
    private readonly int tailLimit = Math.Max(0, maxBytes - (maxBytes / 2));
    private readonly MemoryStream head = new();
    private readonly Queue<byte[]> tail = new();
    private int tailBytes;
    private long dropped;

    public bool Truncated => dropped > 0;

    public long TotalBytes { get; private set; }

    public void Append(ReadOnlySpan<byte> data)
    {
        TotalBytes += data.Length;
        var toHead = Math.Min(data.Length, headLimit - (int)head.Length);
        if (toHead > 0)
        {
            head.Write(data[..toHead]);
            data = data[toHead..];
        }

        if (data.IsEmpty)
        {
            return;
        }

        tail.Enqueue(data.ToArray());
        tailBytes += data.Length;
        while (tailBytes > tailLimit && tail.Count > 0)
        {
            var excess = tailBytes - tailLimit;
            var first = tail.Peek();
            if (first.Length <= excess)
            {
                tail.Dequeue();
                tailBytes -= first.Length;
                dropped += first.Length;
            }
            else
            {
                tail.Dequeue();
                var kept = first[excess..];
                var rest = tail.ToArray();
                tail.Clear();
                tail.Enqueue(kept);
                foreach (var chunk in rest)
                {
                    tail.Enqueue(chunk);
                }

                tailBytes -= excess;
                dropped += excess;
            }
        }
    }

    public override string ToString()
    {
        var builder = new StringBuilder(Encoding.UTF8.GetString(head.GetBuffer(), 0, (int)head.Length));
        if (dropped > 0)
        {
            builder.Append(System.Globalization.CultureInfo.InvariantCulture, $"\n… [{dropped} bytes omitted] …\n");
        }

        foreach (var chunk in tail)
        {
            builder.Append(Encoding.UTF8.GetString(chunk));
        }

        return builder.ToString();
    }
}
