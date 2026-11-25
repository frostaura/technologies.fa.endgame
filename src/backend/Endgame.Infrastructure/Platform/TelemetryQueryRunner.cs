using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.Infrastructure.Platform;

/// <summary>Bound from <c>Ask</c>: the fences around a dashboard query, and the model route that writes it.</summary>
public sealed class AskOptions
{
    public const string SectionName = "Ask";

    /// <summary>The routing table's task type for writing and explaining a query.</summary>
    public string TaskType { get; set; } = "ask";

    public int StatementTimeoutMs { get; set; } = 3000;

    public int MaxRows { get; set; } = 500;

    /// <summary>How many rows the model sees when it explains the result.</summary>
    public int RowsForAnswer { get; set; } = 50;

    public int MaxSavedQuestions { get; set; } = 30;
}

public sealed record QueryResult(IReadOnlyList<string> Columns, IReadOnlyList<JsonObject> Rows, bool Truncated);

/// <summary>
/// Runs one guarded query over one app's telemetry views (ARCH-004, <i>Ask about this app</i>). The
/// text has already passed <see cref="TelemetrySqlGuard"/>; here it runs in a read-only transaction as
/// <c>endgame_ask</c> — a role that can read only the four <c>ask.*</c> views and their telemetry
/// tables — with the organisation and the app pinned by transaction-local settings that row-level
/// security reads, a statement timeout, and at most <see cref="AskOptions.MaxRows"/> rows.
/// </summary>
public sealed class TelemetryQueryRunner(EndgameDbContext db, IOptions<AskOptions> options)
{
    public const string AskRole = "endgame_ask";
    public const string AppSetting = "endgame.ask_app_id";

    public async Task<QueryResult> RunAsync(Guid organisationId, Guid appId, string guardedSql, CancellationToken cancellationToken)
    {
        var o = options.Value;
        var connectionString = db.Database.GetConnectionString() ?? throw new InvalidOperationException("No connection string.");
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, cancellationToken);
        await using (var setup = new NpgsqlCommand($"""
            SET TRANSACTION READ ONLY;
            SELECT set_config('endgame.organisation_id', @org, true), set_config('{AppSetting}', @app, true);
            SET LOCAL statement_timeout = {Math.Clamp(o.StatementTimeoutMs, 100, 30_000)};
            SET LOCAL search_path = ask;
            SET LOCAL ROLE {AskRole};
            """, connection, transaction))
        {
            setup.Parameters.AddWithValue("org", organisationId.ToString());
            setup.Parameters.AddWithValue("app", appId.ToString());
            await setup.ExecuteNonQueryAsync(cancellationToken);
        }

        var limit = Math.Clamp(o.MaxRows, 1, 5000);
        var columns = new List<string>();
        var rows = new List<JsonObject>();
        var truncated = false;
        try
        {
            await using var command = new NpgsqlCommand($"SELECT * FROM ({guardedSql}) AS answer LIMIT {limit + 1}", connection, transaction);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            for (var c = 0; c < reader.FieldCount; c++)
            {
                columns.Add(reader.GetName(c));
            }

            while (await reader.ReadAsync(cancellationToken))
            {
                if (rows.Count == limit)
                {
                    truncated = true;
                    break;
                }

                var row = new JsonObject();
                for (var c = 0; c < reader.FieldCount; c++)
                {
                    row[columns[c]] = reader.IsDBNull(c) ? null : Value(reader.GetValue(c), reader.GetDataTypeName(c));
                }

                rows.Add(row);
            }
        }
        catch (PostgresException ex)
        {
            throw ex.SqlState switch
            {
                PostgresErrorCodes.QueryCanceled => new EndgameProblem(422, "query_timeout", "The question took too long to answer",
                    "The query ran past its time limit. Ask about a shorter period, or something simpler."),
                PostgresErrorCodes.InsufficientPrivilege => new EndgameProblem(422, "query_refused", "The query reads something it may not",
                    "Only the app's own telemetry views can be read."),
                // The database's own words (and its hint, when it gives one): what the model repairs from.
                _ => new EndgameProblem(422, "query_failed", "The query could not run", string.IsNullOrWhiteSpace(ex.Hint) ? ex.MessageText : $"{ex.MessageText} ({ex.Hint})"),
            };
        }
        finally
        {
            await transaction.RollbackAsync(CancellationToken.None);
        }

        return new QueryResult(columns, rows, truncated);
    }

    private static JsonNode? Value(object value, string type) => value switch
    {
        DateTime dt => JsonValue.Create(new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc))),
        DateTimeOffset dto => JsonValue.Create(dto),
        bool b => JsonValue.Create(b),
        short or int or long => JsonValue.Create(Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture)),
        decimal d => JsonValue.Create(d),
        double d => double.IsFinite(d) ? JsonValue.Create(d) : null,
        float f => float.IsFinite(f) ? JsonValue.Create((double)f) : null,
        string s when type is "jsonb" or "json" => JsonNode.Parse(s),
        string s => JsonValue.Create(s),
        TimeSpan ts => JsonValue.Create(ts.TotalSeconds),
        _ => JsonValue.Create(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture)),
    };
}
