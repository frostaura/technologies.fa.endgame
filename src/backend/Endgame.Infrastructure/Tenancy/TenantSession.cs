using System.Data;
using System.Data.Common;
using Endgame.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Endgame.Infrastructure.Tenancy;

/// <summary>How the current unit of work reaches the database.</summary>
public enum TenantMode
{
    /// <summary>No organisation: tenant tables return nothing. Global tables (people, keys) are readable.</summary>
    None,

    /// <summary>One organisation: row-level security admits only its rows.</summary>
    Organisation,

    /// <summary>
    /// The platform itself, across organisations: the edge's routing table, lease sweeps, resolving a
    /// scope's organisation before it is known. Uses a role that bypasses row-level security.
    /// </summary>
    System,
}

/// <summary>
/// Which organisation the current request works in. Every connection the platform opens runs as a
/// role subject to row-level security, with the organisation in a session setting the policies read.
/// The setting is applied when a connection opens and again before any command whenever the session
/// changed since it was last applied — inside a transaction too — so application checks are never the
/// only fence, and a switch can never be forgotten.
/// </summary>
public sealed class TenantSession
{
    public const string AppRole = "endgame_app";
    public const string SystemRole = "endgame_system";
    public const string OrganisationSetting = "endgame.organisation_id";

    private int version;
    private int appliedVersion = -1;

    public TenantMode Mode { get; private set; } = TenantMode.None;

    public Guid? OrganisationId { get; private set; }

    public void UseOrganisation(Guid organisationId)
    {
        if (Mode == TenantMode.Organisation && OrganisationId == organisationId)
        {
            return;
        }

        Mode = TenantMode.Organisation;
        OrganisationId = organisationId;
        version++;
    }

    public void UseSystem()
    {
        if (Mode == TenantMode.System)
        {
            return;
        }

        Mode = TenantMode.System;
        OrganisationId = null;
        version++;
    }

    public void Clear()
    {
        if (Mode == TenantMode.None)
        {
            return;
        }

        Mode = TenantMode.None;
        OrganisationId = null;
        version++;
    }

    /// <summary>Applies the session now to the context's connection, if it is open.</summary>
    public async Task ApplyAsync(EndgameDbContext db, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        var connection = db.Database.GetDbConnection();
        if (connection.State == ConnectionState.Open)
        {
            await ApplyAsync(connection, cancellationToken);
        }
    }

    internal async Task EnsureAppliedAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        if (appliedVersion != version)
        {
            await ApplyAsync(connection, cancellationToken);
        }
    }

    internal void EnsureApplied(DbConnection connection)
    {
        if (appliedVersion != version)
        {
            ApplyAsync(connection, CancellationToken.None).GetAwaiter().GetResult();
        }
    }

    internal async Task ApplyAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        var role = Mode == TenantMode.System ? SystemRole : AppRole;
        command.CommandText = $"SET ROLE {role}; SELECT set_config('{OrganisationSetting}', @org, false);";
        var parameter = command.CreateParameter();
        parameter.ParameterName = "org";
        parameter.Value = OrganisationId?.ToString() ?? "";
        command.Parameters.Add(parameter);
        // Npgsql enlists the command in the connection's open transaction, if there is one.
        await command.ExecuteNonQueryAsync(cancellationToken);
        appliedVersion = version;
    }
}

/// <summary>Applies the tenant session when a connection opens, and before any command if it changed since.</summary>
public sealed class TenantConnectionInterceptor(TenantSession session) : DbConnectionInterceptor
{
    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default) =>
        await session.ApplyAsync(connection, cancellationToken);

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData) =>
        session.ApplyAsync(connection, CancellationToken.None).GetAwaiter().GetResult();
}

public sealed class TenantCommandInterceptor(TenantSession session) : DbCommandInterceptor
{
    public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
    {
        await session.EnsureAppliedAsync(command.Connection!, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        await session.EnsureAppliedAsync(command.Connection!, cancellationToken);
        return result;
    }

    public override async ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
    {
        await session.EnsureAppliedAsync(command.Connection!, cancellationToken);
        return result;
    }

    public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
    {
        session.EnsureApplied(command.Connection!);
        return result;
    }

    public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result)
    {
        session.EnsureApplied(command.Connection!);
        return result;
    }

    public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result)
    {
        session.EnsureApplied(command.Connection!);
        return result;
    }
}
