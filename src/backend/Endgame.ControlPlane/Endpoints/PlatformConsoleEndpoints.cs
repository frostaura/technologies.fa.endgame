using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.ControlPlane.Endpoints;

public sealed record SecretSetRequest(string? Scope, string? Name, string? Value);

/// <summary>A secret as the console sees it: its name and the level that set it, never its value.</summary>
public sealed record SecretNameView(string Name, string SetAtLevel, string SetAtPath, DateTimeOffset SetAt, bool Inherited, IReadOnlyList<string> Overrides);

/// <param name="Effective">The secrets that apply at the scope, each with the level that set it.</param>
/// <param name="SetBelow">Secrets set on nodes beneath the scope, by name and node.</param>
public sealed record SecretListView(string Scope, IReadOnlyList<SecretNameView> Effective, IReadOnlyList<SecretBelowView> SetBelow);

public sealed record SecretBelowView(string Name, string SetAtPath);

public sealed record ShareRequest(string? Email);

public sealed record OperatorRef(Guid Id, string? Email, string DisplayName);

public sealed record OperatorActionView(Guid Id, DateTimeOffset At, string Action, OperatorRef Operator, JsonNode? Detail);


/// <summary>The console's side of the platform API: the vault (write-only), sharing, and God mode's audit trail.</summary>
internal static class PlatformConsoleEndpoints
{
    public static void MapPlatformConsole(this RouteGroupBuilder api)
    {
        var secrets = api.MapGroup("/secrets").WithTags("Secrets");
        secrets.MapGet("", async (string? scope, ClaimsPrincipal principal, AccessService access, CascadeService cascade, ScopeResolver scopes, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
            var effective = await cascade.ResolveAsync(resolved, CascadeKind.Secret, ct);
            var below = new List<SecretBelowView>();
            foreach (var row in await cascade.BelowAsync(resolved, CascadeKind.Secret, ct))
            {
                below.Add(new SecretBelowView(row.Key, (await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, ct)).Path.ToString()));
            }

            return Results.Ok(new SecretListView(resolved.Path.ToString(),
                effective.Select(v => new SecretNameView(v.Key, v.SetAtLevel, v.SetAtPath, v.SetAt, v.SetAtPath != resolved.Path.ToString(), v.Overrides)).ToList(),
                below.OrderBy(b => b.SetAtPath, StringComparer.Ordinal).ThenBy(b => b.Name, StringComparer.Ordinal).ToList()));
        })
        .WithName("ListSecrets").WithSummary("The names of the secrets that apply at a scope, with the level that set each, and those set beneath it. Values are never returned.").Produces<SecretListView>();

        secrets.MapPut("", async (SecretSetRequest request, ClaimsPrincipal principal, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var me = principal.Id();
            var (resolved, _) = await access.RequireAsync(me, request.Scope, MemberRole.Admin, ct);
            var set = await cascade.SetAsync(resolved, CascadeKind.Secret, request.Name ?? "", JsonValue.Create(request.Value), me,
                await access.IsOperatorAsync(me, ct) ? Domain.Platform.Actor.Operator : Domain.Platform.Actor.Member, ct);
            return Results.Ok(new SecretNameView(set.Key, set.SetAtLevel, set.SetAtPath, set.SetAt, false, []));
        })
        .WithName("SetSecret").WithSummary("Sets or replaces a secret at a scope (Admin and above). Sealed with envelope encryption; it applies beneath unless a lower level sets its own.").Produces<SecretNameView>();

        secrets.MapDelete("", async (string? scope, string? name, ClaimsPrincipal principal, AccessService access, CascadeService cascade, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
            return await cascade.RemoveAsync(resolved, CascadeKind.Secret, name ?? "", ct)
                ? Results.NoContent()
                : Problems.From(EndgameProblem.NotFound($"A secret '{name}' set at '{scope}'"));
        })
        .WithName("RemoveSecret").WithSummary("Removes a secret set at a scope; an inherited one applies again.");

        var shares = api.MapGroup("/apps/{id:guid}/shares").WithTags("Apps");
        shares.MapGet("", async (Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppIdentityService identity, CancellationToken ct) =>
            Results.Ok(await identity.SharesAsync(await AppAsAdminAsync(id, principal, access, scopes, ct), ct)))
            .WithName("ListShares").WithSummary("The addresses an app is shared with, and whether each has registered.").Produces<IReadOnlyList<AppShareView>>();
        shares.MapPost("", async (Guid id, ShareRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppIdentityService identity, InvitationMailer mailer, CancellationToken ct) =>
        {
            var app = await AppAsAdminAsync(id, principal, access, scopes, ct);
            var share = await identity.ShareAsync(app, request.Email ?? "", principal.Id(), ct);
            return Results.Created($"/api/apps/{id}/shares", share with { Emailed = await mailer.SendShareAsync(app, share.Email, share.InvitationCode, share.ExpiresAt, ct) });
        })
        .WithName("ShareApp").WithSummary("Shares an app with an address (Admin and above). Returns a one-time invitation code, once; the person registers with it at the app's sign-up page.").Produces<AppShareCreated>(201);
        shares.MapDelete("", async (Guid id, string? email, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppIdentityService identity, CancellationToken ct) =>
            await identity.UnshareAsync(await AppAsAdminAsync(id, principal, access, scopes, ct), email ?? "", ct)
                ? Results.NoContent()
                : Problems.From(EndgameProblem.NotFound($"A share with '{email}'")))
            .WithName("UnshareApp").WithSummary("Stops sharing an app with an address; that person's sessions there end at once.");

        api.MapGet("/audit/operator-access", async (string? organisation, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session, CancellationToken ct) =>
        {
            var me = principal.Id();
            var (scope, _) = await access.RequireAsync(me, organisation, MemberRole.Owner, ct);
            if (scope.Level != NodeLevel.Organisation)
            {
                throw EndgameProblem.Invalid("The operator log belongs to an organisation; pass its slug.");
            }

            session.UseOrganisation(scope.OrganisationId);
            var rows = await (from a in db.OperatorActions.AsNoTracking()
                              join u in db.Users.AsNoTracking() on a.OperatorUserId equals u.Id into people
                              from u in people.DefaultIfEmpty()
                              where a.OrganisationId == scope.OrganisationId
                              orderby a.At descending
                              select new { a.Id, a.At, a.Action, a.OperatorUserId, Email = u == null ? null : u.Email, Name = u == null ? null : u.DisplayName, a.DetailJson })
                .Take(500).ToListAsync(ct);
            return Results.Ok(rows.Select(r => new OperatorActionView(r.Id, r.At, r.Action, new OperatorRef(r.OperatorUserId, r.Email, r.Name ?? ""), JsonNode.Parse(r.DetailJson))).ToList());
        })
        .WithTags("Audit").WithName("GetOperatorAccessLog")
        .WithSummary("Every FrostAura operator entry into the organisation and every operator action on it, newest first (the Owner only).")
        .Produces<IReadOnlyList<OperatorActionView>>();

    }

    private static async Task<ResolvedScope> AppAsAdminAsync(Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, CancellationToken ct)
    {
        var scope = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
        await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
        return scope;
    }
}
