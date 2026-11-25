using System.Net.Http.Json;
using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The final defects lane's control-plane fixes, each held on the real control plane and a real
/// PostgreSQL: God mode logs one entry per visit, not per read.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class FinalDefectsTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task Entering_an_organisation_and_then_reading_it_is_one_logged_entry()
    {
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var dean = await app.SignInAsync("dean@frostaura.net");

        // The console enters, then opens the org chart, whose page fires several reads at once.
        await ControlPlaneApp.Ok(dean.PostAsync("/api/operator/organisations/acme/enter", null));
        await ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"));
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme")))
            .Append(ControlPlaneApp.Ok(dean.GetAsync("/api/credits?scope=acme"))));

        var ceo = await app.SignInAsync("ceo@acme.example");
        var entries = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray()
            .Where(e => e!["action"]!.GetValue<string>() == "organisation.entered").ToList();
        Assert.Single(entries);
    }

    [Fact]
    public async Task Reads_with_no_entry_before_them_log_one_entry_even_when_they_arrive_at_once()
    {
        await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example" }));
        var dean = await app.SignInAsync("dean@frostaura.net");

        // A bookmarked org chart: no explicit entry, a burst of reads. Operator access is never silent, and never doubled.
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => ControlPlaneApp.Ok(dean.GetAsync("/api/tree?organisation=acme"))));

        var ceo = await app.SignInAsync("ceo@acme.example");
        var entries = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray()
            .Where(e => e!["action"]!.GetValue<string>() == "organisation.entered").ToList();
        Assert.Single(entries);
    }
}

public sealed class OperatorVisitsTests
{
    [Fact]
    public void A_visit_slides_on_with_each_read_and_ends_after_the_window_without_one()
    {
        var visits = new Endgame.Infrastructure.Access.OperatorVisits();
        var op = Guid.NewGuid();
        var org = Guid.NewGuid();
        var start = new DateTimeOffset(2026, 11, 25, 9, 0, 0, TimeSpan.Zero);
        var window = TimeSpan.FromMinutes(10);

        Assert.False(visits.Continue(op, org, start, window)); // never seen: a new visit
        visits.Seen(op, org, start);
        // A polling org chart: a read every eight minutes for an hour is one visit.
        for (var t = 8; t <= 64; t += 8)
        {
            Assert.True(visits.Continue(op, org, start.AddMinutes(t), window));
        }

        Assert.False(visits.Continue(Guid.NewGuid(), org, start.AddMinutes(64), window)); // another operator
        Assert.False(visits.Continue(op, Guid.NewGuid(), start.AddMinutes(64), window)); // another organisation
        Assert.False(visits.Continue(op, org, start.AddMinutes(64 + 11), window)); // eleven quiet minutes: the next read is a new visit
    }
}
