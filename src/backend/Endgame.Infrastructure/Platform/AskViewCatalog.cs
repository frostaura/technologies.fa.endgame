using System.Text;
using Endgame.Application.Common;
using Endgame.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Infrastructure.Platform;

public sealed record AskColumn(string Name, string Type);

public sealed record AskView(string Name, IReadOnlyList<AskColumn> Columns);

/// <summary>
/// The <c>ask</c> views exactly as the database has them, so the model writing a query is told the
/// real columns and types and the prompt can never drift from the migration that made them
/// (ARCH-004, <i>Ask about this app</i>). They are read once per process from <c>pg_catalog</c>,
/// which every role can read whatever its privileges (<c>information_schema</c> hides the columns a
/// role may not select), and kept. Only the plain hint per view — what it holds — is written here,
/// keyed by view name; every column list and type comes from the catalog.
/// </summary>
public sealed class AskViewCatalog(IServiceScopeFactory scopes)
{
    /// <summary>What each view holds, in a line. A hint for a view the database does not have is a defect (<see cref="Prompt"/> refuses it).</summary>
    public static readonly IReadOnlyDictionary<string, string> Hints = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["requests"] = "every request the app's server answered (pages, API calls and files), health checks excluded; latency is duration_ms; failed is a server error",
        ["errors"] = "failed requests (source 'request') and error logs (source 'log')",
        ["events"] = "custom events the app recorded, e.g. note.created; properties ->> 'key' reads a property",
        ["metrics"] = "metric data points (type gauge, sum or histogram)",
    };

    private const string ColumnsSql = """
        SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, NULL)
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'ask' AND c.relkind = 'v' AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
        """;

    private readonly SemaphoreSlim gate = new(1, 1);
    private IReadOnlyList<AskView>? views;

    /// <summary>The views the guard lets a query read, with their columns in order. Read once; a failed or empty read is not kept.</summary>
    public async Task<IReadOnlyList<AskView>> ViewsAsync(CancellationToken cancellationToken)
    {
        if (views is { } known)
        {
            return known;
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            if (views is { } raced)
            {
                return raced;
            }

            await using var scope = scopes.CreateAsyncScope();
            var connectionString = scope.ServiceProvider.GetRequiredService<EndgameDbContext>().Database.GetConnectionString()
                ?? throw new InvalidOperationException("No connection string.");
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new NpgsqlCommand(ColumnsSql, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var columns = new Dictionary<string, List<AskColumn>>(StringComparer.Ordinal);
            while (await reader.ReadAsync(cancellationToken))
            {
                var view = reader.GetString(0);
                if (!TelemetrySqlGuard.Views.Contains(view))
                {
                    continue;
                }

                if (!columns.TryGetValue(view, out var list))
                {
                    columns[view] = list = [];
                }

                list.Add(new AskColumn(reader.GetString(1), reader.GetString(2)));
            }

            if (columns.Count == 0)
            {
                throw new EndgameProblem(503, "ask_unavailable", "Questions about apps cannot be answered yet",
                    "The database has none of the telemetry views a question is answered from.");
            }

            views = columns.OrderBy(c => c.Key, StringComparer.Ordinal).Select(c => new AskView(c.Key, c.Value)).ToList();
            return views;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// The part of the query-writing prompt that says what can be read: each view with its columns and
    /// types as the catalog gave them, its hint, and how to count. Throws when a hint names a view that
    /// is not among <paramref name="views"/>.
    /// </summary>
    public static string Prompt(IReadOnlyList<AskView> views)
    {
        ArgumentNullException.ThrowIfNull(views);
        var byName = views.ToDictionary(v => v.Name, StringComparer.Ordinal);
        var orphans = Hints.Keys.Where(k => !byName.ContainsKey(k)).Order(StringComparer.Ordinal).ToList();
        if (orphans.Count > 0)
        {
            throw new InvalidOperationException($"A hint names a view the database does not have: {string.Join(", ", orphans)}.");
        }

        var text = new StringBuilder();
        text.AppendLine("The views you can read, exactly as the database has them: every column there is, with its type. There are no other columns and no other tables. Times are UTC.");
        foreach (var view in views)
        {
            text.Append(view.Name).Append('(').AppendJoin(", ", view.Columns.Select(c => $"{c.Name} {c.Type}")).AppendLine(")");
            if (Hints.TryGetValue(view.Name, out var hint))
            {
                text.Append("  -- ").AppendLine(hint);
            }
        }

        text.AppendLine("There is no id column in any view. Count rows with count(*), and only some of them with count(*) FILTER (WHERE ...).");
        if (byName.TryGetValue("requests", out var requests) && requests.Columns.Any(c => c.Name == "visit"))
        {
            text.AppendLine("A visit is a page someone opened (not an API call, a file, a health check or a callback): \"visits\" is count(*) FILTER (WHERE visit) over requests, "
                            + "the same number the app's page shows. \"Requests\" is every row of requests.");
        }

        text.AppendLine("\"Today\" is at >= date_trunc('day', now()); \"by hour\" groups by date_trunc('hour', at); \"this week\" is at >= now() - interval '7 days'.");
        text.AppendLine("Rules: one SELECT (WITH is allowed), only these views, no comments, no semicolons, no quoted identifiers.");
        text.Append("Functions (no others): ").AppendJoin(", ", TelemetrySqlGuard.Functions.Order(StringComparer.Ordinal)).AppendLine(".");
        text.AppendLine("percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) is the 95th percentile. Cast with ::numeric, ::int, ::bigint, ::text, ::date, ::timestamptz.");
        return text.ToString();
    }
}
