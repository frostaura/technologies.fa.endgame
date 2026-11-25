using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tree;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Endgame.ControlPlane.Endpoints;

public sealed record CreateOrganisationRequest(string? Name, string? Slug, string? OwnerEmail, string? OwnerDisplayName);

/// <param name="OwnerInvitationCode">Returned once, when the Owner is new and has no passkey yet.</param>
/// <param name="InvitationEmailed">The code was also e-mailed to the Owner (only when a mail server is configured).</param>
/// <param name="NameCheck">How the name was checked against FrostAura's own subdomains.</param>
public sealed record OrganisationCreated(Guid Id, string Slug, string Name, string OwnerEmail, string? OwnerInvitationCode, DateTimeOffset? InvitationExpiresAt,
    bool InvitationEmailed = false, NameCheck? NameCheck = null);

public sealed record CreateNodeRequest(string? Parent, string? Name, string? Slug);

public sealed record UpdateNodeRequest(string? Name, string? Status);

public sealed record CascadeSetRequest(string? Scope, string? Kind, string? Key, JsonNode? Value);

public sealed record GrantRequest(string? Scope, string? Email, string? DisplayName, string? Role);

/// <param name="RequestId">Optional: the top-up request this answers; it is marked fulfilled.</param>
public sealed record TopUpRequest(string? Organisation, decimal Credits, string? Note, string? IdempotencyKey, Guid? RequestId = null);

/// <summary>The tree (ARCH-004, <i>Tree</i>), the cascade's values, members and credits.</summary>
internal static class TreeEndpoints
{
    public static void MapTree(this RouteGroupBuilder api)
    {
        api.MapGet("/tree", async (string? organisation, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, ReadModels reads, CancellationToken ct) =>
        {
            var me = principal.Id();
            var memberships = await access.MembershipsOfAsync(me, ct);
            if (memberships.Count == 0 && organisation is null)
            {
                // First run, or a person not yet given a role: a real, empty answer.
                return Results.Ok(reads.FirstRun());
            }

            var chosen = organisation is null ? memberships.FirstOrDefault() : memberships.FirstOrDefault(m => m.OrganisationSlug == organisation);
            if (chosen is null && organisation is not null && await access.IsOperatorAsync(me, ct)
                && await scopes.FindAsync(Endgame.Domain.Tree.ScopePath.Parse(organisation), ct) is { Level: NodeLevel.Organisation } entered)
            {
                // God mode: an operator enters an organisation they hold no role in — as an Admin, and logged.
                var entry = await access.OperatorEntryAsync(me, entered, ct);
                return Results.Ok(await reads.TreeAsync(entered.OrganisationId, [entry!], ct));
            }

            if (chosen is null)
            {
                throw EndgameProblem.NotFound($"The organisation '{organisation}'");
            }

            var grants = await access.GrantsInOrganisationAsync(me, chosen.OrganisationId, ct);
            return Results.Ok(await reads.TreeAsync(chosen.OrganisationId, grants, ct));
        })
        .WithTags("Tree").WithName("GetTree")
        .WithSummary("The whole organisation as one document for the org chart: every node's status, this month's spend, who works on it, and what needs you. organisation is null on first run.")
        .Produces<TreeView>();

        var organisations = api.MapGroup("/organisations").WithTags("Tree");
        organisations.MapPost("", async (CreateOrganisationRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access,
            AccountService accounts, TreeService tree, EndgameDbContext db, ReservedNames reserved, InvitationMailer mailer, ScopeResolver scopes, TimeProvider clock, CancellationToken ct) =>
        {
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            var named = AccountService.ValidateOrganisation(new NewOrganisation(request.Name ?? "", request.Slug ?? ""));
            var firstRun = await accounts.IsFirstRunAsync(ct);
            if (!firstRun && !access.IsOperator(me))
            {
                throw EndgameProblem.Forbidden("Organisations are provisioned by FrostAura; there is no self-serve sign-up.");
            }

            // A name may not take one of FrostAura's own subdomains (spec, Addresses and hosting).
            var check = await reserved.CheckAsync(named.Slug, ct);
            if (firstRun)
            {
                // First run: whoever is signed in names the first organisation and becomes its Owner.
                var first = await accounts.CreateFirstOrganisationAsync(named, me.Id, ct);
                return Results.Created($"/api/organisations/{first.Id}", new OrganisationCreated(first.Id, first.Slug, first.Name, me.Email!, null, null, false, check));
            }

            var owner = request.OwnerEmail is null ? me : await accounts.FindOrCreateAsync(AccountService.NormaliseEmail(request.OwnerEmail), request.OwnerDisplayName, ct);
            var created = await tree.CreateOrganisationAsync(named.Name, named.Slug, owner.Id, ct);
            db.OperatorActions.Add(new OperatorActionRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = created.Id,
                OperatorUserId = me.Id,
                Action = "organisation.provisioned",
                DetailJson = new JsonObject { ["ownerUserId"] = owner.Id.ToString() }.ToJsonString(),
                At = clock.GetUtcNow(),
            });
            await db.SaveChangesAsync(ct);
            var (code, expires) = owner.Id == me.Id ? ((string?)null, (DateTimeOffset?)null) : await accounts.IssueInvitationIfNeededAsync(owner);
            // The hand-over: the code to the operator, once, and by e-mail to the Owner when mail is configured.
            var emailed = code is not null && expires is { } until
                && await mailer.SendAsync(await scopes.RequireAsync(created.Slug, ct), owner.Email!, code, until, "Owner", me.DisplayName, ct);
            return Results.Created($"/api/organisations/{created.Id}", new OrganisationCreated(created.Id, created.Slug, created.Name, owner.Email!, code, expires, emailed, check));
        })
        .WithName("CreateOrganisation")
        .WithSummary("On first run, the signed-in person names the first organisation and becomes its Owner; after that, FrostAura operators provision organisations.")
        .Produces<OrganisationCreated>(201);
        MapNodeChanges(organisations, NodeLevel.Organisation, MemberRole.Owner, MemberRole.Owner);

        foreach (var (route, level, createRole, changeRole, deleteRole) in new[]
                 {
                     ("/divisions", NodeLevel.Division, MemberRole.Admin, MemberRole.Admin, MemberRole.Admin),
                     ("/projects", NodeLevel.Project, MemberRole.Builder, MemberRole.Builder, MemberRole.Admin),
                     ("/apps", NodeLevel.App, MemberRole.Builder, MemberRole.Builder, MemberRole.Admin),
                 })
        {
            var group = api.MapGroup(route).WithTags("Tree");
            group.MapPost("", async (CreateNodeRequest request, ClaimsPrincipal principal, AccessService access, TreeService tree, CancellationToken ct) =>
            {
                var (parent, _) = await access.RequireAsync(principal.Id(), request.Parent, createRole, ct);
                if (parent.Level != level - 1)
                {
                    throw EndgameProblem.Invalid($"A {level.ToWire()} is created under a {(level - 1).ToWire()}; '{parent.Path}' is a {parent.Level.ToWire()}.");
                }

                var node = await tree.CreateChildAsync(parent, request.Name ?? "", request.Slug ?? "", ct);
                return Results.Created($"/api{route}/{node.Id}", node);
            })
            .WithName($"Create{level}").WithSummary($"Creates a {level.ToWire()} under its parent scope.").Produces<NodeView>(201);
            MapNodeChanges(group, level, changeRole, deleteRole);
        }

        var cascade = api.MapGroup("/cascade").WithTags("Cascade");
        cascade.MapGet("", async (string? scope, string? kind, ClaimsPrincipal principal, AccessService access, CascadeService values, CancellationToken ct) =>
        {
            var parsed = Kind(kind);
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, parsed is CascadeKind.Permission or CascadeKind.Secret ? MemberRole.Admin : MemberRole.Viewer, ct);
            return Results.Ok(await values.ResolveAsync(resolved, parsed, ct));
        })
        .WithName("ResolveCascade").WithSummary("The effective values of one kind at a scope, each with the level that set it.").Produces<IReadOnlyList<EffectiveValue>>();
        cascade.MapGet("/below", async (string? scope, string? kind, ClaimsPrincipal principal, AccessService access, CascadeService values, ScopeResolver scopes, CancellationToken ct) =>
        {
            var parsed = Kind(kind);
            if (parsed == CascadeKind.Permission)
            {
                throw EndgameProblem.Invalid("Roles granted beneath a level are listed by /api/members.");
            }

            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, parsed is CascadeKind.Secret ? MemberRole.Admin : MemberRole.Viewer, ct);
            var views = new List<EffectiveValue>();
            foreach (var row in await values.BelowAsync(resolved, parsed, ct))
            {
                var node = await scopes.ForRowAsync(row.OrganisationId, row.DivisionId, row.ProjectId, row.AppId, ct);
                // A secret's value is never shown, here or anywhere: only that it is set, and where.
                views.Add(new EffectiveValue(row.Kind, row.Key, parsed == CascadeKind.Secret ? null : JsonNode.Parse(row.ValueJson), node.Level.ToWire(), node.Path.ToString(), row.SetAt, []));
            }

            return Results.Ok(views.OrderBy(v => v.SetAtPath, StringComparer.Ordinal).ThenBy(v => v.Key, StringComparer.Ordinal).ToList());
        })
        .WithName("CascadeBelow").WithSummary("The values of one kind set at levels beneath a scope, each with where it was set: what a lower level replaces or adds.").Produces<IReadOnlyList<EffectiveValue>>();
        cascade.MapPut("", async (CascadeSetRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, CascadeService values, EdgeNotifier edge, CancellationToken ct) =>
        {
            var parsed = Kind(request.Kind);
            var key = request.Key ?? "";
            var (resolved, _) = await access.RequireAsync(principal.Id(), request.Scope, CascadeService.RoleToSet(parsed, key), ct);
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            var result = await values.SetAsync(resolved, parsed, key, request.Value, me.Id, access.IsOperator(me) ? Actor.Operator : Actor.Member, ct);
            if (parsed == CascadeKind.Setting || parsed == CascadeKind.Budget)
            {
                edge.RoutesChanged();
            }

            return Results.Ok(result);
        })
        .WithName("SetCascadeValue").WithSummary("Sets a budget, rule set, context, setting or secret at a scope; it applies beneath unless narrowed.").Produces<EffectiveValue>();
        cascade.MapDelete("", async (string? scope, string? kind, string? key, ClaimsPrincipal principal, AccessService access, CascadeService values, CancellationToken ct) =>
        {
            var parsed = Kind(kind);
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, CascadeService.RoleToSet(parsed, key ?? ""), ct);
            return await values.RemoveAsync(resolved, parsed, key ?? "", ct) ? Results.NoContent() : Problems.From(EndgameProblem.NotFound($"A {kind} '{key}' set at '{scope}'"));
        })
        .WithName("RemoveCascadeValue").WithSummary("Removes a value set at a scope; what is inherited applies again.");

        var members = api.MapGroup("/members").WithTags("Members");
        members.MapGet("", async (string? scope, ClaimsPrincipal principal, AccessService access, AccountService accounts, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct);
            return Results.Ok(await accounts.MembersAsync(resolved, ct));
        })
        .WithName("ListMembers").WithSummary("Everyone holding a role at the scope or beneath it.").Produces<IReadOnlyList<MemberView>>();
        members.MapPost("", async (GrantRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, AccountService accounts, InvitationMailer mailer, CancellationToken ct) =>
        {
            var role = Role(request.Role);
            var (resolved, mine) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Admin, ct);
            var invitation = await accounts.GrantAsync(resolved, mine, request.Email ?? "", request.DisplayName, role, principal.Id(), ct);
            if (invitation.InvitationCode is { } code && invitation.ExpiresAt is { } until)
            {
                var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
                invitation = invitation with { Emailed = await mailer.SendAsync(resolved, invitation.Member.Email, code, until, role.ToWire(), me.DisplayName, ct) };
            }

            return Results.Ok(invitation);
        })
        .WithName("GrantRole").WithSummary("Grants a role at a scope; a new person gets a one-time invitation code to register a passkey with.").Produces<Invitation>();
        members.MapDelete("/{membershipId:guid}", async (Guid membershipId, ClaimsPrincipal principal, AccessService access, AccountService accounts, ScopeResolver scopes, CancellationToken ct) =>
        {
            var (_, membership) = await accounts.MembershipAsync(membershipId, ct);
            var scope = await scopes.ForRowAsync(membership.OrganisationId, membership.DivisionId, membership.ProjectId, membership.AppId, ct);
            await access.RequireAsync(principal.Id(), scope, membership.Role == MemberRole.Admin.ToWire() ? MemberRole.Owner : MemberRole.Admin, ct);
            await accounts.RevokeAsync(membership, ct);
            return Results.NoContent();
        })
        .WithName("RevokeRole").WithSummary("Revokes one role grant.");

        var credits = api.MapGroup("/credits").WithTags("Credits");
        credits.MapGet("", async (string? scope, ClaimsPrincipal principal, AccessService access, ReadModels reads, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await reads.CreditsAsync(resolved, ct));
        })
        .WithName("GetCredits").WithSummary("Balance, this month's spend, budgets down the cascade in tree order, estimate accuracy, what was not charged, overdraft and top-ups.").Produces<CreditsView>();
        credits.MapPost("/top-ups", async (TopUpRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, ScopeResolver scopes, CreditLedger ledger, EdgeNotifier edge,
            EndgameDbContext db, Endgame.Infrastructure.Tenancy.TenantSession session, CancellationToken ct) =>
        {
            var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
            if (!access.IsOperator(me))
            {
                throw EndgameProblem.Forbidden("Credits are topped up by FrostAura (manual top-ups; there is no payment gateway).");
            }

            var organisation = await scopes.RequireAsync(request.Organisation, ct);
            if (organisation.Level != NodeLevel.Organisation)
            {
                throw EndgameProblem.Invalid("Top-ups are made to an organisation.");
            }

            var entry = await ledger.TopUpAsync(organisation.OrganisationId, request.Credits, request.Note, me.Id, request.IdempotencyKey, ct);
            if (request.RequestId is { } requestId)
            {
                session.UseOrganisation(organisation.OrganisationId);
                await db.TopUpRequests.Where(r => r.OrganisationId == organisation.OrganisationId && r.Id == requestId && r.Status == TopUpRequestStatuses.Open)
                    .ExecuteUpdateAsync(u => u.SetProperty(r => r.Status, TopUpRequestStatuses.Fulfilled).SetProperty(r => r.ClosedAt, entry.CreatedAt)
                        .SetProperty(r => r.ClosedBy, me.Id).SetProperty(r => r.TopUpEntryId, entry.Id), ct);
            }

            // A top-up settles the debt first and restores paused apps at once (spec, Overdraft).
            edge.RoutesChanged();
            return Results.Ok(new { entry.Id, entry.Amount, entry.CreatedAt, Organisation = organisation.Path.ToString() });
        })
        .WithName("TopUpCredits").WithSummary("Adds credits to an organisation (FrostAura operators only; logged for the Owner to read).");
    }

    private static void MapNodeChanges(RouteGroupBuilder group, NodeLevel level, MemberRole changeRole, MemberRole deleteRole)
    {
        group.MapPatch("/{id:guid}", async (Guid id, UpdateNodeRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, ScopeResolver scopes, TreeService tree, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(level, id, ct) ?? throw EndgameProblem.NotFound($"The {level.ToWire()}");
            await access.RequireAsync(principal.Id(), scope, changeRole, ct);
            if (level == NodeLevel.Organisation && request.Status is not null)
            {
                var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
                if (!access.IsOperator(me))
                {
                    throw EndgameProblem.Forbidden("An organisation is suspended or reinstated by FrostAura.");
                }
            }

            return Results.Ok(await tree.UpdateAsync(scope, request.Name, request.Status, ct));
        })
        .WithName($"Update{level}").WithSummary($"Renames a {level.ToWire()} or changes its status.").Produces<NodeView>();
        group.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, TreeService tree, CancellationToken ct) =>
        {
            var scope = await scopes.FindNodeAsync(level, id, ct) ?? throw EndgameProblem.NotFound($"The {level.ToWire()}");
            await access.RequireAsync(principal.Id(), scope, deleteRole, ct);
            await tree.DeleteAsync(scope, ct);
            return Results.NoContent();
        })
        .WithName($"Delete{level}").WithSummary($"Deletes a {level.ToWire()} with nothing attached; anything with history is archived instead.");
    }

    public static CascadeKind Kind(string? kind)
    {
        try
        {
            return CascadeKinds.FromWire(kind);
        }
        catch (Endgame.Domain.DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }
    }

    private static MemberRole Role(string? role)
    {
        try
        {
            return MemberRoles.FromWire(role);
        }
        catch (Endgame.Domain.DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }
    }
}
