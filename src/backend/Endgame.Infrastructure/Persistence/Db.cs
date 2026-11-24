using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace Endgame.Infrastructure.Persistence;

/// <summary>
/// Raw SQL on the context's own connection, for the statements whose atomicity is the point — a
/// conditional claim, a gapless sequence, an admission under lock. The connection opens through EF,
/// so the tenant interceptor has already set its role and organisation.
/// </summary>
internal static class Db
{
    public static async Task<NpgsqlCommand> CommandAsync(this EndgameDbContext db, string sql, CancellationToken cancellationToken, params NpgsqlParameter[] parameters)
    {
        await db.Database.OpenConnectionAsync(cancellationToken);
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (db.Tenant is { } tenant)
        {
            await tenant.EnsureAppliedAsync(connection, cancellationToken);
        }

        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddRange(parameters);
        return command;
    }

    public static NpgsqlParameter P(string name, Guid? value) => new(name, NpgsqlDbType.Uuid) { Value = (object?)value ?? DBNull.Value };

    public static NpgsqlParameter P(string name, string? value) => new(name, NpgsqlDbType.Text) { Value = (object?)value ?? DBNull.Value };

    public static NpgsqlParameter P(string name, decimal? value) => new(name, NpgsqlDbType.Numeric) { Value = (object?)value ?? DBNull.Value };

    public static NpgsqlParameter P(string name, long value) => new(name, NpgsqlDbType.Bigint) { Value = value };

    public static NpgsqlParameter P(string name, bool value) => new(name, NpgsqlDbType.Boolean) { Value = value };

    public static NpgsqlParameter P(string name, DateTimeOffset? value) => new(name, NpgsqlDbType.TimestampTz) { Value = (object?)value?.ToUniversalTime() ?? DBNull.Value };

    public static NpgsqlParameter Json(string name, string value) => new(name, NpgsqlDbType.Jsonb) { Value = value };

    public static NpgsqlParameter Texts(string name, IEnumerable<string> values) => new(name, NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = values.ToArray() };

    public static Guid? GuidOrNull(this NpgsqlDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetGuid(ordinal);
    }

    public static string? TextOrNull(this NpgsqlDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    public static DateTimeOffset? TimeOrNull(this NpgsqlDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetFieldValue<DateTimeOffset>(ordinal);
    }

    /// <summary>Serialises every transaction that decides something for one organisation.</summary>
    public static async Task LockOrganisationAsync(this EndgameDbContext db, Guid organisationId, CancellationToken cancellationToken)
    {
        await using var command = await db.CommandAsync("SELECT pg_advisory_xact_lock(hashtextextended(@org::text, 7001))", cancellationToken, P("org", organisationId));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
