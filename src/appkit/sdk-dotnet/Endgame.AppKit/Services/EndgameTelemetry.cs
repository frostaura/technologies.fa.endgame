using System.Threading.Channels;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Endgame.AppKit;

/// <summary>Queues events and sends them in batches, so tracking never slows a request.</summary>
internal sealed partial class EndgameTelemetry(PlatformClient platform, ILogger<EndgameTelemetry> logger, TimeProvider clock)
    : BackgroundService, IEndgameTelemetry
{
    private const int BatchSize = 100;
    private static readonly TimeSpan FlushEvery = TimeSpan.FromSeconds(1);

    private readonly Channel<TelemetryEvent> _queue = Channel.CreateBounded<TelemetryEvent>(
        new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public void Track(string name, IReadOnlyDictionary<string, object?>? properties = null, string? userId = null)
    {
        Names.RequireEventName(name);
        _queue.Writer.TryWrite(new TelemetryEvent(name, clock.GetUtcNow(), properties, userId));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<TelemetryEvent>(BatchSize);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _queue.Reader.WaitToReadAsync(stoppingToken);
                using var window = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                window.CancelAfter(FlushEvery);
                while (batch.Count < BatchSize)
                {
                    if (_queue.Reader.TryRead(out var e))
                    {
                        batch.Add(e);
                        continue;
                    }

                    try
                    {
                        await _queue.Reader.WaitToReadAsync(window.Token);
                    }
                    catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
                    {
                        break;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }

            await SendAsync(batch, CancellationToken.None);
        }

        // Shutting down: send what is left.
        while (_queue.Reader.TryRead(out var e))
        {
            batch.Add(e);
        }

        await SendAsync(batch, CancellationToken.None);
    }

    private async Task SendAsync(List<TelemetryEvent> batch, CancellationToken ct)
    {
        if (batch.Count == 0)
        {
            return;
        }

        try
        {
            await platform.SendAsync(HttpMethod.Post, "platform/v1/telemetry/events", new { events = batch }, ct);
        }
        catch (EndgamePlatformException e)
        {
            LogDropped(logger, batch.Count, e.Message);
        }

        batch.Clear();
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Endgame telemetry: {Count} custom event(s) could not be sent and were dropped: {Reason}")]
    private static partial void LogDropped(ILogger logger, int count, string reason);
}
