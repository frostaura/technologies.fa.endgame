using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Endgame.Tests.Fixtures;

/// <summary>Keeps every log entry the app writes, for tests that hold what is logged and how loudly.</summary>
public sealed class LogSink : ILoggerProvider
{
    public sealed record Entry(string Category, LogLevel Level, int EventId, string Message, Exception? Exception);

    public ConcurrentQueue<Entry> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public void Dispose()
    {
    }

    private sealed class Logger(LogSink sink, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            sink.Entries.Enqueue(new Entry(category, logLevel, eventId.Id, formatter(state, exception), exception));
        }
    }
}
