using Npgsql;

namespace Endgame.AppKit.Testing;

/// <summary>
/// A throwaway PostgreSQL database on the server named by <c>ENDGAME_TEST_DATABASE</c>: created
/// with a random name, dropped (with its connections) on dispose. One per test class keeps tests
/// from seeing each other's rows.
/// </summary>
public sealed class TestDatabase : IAsyncDisposable
{
    /// <summary>The variable naming the PostgreSQL server tests may create and drop databases on.</summary>
    public const string Variable = "ENDGAME_TEST_DATABASE";

    private TestDatabase(string connectionString, string name)
    {
        ConnectionString = connectionString;
        Name = name;
    }

    /// <summary>Connection string to the new database.</summary>
    public string ConnectionString { get; }

    /// <summary>The database's name.</summary>
    public string Name { get; }

    /// <summary>Creates a fresh, empty database.</summary>
    public static TestDatabase Create()
    {
        var server = new NpgsqlConnectionStringBuilder(ServerConnection());
        var name = "test_" + Guid.NewGuid().ToString("N")[..16];
        using (var connection = new NpgsqlConnection(server.ConnectionString))
        {
            connection.Open();
            using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
            command.ExecuteNonQuery();
        }

        server.Database = name;
        return new TestDatabase(server.ConnectionString, name);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(ServerConnection());
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{Name}\" WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string ServerConnection() =>
        Environment.GetEnvironmentVariable(Variable) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException(
                $"{Variable} is not set. It must be a PostgreSQL connection string to a server where the tests may create and " +
                "drop databases, e.g. Host=127.0.0.1;Port=55432;Username=postgres;Password=…. `make test` sets it; in an " +
                "Endgame workspace the platform does.");
}
