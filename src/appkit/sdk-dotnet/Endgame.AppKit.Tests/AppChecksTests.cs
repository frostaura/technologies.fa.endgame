using Endgame.AppKit.Testing;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Endgame.AppKit.Tests;

/// <summary>
/// The checks an app's own tests run (<see cref="AppChecks"/>), so the app cannot drift from the security review's checklist
/// or from its own <c>docs/app.md</c>. R6-5: a built app copied the template's example — a read of the person's own record
/// with an optional user — and the review blocked publishing. R6-6: the repair added <c>.RequireUser()</c> but left
/// <c>docs/app.md</c> saying the endpoint needs no sign-in, and the second review failed on that line.
/// </summary>
public sealed class AppChecksTests
{
    private static void Things(RouteGroupBuilder api)
    {
        api.MapGet("things", () => 1).WithName("listThings").WithDescription("Every thing.");
        api.MapPost("things", (EndgameUser user) => user.Id).RequireUser().WithName("createThing").WithDescription("Makes a thing.");
    }

    [Fact]
    public async Task A_handler_that_takes_the_person_without_requiring_sign_in_is_a_fault()
    {
        await using var host = await KitHost.StartAsync(api: api =>
        {
            Things(api);
            // The shape a built app copied from the template's old example (R6-5).
            api.MapGet("things/{id}/mark", (Guid id, EndgameUser? user) => user is null ? "count only" : "mine")
                .WithName("getThingMark").WithDescription("Whether you marked a thing, and how many did.");
        });

        var fault = Assert.Single(AppChecks.OwnRecordFaults(host.Services));
        Assert.Contains("GET api/things/{id}/mark (getThingMark)", fault, StringComparison.Ordinal);
        Assert.Contains("add .RequireUser() and take EndgameUser", fault, StringComparison.Ordinal);
        Assert.Contains("public resource", fault, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Requiring_sign_in_clears_it_and_the_kits_own_who_is_signed_in_is_not_held_to_it()
    {
        await using var host = await KitHost.StartAsync(api: api =>
        {
            Things(api);
            api.MapGet("things/{id}/mark", (Guid id, EndgameUser user) => user.Id).RequireUser()
                .WithName("getThingMark").WithDescription("Whether you marked a thing.");
        });

        // getCurrentUser (api/me) takes an optional user by design: it says who is signed in, or nobody.
        Assert.Empty(AppChecks.OwnRecordFaults(host.Services));
    }

    private const string Document = """
        # The app

        | Feature | Where | Signed in? |
        | --- | --- | --- |
        | List things | `/` · `GET api/things` (`listThings`) | No |
        | Make a thing | `/new` · `POST api/things` (`createThing`) | Yes |
        | Who is signed in | header · `GET api/me` (`getCurrentUser`, from the kit) | No |
        """;

    [Fact]
    public async Task A_document_that_says_who_may_call_each_endpoint_has_no_faults()
    {
        await using var host = await KitHost.StartAsync(api: Things);
        Assert.Empty(AppChecks.AppDocumentFaults(host.Services, Document));
    }

    [Fact]
    public async Task A_document_that_understates_or_overstates_sign_in_is_a_fault_naming_the_row()
    {
        await using var host = await KitHost.StartAsync(api: Things);

        // The second review's finding in run d09672a3: the code requires sign-in, the document says it does not.
        var understated = AppChecks.AppDocumentFaults(host.Services, Document.Replace("(`createThing`) | Yes", "(`createThing`) | No", StringComparison.Ordinal));
        Assert.Contains(understated, f => f.Contains("`createThing`", StringComparison.Ordinal) && f.Contains("has .RequireUser()", StringComparison.Ordinal) && f.Contains("write Yes", StringComparison.Ordinal));

        var overstated = AppChecks.AppDocumentFaults(host.Services, Document.Replace("(`listThings`) | No", "(`listThings`) | Yes", StringComparison.Ordinal));
        Assert.Contains(overstated, f => f.Contains("`listThings`", StringComparison.Ordinal) && f.Contains("no .RequireUser()", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Every_endpoint_is_listed_once_with_yes_or_no_and_nothing_listed_is_missing()
    {
        await using var host = await KitHost.StartAsync(api: Things);

        var missing = AppChecks.AppDocumentFaults(host.Services, Document.Replace("| Make a thing | `/new` · `POST api/things` (`createThing`) | Yes |\n", "", StringComparison.Ordinal));
        Assert.Contains(missing, f => f.Contains("`createThing` (POST api/things) is not in docs/app.md", StringComparison.Ordinal));

        var stale = AppChecks.AppDocumentFaults(host.Services, Document + "\n| Delete a thing | `DELETE api/things/{id}` (`deleteThing`) | Yes |");
        Assert.Contains(stale, f => f.Contains("`deleteThing`", StringComparison.Ordinal) && f.Contains("no endpoint", StringComparison.Ordinal));

        var mixed = AppChecks.AppDocumentFaults(host.Services, Document
            .Replace("| List things | `/` · `GET api/things` (`listThings`) | No |\n| Make a thing | `/new` · `POST api/things` (`createThing`) | Yes |", "| Things | `GET/POST api/things` (`listThings`, `createThing`) | To make one |", StringComparison.Ordinal));
        Assert.Contains(mixed, f => f.Contains("\"To make one\"", StringComparison.Ordinal) && f.Contains("Yes or No", StringComparison.Ordinal));
        Assert.Contains(mixed, f => f.Contains("split the row", StringComparison.Ordinal));

        var none = AppChecks.AppDocumentFaults(host.Services, "# The app\n\nPeople make things.\n");
        Assert.Contains(none, f => f.Contains("no table with a \"Signed in?\" column", StringComparison.Ordinal));
    }
}
