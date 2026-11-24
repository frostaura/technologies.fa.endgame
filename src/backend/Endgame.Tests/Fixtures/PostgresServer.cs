using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using Npgsql;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// A throwaway PostgreSQL for the integration tests — never the compose stack's database. With
/// <c>ENDGAME_TEST_POSTGRES</c> set (an admin connection string to a server you started), databases
/// are created there; otherwise a <c>postgres:16.16-alpine</c> container is started on a free
/// loopback port through the docker CLI and removed afterwards. Each test class gets its own
/// uniquely named database. The CLI keeps the Docker client library out of this process, as the
/// architecture tests require.
/// </summary>
public sealed class PostgresServer : IAsyncLifetime
{
    public const string Image = "postgres:16.16-alpine";
    private const string Password = "endgame-tests";

    private string? container;

    public string AdminConnectionString { get; private set; } = "";

    public async Task InitializeAsync()
    {
        if (Environment.GetEnvironmentVariable("ENDGAME_TEST_POSTGRES") is { Length: > 0 } given)
        {
            AdminConnectionString = given;
            return;
        }

        var port = FreePort();
        container = $"endgame-test-pg-{Guid.NewGuid():N}"[..32];
        await Docker($"run -d --rm --name {container} --label endgame-tests=1 -e POSTGRES_PASSWORD={Password} -p 127.0.0.1:{port}:5432 {Image} -c max_connections=300");
        AdminConnectionString = $"Host=127.0.0.1;Port={port};Database=postgres;Username=postgres;Password={Password};Pooling=false;Timeout=5";
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (true)
        {
            try
            {
                await using var connection = new NpgsqlConnection(AdminConnectionString);
                await connection.OpenAsync();
                await using var command = new NpgsqlCommand("SELECT 1", connection);
                await command.ExecuteScalarAsync();
                return;
            }
            catch (Exception) when (DateTime.UtcNow < deadline)
            {
                await Task.Delay(500);
            }
        }
    }

    public async Task DisposeAsync()
    {
        if (container is not null)
        {
            await Docker($"rm -f {container}");
        }
    }

    /// <summary>A new, empty database; returns its connection string.</summary>
    public async Task<string> CreateDatabaseAsync()
    {
        var name = $"endgame_test_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(AdminConnectionString))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE {name}", connection);
            await command.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(AdminConnectionString) { Database = name, Pooling = true, MaxPoolSize = 100 }.ConnectionString;
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static async Task Docker(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo("docker", arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        }) ?? throw new InvalidOperationException("docker could not be started.");
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"docker {arguments.Split(' ')[0]} failed: {error}");
        }
    }
}

[CollectionDefinition(Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresServer>
{
    public const string Name = "postgres";
}
