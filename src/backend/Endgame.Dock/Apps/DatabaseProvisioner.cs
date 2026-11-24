using Endgame.Dock.Api;
using Endgame.Dock.Policy;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Endgame.Dock.Apps;

/// <summary>
/// Gives each app a database and a role of its own on the shared server (ARCH-005): opaque names,
/// a connection cap, <c>CONNECT</c> granted to that role alone, and <c>CONNECT</c> revoked from
/// <c>PUBLIC</c> on every platform database so an app's role reaches nothing else.
/// </summary>
public sealed class DatabaseProvisioner(IOptions<DockOptions> options, OpaqueNames names, ILogger<DatabaseProvisioner> logger)
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public bool Configured => !string.IsNullOrWhiteSpace(options.Value.PostgresAdmin);

    /// <summary>Creates what is missing and returns the connection string the app is given.</summary>
    public async Task<string> EnsureAsync(Guid appId, CancellationToken cancellationToken)
    {
        if (!Configured)
        {
            throw DockProblem.Unavailable("No database server is configured for apps.");
        }

        var database = names.Database(appId);
        var role = names.Role(appId);
        var password = names.Password(appId);
        var limit = Math.Max(1, options.Value.AppConnectionLimit);

        await gate.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await LockDownPlatformAsync(connection, cancellationToken);
            await ExecAsync(connection, $"""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') THEN CREATE ROLE {role}; END IF;
                END $$
                """, cancellationToken);
            await ExecAsync(connection, $"ALTER ROLE {role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT {limit} PASSWORD '{password}'", cancellationToken);
            if (!await ExistsAsync(connection, database, cancellationToken))
            {
                // CREATE DATABASE cannot run inside the DO block's transaction.
                await ExecAsync(connection, $"CREATE DATABASE {database} OWNER {role}", cancellationToken);
                logger.LogInformation("Provisioned a database for app {AppId}.", appId);
            }

            await ExecAsync(connection, $"REVOKE ALL ON DATABASE {database} FROM PUBLIC", cancellationToken);
            await ExecAsync(connection, $"GRANT CONNECT, TEMPORARY ON DATABASE {database} TO {role}", cancellationToken);
        }
        catch (NpgsqlException e)
        {
            throw DockProblem.Unavailable($"The database server refused provisioning: {e.Message}");
        }
        finally
        {
            gate.Release();
        }

        var host = options.Value.Peers.PostgresAlias;
        return $"Host={host};Port=5432;Database={database};Username={role};Password={password};Maximum Pool Size={limit};Timeout=15";
    }

    /// <summary>
    /// A server where a workspace's tests may create and drop databases (PLATFORM-API §1,
    /// <c>ENDGAME_TEST_DATABASE</c>): a role of the run's own with <c>CREATEDB</c> and nothing else,
    /// and a first database to connect to. Removed with the workspace.
    /// </summary>
    public async Task<string> EnsureTestServerAsync(Guid runId, CancellationToken cancellationToken)
    {
        if (!Configured)
        {
            throw DockProblem.Unavailable("No database server is configured for tests.");
        }

        var role = names.TestRole(runId);
        var database = names.TestDatabase(runId);
        var password = names.TestPassword(runId);
        await gate.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            await LockDownPlatformAsync(connection, cancellationToken);
            await ExecAsync(connection, $"""
                DO $$ BEGIN
                  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') THEN CREATE ROLE {role}; END IF;
                END $$
                """, cancellationToken);
            await ExecAsync(connection, $"ALTER ROLE {role} WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20 PASSWORD '{password}'", cancellationToken);
            if (!await ExistsAsync(connection, database, cancellationToken))
            {
                await ExecAsync(connection, $"CREATE DATABASE {database} OWNER {role}", cancellationToken);
            }

            await ExecAsync(connection, $"REVOKE ALL ON DATABASE {database} FROM PUBLIC", cancellationToken);
        }
        catch (NpgsqlException e)
        {
            throw DockProblem.Unavailable($"The database server refused the test role: {e.Message}");
        }
        finally
        {
            gate.Release();
        }

        return $"Host={options.Value.Peers.PostgresAlias};Port=5432;Database={database};Username={role};Password={password};Timeout=15";
    }

    /// <summary>Drops every database the workspace's tests made, its first database and its role.</summary>
    public async Task DropTestServerAsync(Guid runId, CancellationToken cancellationToken)
    {
        if (!Configured)
        {
            return;
        }

        var role = names.TestRole(runId);
        await gate.WaitAsync(cancellationToken);
        try
        {
            await using var connection = await OpenAsync(cancellationToken);
            var owned = new List<string>();
            await using (var list = new NpgsqlCommand("SELECT d.datname FROM pg_database d JOIN pg_roles r ON d.datdba = r.oid WHERE r.rolname = @role", connection))
            {
                list.Parameters.AddWithValue("role", role);
                await using var reader = await list.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    owned.Add(reader.GetString(0));
                }
            }

            foreach (var database in owned)
            {
                await ExecAsync(connection, $"DROP DATABASE IF EXISTS {QuoteIdentifier(database)} WITH (FORCE)", cancellationToken);
            }

            await ExecAsync(connection, $"DROP ROLE IF EXISTS {role}", cancellationToken);
        }
        catch (NpgsqlException e)
        {
            logger.LogWarning("Could not remove the test role of run {RunId}: {Message}", runId, e.Message);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Revokes <c>CONNECT</c> from <c>PUBLIC</c> on every database that is not an app's.</summary>
    public async Task LockDownPlatformAsync(CancellationToken cancellationToken)
    {
        if (!Configured)
        {
            return;
        }

        await using var connection = await OpenAsync(cancellationToken);
        await LockDownPlatformAsync(connection, cancellationToken);
    }

    private static async Task LockDownPlatformAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        var platform = new List<string>();
        await using (var list = new NpgsqlCommand("SELECT datname FROM pg_database WHERE datname <> 'template0'", connection))
        await using (var reader = await list.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var name = reader.GetString(0);
                if (!OpaqueNames.IsAppDatabase(name))
                {
                    platform.Add(name);
                }
            }
        }

        // Every role that is not an app's keeps its access by an explicit grant first — the
        // control plane's own roles (endgame_app, endgame_system) connect through PUBLIC otherwise.
        var platformRoles = new List<string>();
        await using (var roles = new NpgsqlCommand("SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%'", connection))
        await using (var reader = await roles.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var role = reader.GetString(0);
                if (!OpaqueNames.IsAppRole(role))
                {
                    platformRoles.Add(role);
                }
            }
        }

        foreach (var name in platform)
        {
            foreach (var role in platformRoles)
            {
                await ExecAsync(connection, $"GRANT CONNECT ON DATABASE {QuoteIdentifier(name)} TO {QuoteIdentifier(role)}", cancellationToken);
            }

            await ExecAsync(connection, $"REVOKE CONNECT ON DATABASE {QuoteIdentifier(name)} FROM PUBLIC", cancellationToken);
        }
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new NpgsqlConnection(options.Value.PostgresAdmin);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static async Task<bool> ExistsAsync(NpgsqlConnection connection, string database, CancellationToken cancellationToken)
    {
        await using var check = new NpgsqlCommand("SELECT 1 FROM pg_database WHERE datname = @name", connection);
        check.Parameters.AddWithValue("name", database);
        return await check.ExecuteScalarAsync(cancellationToken) is not null;
    }

    private static async Task ExecAsync(NpgsqlConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string QuoteIdentifier(string name) => "\"" + name.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}

/// <summary>
/// Locks the platform databases down once the server answers after Dock starts, and again every
/// half minute, so a role the control plane's migrations create later is granted its access.
/// </summary>
public sealed class PlatformDatabaseLockdown(DatabaseProvisioner provisioner, ILogger<PlatformDatabaseLockdown> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (var attempt = 1; !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                await provisioner.LockDownPlatformAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                if (attempt % 20 == 1)
                {
                    logger.LogWarning("Locking the platform databases down failed: {Message}", e.Message);
                }

                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
        }
    }
}
