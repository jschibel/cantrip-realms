using System.Collections.Concurrent;

namespace Cantrip.Realms.Server.Reports;

/// <summary>
/// The server's log lately, kept in memory beside wherever else it goes, so a playtest report (<see cref="PlayReports"/>)
/// carries what the server said around the moment it was filed: the realm's own lines from Information up, everyone
/// else's (ASP.NET Core, EF Core) from Warning up, the last <see cref="Kept"/> of them. A logger provider like any other,
/// so the configured levels (<c>Logging__LogLevel__*</c>) still decide first.
/// </summary>
public sealed class RecentLog(TimeProvider time) : ILoggerProvider
{
    /// <summary>How many lines are kept: the oldest goes as a new one comes past this.</summary>
    public const int Kept = 400;

    private readonly ConcurrentQueue<(DateTimeOffset At, string Line)> _lines = new();

    /// <summary>The lines logged since <paramref name="since"/>, oldest first.</summary>
    public IReadOnlyList<string> Since(DateTimeOffset since) => [.. _lines.Where(entry => entry.At >= since).Select(entry => entry.Line)];

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public void Dispose()
    {
    }

    private void Add(LogLevel level, string category, string text)
    {
        DateTimeOffset now = time.GetUtcNow();
        _lines.Enqueue((now, $"{now:yyyy-MM-ddTHH:mm:ss.fffZ} {Short(level)} {category}: {text}"));
        while (_lines.Count > Kept && _lines.TryDequeue(out _))
        {
        }
    }

    private static string Short(LogLevel level) => level switch
    {
        LogLevel.Trace => "trace",
        LogLevel.Debug => "debug",
        LogLevel.Information => "info",
        LogLevel.Warning => "warn",
        LogLevel.Error => "error",
        LogLevel.Critical => "crit",
        _ => level.ToString(),
    };

    private sealed class Logger(RecentLog log, string category) : ILogger
    {
        private readonly LogLevel _least = category.StartsWith("Cantrip", StringComparison.Ordinal) ? LogLevel.Information : LogLevel.Warning;

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= _least && logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            string text = formatter(state, exception);
            log.Add(logLevel, category, exception is null ? text : $"{text}\n{exception}");
        }
    }
}
