using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Endgame.ControlPlane.Endpoints;

/// <param name="Role">At most the creator's own role in the organisation, never owner. Defaults to that role (admin for an Owner).</param>
/// <param name="ExpiresInDays">1 to 366; left out, the token lasts until it is revoked.</param>
public sealed record CreateTokenRequest(string? Name, string? Organisation, string? Role, int? ExpiresInDays);

public sealed record AskRequest(string? Question);

/// <param name="Chart">The chart spec from the answer: <c>{ kind, x, y[] }</c>.</param>
public sealed record SaveQuestionRequest(string? Question, string? Sql, JsonObject? Chart, string? Answer);

public sealed record ChangeRoleRequest(string? Role);

/// <param name="Organisation">Defaults to the caller's organisation.</param>
public sealed record TopUpAskRequest(string? Organisation, decimal Credits, string? Note);

/// <param name="Credits">How far below zero the balance may run for work at the scope: the organisation's own limit at the organisation (Owner), a narrower one beneath it (Admin).</param>
public sealed record OverdraftRequest(string? Scope, decimal Credits);

public sealed record SuggestRequest(string? Scope);

public sealed record TakeSuggestionRequest(IReadOnlyList<string>? Constraints);

public sealed record TopUpRequestView(Guid Id, string Organisation, string OrganisationName, decimal Credits, string Note, string Status, Guid RequestedBy, string? RequestedByEmail,
    DateTimeOffset RequestedAt, DateTimeOffset? ClosedAt, string? CloseNote, Guid? TopUpEntryId);

public sealed record SuggestionsStartedView(PublicRunView Run, IdeaEstimateView Estimate);

/// <summary>
/// Platform breadth for the console (build plan, Phases 4 and 5): access tokens for MCP clients,
/// asking about an app and its dashboard, version history, restore and export, runs by employee,
/// role changes, top-up requests and overdraft limits, notifications, and ideas from the portfolio.
/// </summary>
internal static class BreadthEndpoints
{
    public static void MapBreadth(this RouteGroupBuilder api)
    {
        MapTokens(api);
        MapAppBreadth(api);
        MapPeopleAndMoney(api);
        MapNotifications(api);
        MapSuggestions(api);
    }

    private static void MapTokens(RouteGroupBuilder api)
    {
        var tokens = api.MapGroup("/tokens").WithTags("Access tokens");
        tokens.MapGet("", async (ClaimsPrincipal principal, AccessTokenService service, CancellationToken ct) =>
                Results.Ok(await service.ListAsync(principal.Id(), ct)))
            .WithName("ListAccessTokens").WithSummary("Your personal access tokens for MCP clients, in every organisation, newest first, with when each was last used.")
            .Produces<IReadOnlyList<AccessTokenView>>();
        tokens.MapPost("", async (CreateTokenRequest request, ClaimsPrincipal principal, AccessTokenService service, CancellationToken ct) =>
            {
                var created = await service.CreateAsync(principal.Id(), request.Organisation, request.Name, request.Role, request.ExpiresInDays, ct);
                return Results.Created($"/api/tokens/{created.AccessToken.Id}", created);
            })
            .WithName("CreateAccessToken")
            .WithSummary("Makes a token for an MCP client: one organisation, a role no higher than yours there (never owner). The token is returned this once; only its hash is kept.")
            .Produces<AccessTokenCreated>(201);
        tokens.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessTokenService service, CancellationToken ct) =>
                Results.Ok(await service.RevokeAsync(principal.Id(), id, ct)))
            .WithName("RevokeAccessToken").WithSummary("Revokes one of your tokens; its next call is refused.").Produces<AccessTokenView>();
    }

    private static void MapAppBreadth(RouteGroupBuilder api)
    {
        var apps = api.MapGroup("/apps/{id:guid}").WithTags("Apps");
        apps.MapPost("/ask/estimate", async (Guid id, AskRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AskService ask, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Viewer, ct);
                return Results.Ok(await ask.EstimateAsync(app, request.Question, ct));
            })
            .WithName("EstimateAsk").WithSummary("The most asking this question about the app can cost, before anything is charged.").Produces<AskEstimate>();
        apps.MapPost("/ask", async (Guid id, AskRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AskService ask, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Builder, ct);
                return Results.Ok(await ask.AskAsync(app, request.Question, ct));
            })
            .WithName("AskAboutApp")
            .WithSummary("Answers a plain-language question from the app's own telemetry (requests, errors, latency, custom events): an answer, a chart and the read-only query behind it. Charged to the app.")
            .Produces<AskAnswer>();
        apps.MapGet("/dashboard", async (Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AskService ask, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Viewer, ct);
                return Results.Ok(await ask.DashboardAsync(app, ct));
            })
            .WithName("GetAppDashboard").WithSummary("The questions saved on the app's dashboard, each re-run now (no model is called).").Produces<IReadOnlyList<SavedQuestionView>>();
        apps.MapPost("/dashboard", async (Guid id, SaveQuestionRequest request, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AskService ask, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Builder, ct);
                var saved = await ask.SaveAsync(app, request.Question, request.Sql, request.Chart, request.Answer, principal.Id(), ct);
                return Results.Created($"/api/apps/{id}/dashboard/{saved.Id}", saved);
            })
            .WithName("SaveDashboardQuestion").WithSummary("Saves an answered question (its question, query and chart) on the app's dashboard.").Produces<SavedQuestionView>(201);
        apps.MapDelete("/dashboard/{questionId:guid}", async (Guid id, Guid questionId, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AskService ask, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Builder, ct);
                return await ask.RemoveAsync(app, questionId, ct) ? Results.NoContent() : Problems.From(EndgameProblem.NotFound("The saved question"));
            })
            .WithName("RemoveDashboardQuestion").WithSummary("Takes a question off the app's dashboard.");

        apps.MapGet("/versions", async (Guid id, int? skip, int? limit, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppVersionService versions, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Viewer, ct);
                return Results.Ok(await versions.ListAsync(app, skip ?? 0, limit ?? 50, ct));
            })
            .WithName("ListAppVersions").WithSummary("The app's version history, newest first: each change with who made it (an employee or a person), its message and time, and which one is live.")
            .Produces<AppVersionsView>();
        apps.MapPost("/versions/{commit}/restore", async (Guid id, string commit, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, ScopeResolver scopes,
                AppVersionService versions, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Builder, ct);
                var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
                return Results.Ok(await versions.RestoreAsync(app, commit, me, access.IsOperator(me) ? Actor.Operator : Actor.Member, ct));
            })
            .WithName("RestoreAppVersion")
            .WithSummary("Makes an earlier version the newest, as a new change by you (history is never rewritten), and republishes it. A public app becomes private until a person makes it public again.")
            .Produces<RestoreResult>();
        apps.MapPost("/republish", async (Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppVersionService versions, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Builder, ct);
                return Results.Ok(await versions.RepublishAsync(app, ct));
            })
            .WithName("RepublishApp")
            .WithSummary("Builds the app's newest version again and restarts it, when publishing it failed or the app stopped. The history and who may open it are unchanged.")
            .Produces<RestoreResult>();
        apps.MapGet("/export", async (Guid id, HttpContext http, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, AppVersionService versions, CancellationToken ct) =>
            {
                var app = await AppAsync(id, principal, access, scopes, MemberRole.Owner, ct);
                http.Response.StatusCode = 200;
                http.Response.ContentType = "application/gzip";
                http.Response.Headers.ContentDisposition = $"attachment; filename=\"{app.Node.Slug}-export.tar.gz\"";
                await versions.ExportAsync(app, http.Response.Body, ct);
            })
            .WithName("ExportApp")
            .WithSummary("The Owner downloads the app: code with its whole history, its data, and what the platform holds for it, as one archive (tar.gz). Free, at any time.")
            .Produces(200, contentType: "application/gzip");

        api.MapGet("/runs", async (string? scope, Guid? employeeId, string? kind, string? status, int? limit, ClaimsPrincipal principal, AccessService access, EmployeeService employees,
                RunService runs, ReadModels reads, ScopeResolver scopes, CancellationToken ct) =>
            {
                ResolvedScope at;
                var wherever = false;
                if (scope is null && employeeId is { } employee)
                {
                    // Wherever the employee worked in its organisation — a factory build sits where the idea was proposed,
                    // above the project its engineer was hired into — and only the runs the caller may see.
                    var record = await employees.RequireAsync(employee, ct);
                    await access.RequireAsync(principal.Id(), await employees.ScopeOfAsync(record, ct), MemberRole.Viewer, ct);
                    at = await scopes.ForRowAsync(record.OrganisationId, null, null, null, ct);
                    wherever = true;
                }
                else
                {
                    (at, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
                }

                var list = await runs.ListAsync(at, kind, status, Math.Clamp(limit ?? 20, 1, 100), ct, employeeId);
                var views = new List<PublicRunView>();
                foreach (var run in list)
                {
                    if (wherever && !await SeesAsync(access, scopes, principal.Id(), run.Scope, ct))
                    {
                        continue;
                    }

                    views.Add(await reads.RunAsync(at.OrganisationId, run.Id, ct));
                }

                return Results.Ok(views);
            })
            .WithTags("Runs").WithName("ListRuns")
            .WithSummary("Runs at a scope and beneath it, newest first (at most 100), optionally only the ones an employee worked in — its own, one it claimed a task in, or one with a model call charged to it (employeeId alone: wherever in its organisation, as far as the caller may see).")
            .Produces<IReadOnlyList<PublicRunView>>();
    }

    private static void MapPeopleAndMoney(RouteGroupBuilder api)
    {
        api.MapPatch("/members/{membershipId:guid}", async (Guid membershipId, ChangeRoleRequest request, ClaimsPrincipal principal, AccessService access, AccountService accounts,
                ScopeResolver scopes, UserManager<EndgameUser> users, CancellationToken ct) =>
            {
                MemberRole role;
                try
                {
                    role = MemberRoles.FromWire(request.Role);
                }
                catch (Domain.DomainException ex)
                {
                    throw EndgameProblem.Invalid(ex.Message);
                }

                var (_, membership) = await accounts.MembershipAsync(membershipId, ct);
                var scope = await scopes.ForRowAsync(membership.OrganisationId, membership.DivisionId, membership.ProjectId, membership.AppId, ct);
                // Admins are the Owner's to make and unmake (spec, roles).
                var needed = role == MemberRole.Admin || membership.Role == MemberRole.Admin.ToWire() ? MemberRole.Owner : MemberRole.Admin;
                var mine = await access.RequireAsync(principal.Id(), scope, needed, ct);
                var person = await users.FindByIdAsync(membership.UserId.ToString()) ?? throw EndgameProblem.NotFound("The member");
                return Results.Ok(await accounts.GrantAsync(scope, mine, person.Email ?? "", null, role, principal.Id(), ct));
            })
            .WithTags("Members").WithName("ChangeRole").WithSummary("Changes the role of one grant, where it was set (Admin; to or from Admin, the Owner).").Produces<Invitation>();

        var requests = api.MapGroup("/credits/top-up-requests").WithTags("Credits");
        requests.MapPost("", async (TopUpAskRequest request, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session, TimeProvider clock, CancellationToken ct) =>
            {
                var slug = request.Organisation ?? (await access.MembershipsOfAsync(principal.Id(), ct)).FirstOrDefault()?.OrganisationSlug;
                var (org, _) = await access.RequireAsync(principal.Id(), slug, MemberRole.Owner, ct);
                if (org.Level != NodeLevel.Organisation)
                {
                    throw EndgameProblem.Invalid("A top-up is asked for by an organisation; pass its slug.");
                }

                if (request.Credits <= 0 || request.Credits > 10_000_000 || decimal.Round(request.Credits, 6) != request.Credits)
                {
                    throw EndgameProblem.Invalid("Ask for a positive number of credits.");
                }

                session.UseOrganisation(org.OrganisationId);
                if (await db.TopUpRequests.CountAsync(r => r.OrganisationId == org.OrganisationId && r.Status == TopUpRequestStatuses.Open, ct) >= 5)
                {
                    throw EndgameProblem.Conflict("Five requests are already open; FrostAura answers them first.");
                }

                var record = new TopUpRequestRecord
                {
                    Id = Guid.NewGuid(),
                    OrganisationId = org.OrganisationId,
                    Credits = request.Credits,
                    Note = (request.Note ?? "").Trim() is { Length: > 500 } n ? n[..500] : (request.Note ?? "").Trim(),
                    Status = TopUpRequestStatuses.Open,
                    RequestedBy = principal.Id(),
                    RequestedAt = clock.GetUtcNow(),
                };
                db.TopUpRequests.Add(record);
                await db.SaveChangesAsync(ct);
                return Results.Created($"/api/credits/top-up-requests/{record.Id}", (await TopUpRequestViewsAsync(db, session, r => r.Id == record.Id, ct)).Single());
            })
            .WithName("RequestTopUp").WithSummary("The Owner asks FrostAura for a top-up. No payment is taken; it appears to operators, who top up by hand.").Produces<TopUpRequestView>(201);
        requests.MapGet("", async (string? organisation, ClaimsPrincipal principal, AccessService access, EndgameDbContext db, TenantSession session, CancellationToken ct) =>
            {
                var slug = organisation ?? (await access.MembershipsOfAsync(principal.Id(), ct)).FirstOrDefault()?.OrganisationSlug;
                var (org, _) = await access.RequireAsync(principal.Id(), slug, MemberRole.Admin, ct);
                return Results.Ok(await TopUpRequestViewsAsync(db, session, r => r.OrganisationId == org.OrganisationId, ct));
            })
            .WithName("ListTopUpRequests").WithSummary("The organisation's top-up requests and how each was answered (Admin and above).").Produces<IReadOnlyList<TopUpRequestView>>();

        api.MapPut("/credits/overdraft", async (OverdraftRequest request, ClaimsPrincipal principal, UserManager<EndgameUser> users, AccessService access, CascadeService cascade,
                ReadModels reads, EdgeNotifier edge, CancellationToken ct) =>
            {
                var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Viewer, ct);
                var key = scope.Level == NodeLevel.Organisation ? CascadeKeys.OverdraftOwnLimit : CascadeKeys.OverdraftLimit;
                await access.RequireAsync(principal.Id(), scope, scope.Level == NodeLevel.Organisation ? MemberRole.Owner : MemberRole.Admin, ct);
                var me = await users.GetUserAsync(principal) ?? throw EndgameProblem.Unauthenticated();
                await cascade.SetAsync(scope, CascadeKind.Setting, key, JsonValue.Create(request.Credits), me.Id, access.IsOperator(me) ? Actor.Operator : Actor.Member, ct);
                edge.RoutesChanged();
                return Results.Ok(await reads.CreditsAsync(scope, ct));
            })
            .WithTags("Credits").WithName("SetOverdraftLimit")
            .WithSummary("Sets a tighter overdraft: the organisation's own limit (Owner), or a narrower one for a division, project or app (Admin). Never deeper than what applies above. Returns the credits view.")
            .Produces<CreditsView>();
    }

    private static void MapNotifications(RouteGroupBuilder api)
    {
        var notifications = api.MapGroup("/notifications").WithTags("Notifications");
        notifications.MapGet("", async (string? organisation, bool? unread, int? limit, ClaimsPrincipal principal, NotificationService service, CancellationToken ct) =>
                Results.Ok(await service.FeedAsync(principal.Id(), organisation, unread ?? false, limit ?? 50, ct)))
            .WithName("ListNotifications")
            .WithSummary("What needs you in the organisation, newest first: verdicts, approvals, hires, budgets at 80% and at their cap, the balance at zero and on the way to the overdraft limit, crashed apps, security findings (Admin and above, where your grant covers it).")
            .Produces<NotificationFeed>();
        notifications.MapPost("/{id:guid}/read", async (Guid id, ClaimsPrincipal principal, NotificationService service, CancellationToken ct) =>
            {
                await service.MarkReadAsync(principal.Id(), id, ct);
                return Results.NoContent();
            })
            .WithName("MarkNotificationRead").WithSummary("Marks one notification read, for you.");
        notifications.MapPost("/read-all", async (string? organisation, ClaimsPrincipal principal, NotificationService service, CancellationToken ct) =>
                Results.Ok(new { marked = await service.MarkAllReadAsync(principal.Id(), organisation, ct) }))
            .WithName("MarkAllNotificationsRead").WithSummary("Marks everything in your feed read.");
    }

    private static void MapSuggestions(RouteGroupBuilder api)
    {
        var suggestions = api.MapGroup("/ideas/suggestions").WithTags("Ideas");
        suggestions.MapPost("/estimate", async (SuggestRequest request, ClaimsPrincipal principal, AccessService access, SuggestionService service, ResearchEstimator estimator, CancellationToken ct) =>
            {
                var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Builder, ct);
                var estimate = await estimator.SuggestionsAsync(scope.OrganisationId, await service.ContextSizeAsync(scope, ct), ct);
                return Results.Ok(new IdeaEstimateView(estimate.Credits, estimate.Basis));
            })
            .WithName("EstimateSuggestions").WithSummary("The most suggesting ideas from the portfolio at a scope can cost, before anything is charged.").Produces<IdeaEstimateView>();
        suggestions.MapPost("", async (SuggestRequest request, ClaimsPrincipal principal, AccessService access, SuggestionService service, ResearchEstimator estimator, ReadModels reads, CancellationToken ct) =>
            {
                var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Builder, ct);
                var estimate = await estimator.SuggestionsAsync(scope.OrganisationId, await service.ContextSizeAsync(scope, ct), ct);
                var started = await service.StartAsync(scope, estimate, principal.Id(), ct);
                return Results.Created($"/api/runs/{started.Run.Id}",
                    new SuggestionsStartedView(await reads.RunAsync(scope.OrganisationId, started.Run.Id, ct), new IdeaEstimateView(estimate.Credits, estimate.Basis)));
            })
            .WithName("SuggestIdeas")
            .WithSummary("Queues a run that reads the organisation's ontology and products and proposes up to five ideas, each with the gap it fills, why this organisation, and what it would reuse. Estimate first, in the run's log.")
            .Produces<SuggestionsStartedView>(201);
        suggestions.MapGet("", async (string? scope, ClaimsPrincipal principal, AccessService access, SuggestionService service, CancellationToken ct) =>
            {
                var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
                return Results.Ok(await service.ListAsync(resolved, ct));
            })
            .WithName("ListSuggestions").WithSummary("Suggested ideas at the scope and beneath it, newest first: open, taken (became an idea) or dismissed.").Produces<IReadOnlyList<SuggestionView>>();
        suggestions.MapPost("/{id:guid}/take", async (Guid id, HttpRequest http, ClaimsPrincipal principal, AccessService access, SuggestionService service, ResearchEstimator estimator,
                ReadModels reads, CancellationToken ct) =>
            {
                var request = http.HasJsonContentType() && (http.ContentLength is > 0 || http.Headers.TransferEncoding.Count > 0) ? await http.ReadFromJsonAsync<TakeSuggestionRequest>(ct) : null;
                var (suggestion, scope) = await service.RequireAsync(id, ct);
                await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
                var estimate = await estimator.ResearchAsync(scope.OrganisationId, SuggestionService.IdeaText(suggestion), request?.Constraints, ct);
                var started = await service.TakeAsync(id, request?.Constraints, estimate, principal.Id(), ct);
                return Results.Created($"/api/ideas/{started.Idea.Id}", await reads.IdeaAsync(scope.OrganisationId, started.Idea.Id, ct));
            })
            .WithName("TakeSuggestion").WithSummary("Turns a suggestion into an idea in one click; its research is queued with its estimate, like any other idea.")
            .Accepts<TakeSuggestionRequest>("application/json").Produces<PublicIdeaView>(201);
        suggestions.MapPost("/{id:guid}/dismiss", async (Guid id, ClaimsPrincipal principal, AccessService access, SuggestionService service, CancellationToken ct) =>
            {
                var (_, scope) = await service.RequireAsync(id, ct);
                await access.RequireAsync(principal.Id(), scope, MemberRole.Builder, ct);
                return Results.Ok(await service.DismissAsync(id, principal.Id(), ct));
            })
            .WithName("DismissSuggestion").WithSummary("Sets a suggestion aside.").Produces<SuggestionView>();
    }

    public static async Task<ResolvedScope> AppAsync(Guid id, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, MemberRole role, CancellationToken ct)
    {
        var app = await scopes.FindNodeAsync(NodeLevel.App, id, ct) ?? throw EndgameProblem.NotFound("The app");
        await access.RequireAsync(principal.Id(), app, role, ct);
        return app;
    }

    public static async Task<IReadOnlyList<TopUpRequestView>> TopUpRequestViewsAsync(EndgameDbContext db, TenantSession session, System.Linq.Expressions.Expression<Func<TopUpRequestRecord, bool>> filter, CancellationToken ct)
    {
        session.UseSystem();
        var rows = await (from r in db.TopUpRequests.AsNoTracking().Where(filter)
                          join o in db.Organisations.AsNoTracking() on r.OrganisationId equals o.Id
                          join u in db.Users.AsNoTracking() on r.RequestedBy equals u.Id into people
                          from u in people.DefaultIfEmpty()
                          orderby r.RequestedAt descending
                          select new TopUpRequestView(r.Id, o.Slug, o.Name, r.Credits, r.Note, r.Status, r.RequestedBy, u == null ? null : u.Email, r.RequestedAt, r.ClosedAt, r.CloseNote, r.TopUpEntryId))
            .Take(200).ToListAsync(ct);
        session.Clear();
        return rows;
    }

    private static async Task<bool> SeesAsync(AccessService access, ScopeResolver scopes, Guid userId, string scope, CancellationToken ct)
    {
        try
        {
            await access.RequireAsync(userId, await scopes.RequireAsync(scope, ct), MemberRole.Viewer, ct);
            return true;
        }
        catch (EndgameProblem problem) when (problem.Status is 403 or 404)
        {
            return false;
        }
    }
}
