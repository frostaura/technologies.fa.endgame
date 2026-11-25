using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Npgsql;

namespace Endgame.Ops.Backups;

/// <summary>
/// The PostgreSQL side of a backup: which databases exist, whether one is empty, the lease, and
/// the client tools (<c>pg_dumpall</c>, <c>pg_dump</c>, <c>pg_restore</c>, <c>psql</c>) run with the
/// configured administrator's credentials in their environment — never on a command line.
/// </summary>
public sealed partial class PostgresTools(BackupOptions options)
{
    /// <summary>The advisory lock every backup and restore holds, so two never overlap (the lease).</summary>
    public const long LeaseKey = 0x456E_6467_4F70_7331; // "EndgOps1"

    private NpgsqlConnectionStringBuilder Admin => new(options.Postgres) { Database = "postgres", Pooling = false };

    public string User => Admin.Username ?? "postgres";

    /// <summary>Every database a backup covers: all but the templates and the maintenance database.</summary>
    public async Task<IReadOnlyList<string>> DatabasesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync("postgres", cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate AND datname <> 'postgres' ORDER BY datname", connection);
        var names = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    public async Task<string> ServerVersionAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync("postgres", cancellationToken);
        return connection.PostgreSqlVersion.ToString();
    }

    public async Task<bool> ExistsAsync(string database, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync("postgres", cancellationToken);
        await using var command = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = $1", connection) { Parameters = { new() { Value = database } } };
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
    }

    /// <summary>How many tables, views and sequences a database holds outside the system schemas.</summary>
    public async Task<long> UserObjectCountAsync(string database, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(database, cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
              AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
            """,
            connection);
        return (long)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    /// <summary>Drops a database, disconnecting anyone still in it.</summary>
    public async Task DropAsync(string database, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync("postgres", cancellationToken);
        await using var command = new NpgsqlCommand($"DROP DATABASE IF EXISTS {Quote(database)} WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>Takes the lease, or returns null when another backup or restore holds it.</summary>
    public async Task<IAsyncDisposable?> TryLeaseAsync(CancellationToken cancellationToken)
    {
        var connection = await OpenAsync("postgres", cancellationToken);
        await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock($1)", connection) { Parameters = { new() { Value = LeaseKey } } };
        if ((bool)(await command.ExecuteScalarAsync(cancellationToken))!)
        {
            return connection; // closing the session releases the lock
        }

        await connection.DisposeAsync();
        return null;
    }

    /// <summary>Runs a client tool with stdout to <paramref name="output"/>; throws with its stderr on failure.</summary>
    public async Task RunAsync(string tool, IReadOnlyList<string> arguments, Stream? output, Stream? input, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(tool)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = input is not null,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        var admin = Admin;
        start.Environment["PGHOST"] = admin.Host;
        start.Environment["PGPORT"] = admin.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        start.Environment["PGUSER"] = admin.Username;
        start.Environment["PGPASSWORD"] = admin.Password;
        start.Environment["PGCONNECT_TIMEOUT"] = "10";

        using var process = Process.Start(start) ?? throw new InvalidOperationException($"{tool} could not be started.");
        var stderr = new StringBuilder();
        var errors = Task.Run(async () =>
        {
            string? line;
            while ((line = await process.StandardError.ReadLineAsync(cancellationToken)) is not null)
            {
                if (stderr.Length < 8000)
                {
                    stderr.AppendLine(line);
                }
            }
        }, cancellationToken);
        var feed = input is null
            ? Task.CompletedTask
            : Task.Run(async () =>
            {
                await input.CopyToAsync(process.StandardInput.BaseStream, cancellationToken);
                process.StandardInput.Close();
            }, cancellationToken);
        if (output is not null)
        {
            await process.StandardOutput.BaseStream.CopyToAsync(output, 1 << 16, cancellationToken);
        }
        else
        {
            await process.StandardOutput.BaseStream.CopyToAsync(Stream.Null, cancellationToken);
        }

        await feed;
        await process.WaitForExitAsync(cancellationToken);
        await errors;
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{tool} failed ({process.ExitCode}): {stderr.ToString().Trim()}");
        }
    }

    /// <summary>
    /// Rewrites <c>pg_dumpall --globals-only</c> output so it applies onto a fresh server: every
    /// <c>CREATE ROLE</c> tolerates a role that exists, and the connecting administrator's own role
    /// is left exactly as the new server has it (its password above all).
    /// </summary>
    public static string PrepareGlobals(string globals, string administrator)
    {
        var builder = new StringBuilder();
        var self = new[] { administrator, Quote(administrator) };
        foreach (var raw in globals.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var create = CreateRole().Match(line);
            if (create.Success)
            {
                var role = create.Groups["role"].Value;
                if (self.Contains(role, StringComparer.Ordinal))
                {
                    continue;
                }

                builder.Append("DO $endgame$ BEGIN CREATE ROLE ").Append(role)
                    .Append("; EXCEPTION WHEN duplicate_object THEN NULL; END $endgame$;\n");
                continue;
            }

            var alter = AlterRole().Match(line);
            if (alter.Success && self.Contains(alter.Groups["role"].Value, StringComparer.Ordinal))
            {
                continue;
            }

            builder.Append(line).Append('\n');
        }

        return builder.ToString();
    }

    public static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private async Task<NpgsqlConnection> OpenAsync(string database, CancellationToken cancellationToken)
    {
        var builder = Admin;
        builder.Database = database;
        var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    [GeneratedRegex("^CREATE ROLE (?<role>\"(?:[^\"]|\"\")+\"|[^ ;]+);$")]
    private static partial Regex CreateRole();

    [GeneratedRegex("^ALTER ROLE (?<role>\"(?:[^\"]|\"\")+\"|[^ ;]+) ")]
    private static partial Regex AlterRole();
}
