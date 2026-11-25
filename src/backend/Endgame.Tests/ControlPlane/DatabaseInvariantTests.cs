using System.Net.Http.Json;
using Endgame.Application.Gateway;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// What the database itself guarantees, checked by talking to it directly: tenancy by row-level
/// security, composite foreign keys, constrained statuses, append-only logs, and admission under lock.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DatabaseInvariantTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private Guid frostaura;
    private Guid other;
    private Guid frostauraDivision;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        var owner = await app.OwnerWithOrganisationAsync();
        frostaura = Guid.Parse((await ControlPlaneApp.Ok(owner.GetAsync("/api/me")))["organisation"]!["id"]!.GetValue<string>());
        frostauraDivision = await owner.DivisionAsync("frostaura", "technologies");
        var provisioned = await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = Provisioning.Description, screening = Provisioning.Manual }));
        other = Guid.Parse(provisioned["id"]!.GetValue<string>());
        Assert.NotNull(provisioned["ownerInvitationCode"]);
        await owner.TopUpAsync("frostaura", 10m);
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    private async Task<NpgsqlConnection> AsAsync(string role, Guid? organisation)
    {
        var connection = new NpgsqlConnection(app.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"SET ROLE {role}; SELECT set_config('endgame.organisation_id', @org, false);", connection);
        command.Parameters.AddWithValue("org", organisation?.ToString() ?? "");
        await command.ExecuteNonQueryAsync();
        return connection;
    }

    private static async Task<long> CountAsync(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    [Fact]
    public async Task Row_level_security_admits_only_the_sessions_organisation()
    {
        await using var asFrostaura = await AsAsync(TenantSession.AppRole, frostaura);
        Assert.Equal(1, await CountAsync(asFrostaura, "SELECT count(*) FROM organisations"));
        Assert.Equal(1, await CountAsync(asFrostaura, "SELECT count(*) FROM memberships"));
        Assert.Equal(1, await CountAsync(asFrostaura, "SELECT count(*) FROM credit_entries"));

        await using var asOther = await AsAsync(TenantSession.AppRole, other);
        Assert.Equal(0, await CountAsync(asOther, "SELECT count(*) FROM divisions"));
        Assert.Equal(0, await CountAsync(asOther, "SELECT count(*) FROM credit_entries"));

        await using var asNobody = await AsAsync(TenantSession.AppRole, null);
        Assert.Equal(0, await CountAsync(asNobody, "SELECT count(*) FROM organisations"));

        // Writing into another organisation is refused by the policy's check.
        await using var insert = new NpgsqlCommand(
            "INSERT INTO divisions (id, organisation_id, name, slug, status, created_at) VALUES (gen_random_uuid(), @org, 'Sneaky', 'sneaky', 'active', now())", asOther);
        insert.Parameters.AddWithValue("org", frostaura);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, refused.SqlState);

        await using var platform = await AsAsync(TenantSession.SystemRole, null);
        Assert.Equal(2, await CountAsync(platform, "SELECT count(*) FROM organisations"));
    }

    [Fact]
    public async Task A_row_cannot_point_into_another_organisations_tree()
    {
        await using var platform = await AsAsync(TenantSession.SystemRole, null);
        await using var insert = new NpgsqlCommand(
            "INSERT INTO projects (id, organisation_id, division_id, name, slug, status, created_at) VALUES (gen_random_uuid(), @other, @division, 'Cross', 'cross', 'active', now())", platform);
        insert.Parameters.AddWithValue("other", other);
        insert.Parameters.AddWithValue("division", frostauraDivision);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, refused.SqlState);
    }

    [Theory]
    [InlineData("UPDATE divisions SET status = 'sleeping'")]
    [InlineData("UPDATE runs SET status = 'done'")]
    [InlineData("UPDATE divisions SET slug = 'Not A Slug'")]
    public async Task Statuses_and_slugs_are_constrained_by_the_database(string sql)
    {
        await using var platform = await AsAsync(TenantSession.SystemRole, null);
        await using (var seed = new NpgsqlCommand("INSERT INTO runs (id, organisation_id, kind, status, title, last_seq, created_at) VALUES (gen_random_uuid(), @org, 'task', 'queued', 't', 0, now())", platform))
        {
            seed.Parameters.AddWithValue("org", frostaura);
            await seed.ExecuteNonQueryAsync();
        }

        await using var command = new NpgsqlCommand(sql, platform);
        var refused = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.CheckViolation, refused.SqlState);
    }

    [Theory]
    [InlineData("UPDATE credit_entries SET amount = 0")]
    [InlineData("DELETE FROM credit_entries")]
    [InlineData("TRUNCATE credit_entries CASCADE")]
    [InlineData("DELETE FROM run_events")]
    public async Task The_ledger_and_the_run_log_are_append_only_even_for_the_owner_of_the_tables(string sql)
    {
        await using var asApp = await AsAsync(TenantSession.AppRole, frostaura);
        await using (var command = new NpgsqlCommand(sql, asApp))
        {
            var refused = await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
            Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, refused.SqlState);
        }

        // The migrating role is a superuser here: grants do not bind it, the trigger does.
        await using var owner = new NpgsqlConnection(app.ConnectionString);
        await owner.OpenAsync();
        await using var asOwner = new NpgsqlCommand(sql, owner);
        var stopped = await Assert.ThrowsAsync<PostgresException>(() => asOwner.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, stopped.SqlState);
        Assert.Contains("append-only", stopped.MessageText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Forty_concurrent_admissions_against_a_budget_that_fits_thirteen_admit_exactly_thirteen()
    {
        const int calls = 40;
        const int fits = 13;
        const decimal each = 0.07m;
        await using (var scope = app.Scope())
        {
            var resolved = await scope.ServiceProvider.GetRequiredService<ScopeResolver>().RequireAsync("frostaura/technologies", CancellationToken.None);
            var cascade = scope.ServiceProvider.GetRequiredService<Endgame.Infrastructure.Cascade.CascadeService>();
            await cascade.SetAsync(resolved, Endgame.Domain.Cascade.CascadeKind.Budget, "monthly_credits", System.Text.Json.Nodes.JsonValue.Create((each * fits) + 0.01m), Guid.NewGuid(), Endgame.Domain.Platform.Actor.Member, CancellationToken.None);
        }

        using var start = new ManualResetEventSlim(false);
        var attempts = Enumerable.Range(0, calls).Select(_ => Task.Run(async () =>
        {
            start.Wait();
            await using var scope = app.Scope();
            var ledger = scope.ServiceProvider.GetRequiredService<CreditLedger>();
            var attribution = new Attribution(frostaura, frostauraDivision, null, null, null, null, "frostaura/technologies", null);
            return await ledger.AdmitAsync(new ReservationRequest(attribution, "chat", "m", each, 0.0007m, true, DateTimeOffset.UtcNow.AddMinutes(5), null), CancellationToken.None);
        })).ToList();
        start.Set();
        var results = await Task.WhenAll(attempts);
        Assert.Equal(fits, results.Count(r => r is Admitted));
        Assert.Equal(calls - fits, results.Count(r => r is Refused));

        await using var asApp = await AsAsync(TenantSession.AppRole, frostaura);
        Assert.Equal(fits, await CountAsync(asApp, "SELECT count(*) FROM credit_entries WHERE kind = 'reservation'"));
    }
}
