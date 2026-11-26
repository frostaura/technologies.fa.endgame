using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Credits;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.ControlPlane.Endpoints;

public sealed record OperatorOverdraftRequest(decimal Credits);

public sealed record EnteredView(Guid OrganisationId, string Organisation, string Role, DateTimeOffset EnteredAt, string Logged);

/// <param name="Organisation">The organisation's address name (slug).</param>
/// <param name="OrganisationName">Its display name: what the console shows.</param>
public sealed record OperatorTopUpView(Guid Id, string Organisation, string OrganisationName, decimal Credits, string Note, DateTimeOffset At, Guid? By, string? ByEmail);

/// <param name="Status"><c>fulfilled</c> or <c>declined</c>.</param>
/// <param name="TopUpEntryId">The top-up that answered it, when there was one.</param>
public sealed record CloseTopUpRequest(string? Status, string? Note, Guid? TopUpEntryId);

/// <summary>
/// God mode (spec): operators — an explicit list of addresses — see every organisation with its
/// balance and standing, enter one (logged where its Owner can read it), set its deepest overdraft,
/// read top-up history and requests, and own the prices. Nothing here is reachable with an access
/// token: God mode is a person at the console.
/// </summary>
internal static class OperatorEndpoints
{
    public static void MapOperator(this RouteGroupBuilder api)
    {
        var op = api.MapGroup("/operator").WithTags("Operator");

        op.MapGet("/organisations", async (ClaimsPrincipal principal, AccessService access, OperatorOverview overview, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                return Results.Ok(await overview.SummariesAsync(ct));
            })
            .WithName("ListOrganisations")
            .WithSummary("God mode: every organisation with its balance, overdraft and standing, apps, last activity and open top-up requests. Entering one (any read inside it) is written to that organisation's operator log.")
            .Produces<IReadOnlyList<OrganisationSummary>>();

        op.MapPost("/organisations/{slug}/enter", async (string slug, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, TimeProvider clock, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                var org = await OrganisationAsync(slug, scopes, ct);
                await access.RecordEntryAsync(principal.Id(), org.OrganisationId, org.Path.ToString(), ct);
                return Results.Ok(new EnteredView(org.OrganisationId, org.Path.ToString(), "admin", clock.GetUtcNow(),
                    "This entry is in the organisation's operator log, which its Owner reads."));
            })
            .WithName("EnterOrganisation")
            .WithSummary("An operator enters an organisation as its Admin (never its Owner). The entry is logged for the Owner; then every /api read names it as usual (for example /api/tree?organisation=).")
            .Produces<EnteredView>();

        op.MapPut("/organisations/{slug}/overdraft", async (string slug, OperatorOverdraftRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes,
                CascadeService cascade, EdgeNotifier edge, EndgameDbContext db, TenantSession session, OperatorOverview overview, TimeProvider clock, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                var org = await OrganisationAsync(slug, scopes, ct);
                await cascade.SetAsync(org, CascadeKind.Setting, CascadeKeys.OverdraftLimit, JsonValue.Create(request.Credits), principal.Id(), Actor.Operator, ct);
                session.UseOrganisation(org.OrganisationId);
                db.OperatorActions.Add(new OperatorActionRecord
                {
                    Id = Guid.NewGuid(),
                    OrganisationId = org.OrganisationId,
                    OperatorUserId = principal.Id(),
                    Action = "overdraft.set",
                    DetailJson = new JsonObject { ["credits"] = request.Credits }.ToJsonString(),
                    At = clock.GetUtcNow(),
                });
                await db.SaveChangesAsync(ct);
                await edge.RoutesChangedAsync(ct);
                return Results.Ok((await overview.SummariesAsync(ct)).Single(o => o.Id == org.OrganisationId));
            })
            .WithName("SetOrganisationOverdraft")
            .WithSummary("Sets the deepest overdraft an organisation may run to (credits below zero; no interest or fees, ever). Its own limit and any lower one may only be tighter. Logged for the Owner.")
            .Produces<OrganisationSummary>();

        op.MapGet("/top-ups", async (string? organisation, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                session.UseSystem();
                var rows = await (from e in db.CreditEntries.AsNoTracking()
                                  join o in db.Organisations.AsNoTracking() on e.OrganisationId equals o.Id
                                  join u in db.Users.AsNoTracking() on e.CreatedBy equals u.Id into people
                                  from u in people.DefaultIfEmpty()
                                  where e.Kind == "top_up" && (organisation == null || o.Slug == organisation)
                                  orderby e.CreatedAt descending
                                  select new OperatorTopUpView(e.Id, o.Slug, o.Name, e.Amount, e.Note ?? "", e.CreatedAt, e.CreatedBy, u == null ? null : u.Email)).Take(500).ToListAsync(ct);
                session.Clear();
                return Results.Ok(rows);
            })
            .WithName("ListTopUps").WithSummary("Every manual top-up, newest first, in one organisation or all: who made it, how much and why.").Produces<IReadOnlyList<OperatorTopUpView>>();

        op.MapGet("/top-up-requests", async (string? status, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                if (status is not null && !TopUpRequestStatuses.All.Contains(status))
                {
                    throw EndgameProblem.Invalid("status is open, fulfilled or declined.");
                }

                return Results.Ok(await BreadthEndpoints.TopUpRequestViewsAsync(db, session, r => status == null || r.Status == status, ct));
            })
            .WithName("ListAllTopUpRequests").WithSummary("Top-up requests from every organisation, newest first (open ones by status=open).").Produces<IReadOnlyList<TopUpRequestView>>();

        op.MapPost("/top-up-requests/{id:guid}/close", async (Guid id, CloseTopUpRequest request, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session,
                TimeProvider clock, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                if (request.Status is not (TopUpRequestStatuses.Fulfilled or TopUpRequestStatuses.Declined))
                {
                    throw EndgameProblem.Invalid("status is fulfilled or declined.");
                }

                session.UseSystem();
                var row = await db.TopUpRequests.SingleOrDefaultAsync(r => r.Id == id, ct) ?? throw EndgameProblem.NotFound("The top-up request");
                if (row.Status != TopUpRequestStatuses.Open)
                {
                    throw EndgameProblem.Conflict($"This request is already {row.Status}.");
                }

                if (request.TopUpEntryId is { } entry && !await db.CreditEntries.AnyAsync(e => e.OrganisationId == row.OrganisationId && e.Id == entry && e.Kind == "top_up", ct))
                {
                    throw EndgameProblem.Invalid("topUpEntryId names no top-up of this organisation.");
                }

                row.Status = request.Status;
                row.ClosedAt = clock.GetUtcNow();
                row.ClosedBy = principal.Id();
                row.CloseNote = request.Note is { Length: > 500 } n ? n[..500] : request.Note;
                row.TopUpEntryId = request.TopUpEntryId;
                db.OperatorActions.Add(new OperatorActionRecord
                {
                    Id = Guid.NewGuid(),
                    OrganisationId = row.OrganisationId,
                    OperatorUserId = principal.Id(),
                    Action = "topup_request." + request.Status,
                    DetailJson = new JsonObject { ["requestId"] = id.ToString(), ["credits"] = row.Credits, ["note"] = request.Note }.ToJsonString(),
                    At = clock.GetUtcNow(),
                });
                await db.SaveChangesAsync(ct);
                return Results.Ok((await BreadthEndpoints.TopUpRequestViewsAsync(db, session, r => r.Id == id, ct)).Single());
            })
            .WithName("CloseTopUpRequest").WithSummary("Answers a top-up request: fulfilled (naming the top-up made with POST /api/credits/top-ups) or declined. Logged for the Owner.").Produces<TopUpRequestView>();

        op.MapGet("/pricing", async (ClaimsPrincipal principal, AccessService access, PricingService pricing, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                return Results.Ok(await pricing.ViewAsync(ct));
            })
            .WithName("GetPricing").WithSummary("The prices every bill is made from — credits per dollar, the margin, hosting rates, the default monthly model allowance of an app — and their change history.").Produces<PricingView>();

        op.MapPut("/pricing", async (PricingDocument document, ClaimsPrincipal principal, AccessService access, PricingService pricing, EndgameDbContext db, TenantSession session, CancellationToken ct) =>
            {
                await RequireOperatorAsync(principal, access, ct);
                var view = await pricing.SetAsync(document, principal.Id(), ct);
                // Prices apply to every organisation, so every Owner reads that FrostAura changed them.
                session.UseSystem();
                var organisations = await db.Organisations.AsNoTracking().Select(o => o.Id).ToListAsync(ct);
                foreach (var organisation in organisations)
                {
                    await access.LogActionAsync(principal.Id(), organisation, "pricing.changed",
                        new JsonObject { ["margin"] = document.Margin, ["creditsPerUsd"] = document.CreditsPerUsd }, ct);
                }

                return Results.Ok(view);
            })
            .WithName("SetPricing").WithSummary("Replaces the prices, at once and for every organisation, audited with what they were. The margin is a factor on cost: 1.0 is none, never below.").Produces<PricingView>();
    }

    private static async Task RequireOperatorAsync(ClaimsPrincipal principal, AccessService access, CancellationToken ct)
    {
        if (!await access.IsOperatorAsync(principal.Id(), ct))
        {
            throw EndgameProblem.Forbidden("Only FrostAura operators may do this.");
        }
    }

    private static async Task<ResolvedScope> OrganisationAsync(string slug, ScopeResolver scopes, CancellationToken ct)
    {
        var org = await scopes.RequireAsync(slug, ct);
        return org.Level == NodeLevel.Organisation ? org : throw EndgameProblem.Invalid("Name an organisation by its slug.");
    }
}
