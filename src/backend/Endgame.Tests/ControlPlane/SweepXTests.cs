using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Domain.Access;
using Endgame.Domain.Tree;
using Endgame.Tests.Fixtures;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// The sweep lane's control-plane fixes, each on the real control plane and a real PostgreSQL: a role
/// said with its own article in a refusal; an operator in God mode suspends and reinstates an
/// organisation, and nobody else can; a person stops a contractor and caps it; an assistant reads and
/// tends an employee's memory and deletes an empty node, behind the HTTP endpoints' own role checks.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class SweepXTests(PostgresServer postgres) : IAsyncLifetime
{
    private ControlPlaneApp app = null!;
    private HttpClient owner = null!;

    public async Task InitializeAsync()
    {
        app = await ControlPlaneApp.StartAsync(postgres);
        owner = await app.OwnerWithOrganisationAsync();
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Theory]
    [InlineData(MemberRole.Owner, "an owner")]
    [InlineData(MemberRole.Admin, "an admin")]
    [InlineData(MemberRole.Builder, "a builder")]
    [InlineData(MemberRole.Viewer, "a viewer")]
    public void A_role_is_said_with_its_own_article(MemberRole role, string said) => Assert.Equal(said, role.WithArticle());

    [Theory]
    [InlineData(NodeLevel.Organisation, "an organisation")]
    [InlineData(NodeLevel.Division, "a division")]
    [InlineData(NodeLevel.Project, "a project")]
    [InlineData(NodeLevel.App, "an app")]
    public void A_level_is_said_with_its_own_article(NodeLevel level, string said) => Assert.Equal(said, level.WithArticle());

    [Fact]
    public async Task A_refusal_names_an_admin_and_an_app_with_the_right_article()
    {
        await AcmeAsync();
        var ceo = await app.SignInAsync("ceo@acme.example");
        await ControlPlaneApp.Ok(ceo.PostAsJsonAsync("/api/members", new { scope = "acme", email = "ada@acme.example", role = "admin" }));
        var ada = await app.SignInAsync("ada@acme.example");
        var refused = await ControlPlaneApp.Expect(await ada.GetAsync("/api/audit/operator-access?organisation=acme"), HttpStatusCode.Forbidden);
        Assert.Equal("This needs the owner role at 'acme'; you are an admin there (set at acme).", refused["detail"]!.GetValue<string>());

        await ceo.DivisionAsync("acme", "tools");
        var wrong = await ControlPlaneApp.Expect(await ceo.PostAsJsonAsync("/api/apps", new { parent = "acme/tools", name = "X", slug = "xx" }), HttpStatusCode.BadRequest);
        Assert.Equal("An app is created under a project; 'acme/tools' is a division.", wrong["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_operator_in_god_mode_suspends_and_reinstates_an_organisation_and_an_admin_cannot()
    {
        var acme = await AcmeAsync();
        var ceo = await app.SignInAsync("ceo@acme.example");
        await ControlPlaneApp.Ok(ceo.PostAsJsonAsync("/api/members", new { scope = "acme", email = "ada@acme.example", role = "admin" }));
        var ada = await app.SignInAsync("ada@acme.example");

        // Its own Owner and an Admin pass no further than FrostAura's check.
        foreach (var person in new[] { ceo, ada })
        {
            var refused = await ControlPlaneApp.Expect(await person.PatchAsJsonAsync($"/api/organisations/{acme}", new { status = "suspended" }), HttpStatusCode.Forbidden);
            Assert.Equal("An organisation is suspended or reinstated by FrostAura.", refused["detail"]!.GetValue<string>());
        }

        // An operator who holds no role in it: God mode's Admin is enough, and it is logged where the Owner reads it.
        var dean = await app.SignInAsync("dean@frostaura.net");
        await ControlPlaneApp.Ok(dean.PostAsync("/api/operator/organisations/acme/enter", null));
        var suspended = await ControlPlaneApp.Ok(dean.PatchAsJsonAsync($"/api/organisations/{acme}", new { status = "suspended" }));
        Assert.Equal("suspended", suspended["status"]!.GetValue<string>());
        var restored = await ControlPlaneApp.Ok(dean.PatchAsJsonAsync($"/api/organisations/{acme}", new { status = "active" }));
        Assert.Equal("active", restored["status"]!.GetValue<string>());

        var log = (await ControlPlaneApp.Ok(ceo.GetAsync("/api/audit/operator-access?organisation=acme"))).AsArray();
        Assert.Equal(2, log.Count(e => e!["action"]!.GetValue<string>() == "admin.UpdateOrganisation"));
        Assert.Contains(log, e => e!["detail"]?["title"]?.GetValue<string>() == "Renamed, suspended or reinstated the organisation");

        // Renaming in the same request still needs its Owner.
        var renamed = await ControlPlaneApp.Expect(await dean.PatchAsJsonAsync($"/api/organisations/{acme}", new { status = "active", name = "Acme Two" }), HttpStatusCode.Forbidden);
        Assert.Equal("This needs the owner role at 'acme'; you are an admin there (set at acme).", renamed["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_person_stops_a_contractor_and_caps_one_and_an_employee_is_not_stopped()
    {
        await owner.DivisionAsync("frostaura", "tools");
        var service = app.Internal();
        var briefer = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/employees", new { scope = "frostaura/tools", name = "Odile", role = "Analyst" })))["id"]!.GetValue<string>());
        var contractor = Guid.Parse((await ControlPlaneApp.Created(service.PostAsJsonAsync("/internal/contractors", new { scope = "frostaura/tools", briefedBy = briefer, role = "Data contractor", brief = "Count the courts." })))["id"]!.GetValue<string>());

        // A cap of its own, as an employee's is set.
        var capped = await ControlPlaneApp.Ok(owner.PatchAsJsonAsync($"/api/employees/{contractor}", new { jobDescription = new { monthlyCreditLimit = 25 } }));
        Assert.Equal(25m, capped["jobDescription"]!["monthlyCreditLimit"]!.GetValue<decimal>());

        var stopped = await ControlPlaneApp.Ok(owner.PostAsync($"/api/employees/{contractor}/stop", null));
        Assert.Equal("released", stopped["status"]!.GetValue<string>());
        var again = await ControlPlaneApp.Expect(await owner.PostAsync($"/api/employees/{contractor}/stop", null), HttpStatusCode.Conflict);
        Assert.Equal("Data contractor (contractor) has already finished.", again["detail"]!.GetValue<string>());

        // It makes no more model calls: the gateway no longer knows it as working here.
        var working = (await ControlPlaneApp.Ok(owner.GetAsync("/api/employees?scope=frostaura/tools"))).AsArray();
        Assert.DoesNotContain(working, e => e!["id"]!.GetValue<string>() == contractor.ToString());

        var employee = await ControlPlaneApp.Expect(await owner.PostAsync($"/api/employees/{briefer}/stop", null), HttpStatusCode.BadRequest);
        Assert.Equal("Only a contractor is stopped; Odile is an employee, who is paused or let go.", employee["detail"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_assistant_reads_adds_corrects_and_forgets_memory_and_deletes_an_empty_node()
    {
        await owner.DivisionAsync("frostaura", "tools");
        await owner.ProjectAsync("frostaura/tools", "empty");
        var employee = Guid.Parse((await ControlPlaneApp.Created(app.Internal().PostAsJsonAsync("/internal/employees", new { scope = "frostaura/tools", name = "Kasper", role = "Engineer" })))["id"]!.GetValue<string>());
        await using var client = await app.McpAsync(await ControlPlaneApp.TokenAsync(owner, "frostaura"));

        var added = await CallAsync(client, "memory_add", new { id = employee, title = "Opening hours", body = "The club opens at six.", kind = "fact" });
        var entry = added["id"]!.GetValue<string>();
        await CallAsync(client, "memory_correct", new { id = employee, entryId = entry, body = "The club opens at seven." });
        var read = (await CallAsync(client, "memory_read", new { id = employee })).AsArray();
        Assert.Equal("The club opens at seven.", Assert.Single(read, e => e!["id"]!.GetValue<string>() == entry)!["body"]!.GetValue<string>());
        await CallAsync(client, "memory_forget", new { id = employee, entryId = entry, why = "Stale." });
        Assert.DoesNotContain((await CallAsync(client, "memory_read", new { id = employee })).AsArray(), e => e!["id"]!.GetValue<string>() == entry);

        Assert.Equal("frostaura/tools/empty", (await CallAsync(client, "node_delete", new { scope = "frostaura/tools/empty" }))["deleted"]!.GetValue<string>());
        var refused = await CallAsync(client, "node_delete", new { scope = "frostaura" }, expectError: true);
        Assert.Equal(400, refused["status"]!.GetValue<int>());
    }

    private async Task<Guid> AcmeAsync() =>
        Guid.Parse((await ControlPlaneApp.Created(owner.PostAsJsonAsync("/api/organisations", new { name = "Acme", slug = "acme", ownerEmail = "ceo@acme.example", description = Provisioning.Description, screening = Provisioning.Manual })))["id"]!.GetValue<string>());

    private static async Task<JsonNode> CallAsync(McpClient client, string tool, object arguments, bool expectError = false)
    {
        var args = JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(arguments))!;
        var result = await client.CallToolAsync(tool, args);
        var text = Assert.IsType<TextContentBlock>(result.Content[0]).Text;
        Assert.True((result.IsError == true) == expectError, $"{tool}: {text}");
        return JsonNode.Parse(text)!;
    }
}
