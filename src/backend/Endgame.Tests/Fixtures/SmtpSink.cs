using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// An in-test SMTP server on a free loopback port that accepts every message and keeps it, so the
/// control plane's real SMTP sender is exercised end to end and nothing leaves the machine.
/// Speaks just enough SMTP for one client: EHLO/HELO, MAIL, RCPT, DATA, RSET, NOOP, QUIT.
/// </summary>
public sealed class SmtpSink : IAsyncDisposable
{
    private readonly TcpListener listener;
    private readonly CancellationTokenSource stop = new();
    private readonly Task loop;

    public SmtpSink()
    {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        loop = Task.Run(AcceptAsync);
    }

    public int Port { get; }

    public ConcurrentQueue<Received> Messages { get; } = new();

    public sealed record Received(string From, IReadOnlyList<string> To, string Data);

    private async Task AcceptAsync()
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(stop.Token);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (ObjectDisposedException)
            {
                return;
            }

            _ = Task.Run(() => ServeAsync(client));
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            await using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII);
            await using var writer = new StreamWriter(stream, Encoding.ASCII) { NewLine = "\r\n", AutoFlush = true };
            await writer.WriteLineAsync("220 sink ESMTP");
            string from = "";
            var to = new List<string>();
            while (await reader.ReadLineAsync() is { } line)
            {
                var verb = line.Length >= 4 ? line[..4].ToUpperInvariant() : line.ToUpperInvariant();
                switch (verb)
                {
                    case "EHLO":
                        await writer.WriteLineAsync("250-sink");
                        await writer.WriteLineAsync("250 8BITMIME");
                        break;
                    case "HELO":
                        await writer.WriteLineAsync("250 sink");
                        break;
                    case "MAIL":
                        from = Address(line);
                        to.Clear();
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "RCPT":
                        to.Add(Address(line));
                        await writer.WriteLineAsync("250 OK");
                        break;
                    case "DATA":
                        await writer.WriteLineAsync("354 End data with <CR><LF>.<CR><LF>");
                        var data = new StringBuilder();
                        while (await reader.ReadLineAsync() is { } body && body != ".")
                        {
                            data.AppendLine(body.StartsWith("..", StringComparison.Ordinal) ? body[1..] : body);
                        }

                        Messages.Enqueue(new Received(from, to.ToList(), data.ToString()));
                        await writer.WriteLineAsync("250 OK queued");
                        break;
                    case "QUIT":
                        await writer.WriteLineAsync("221 Bye");
                        return;
                    default:
                        await writer.WriteLineAsync("250 OK");
                        break;
                }
            }
        }
    }

    private static string Address(string line)
    {
        var start = line.IndexOf('<', StringComparison.Ordinal);
        var end = line.IndexOf('>', StringComparison.Ordinal);
        return start >= 0 && end > start ? line[(start + 1)..end] : line;
    }

    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        listener.Stop();
        try
        {
            await loop;
        }
        catch (OperationCanceledException)
        {
        }

        stop.Dispose();
    }
}
