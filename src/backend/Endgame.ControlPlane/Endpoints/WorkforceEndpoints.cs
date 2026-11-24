using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Runs;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Runs;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Work;

namespace Endgame.ControlPlane.Endpoints;

/// <summary><c>POST /internal/employees</c>: the factory's own direct hire. <c>jobDescription</c> (a string) is the mandate, kept for older callers.</summary>
public sealed record HireRequest(string? Scope, string? Name, string? Role, string? JobDescription, string? Mandate, IReadOnlyList<string>? Tools, IReadOnlyList<string>? Services, decimal? MonthlyCreditLimit, string? ModelTier, Guid? ReportsTo);

/// <summary>A hire proposal raised by the Runner (<c>POST /internal/hires</c>) or the owner (<c>POST /api/hires</c>).</summary>
public sealed record HireProposalRequest(
    string? Scope,
    string? Trigger,
    string? NeedKey,
    string? Reason,
    string? Name,
    string? Role,
    JobDescriptionInput? JobDescription,
    Guid? ReportsTo,
    decimal? ExpectedMonthlyCredits,
    string? ContractorRole,
    Guid? RunId);

/// <summary><c>PATCH /api/hires/{id}</c>: edits before the decision. Fields left out are kept.</summary>
public sealed record HireEditRequest(string? Reason, string? Name, string? Role, JobDescriptionInput? JobDescription, Guid? ReportsTo, bool? ClearReportsTo, decimal? ExpectedMonthlyCredits);

public sealed record HireDecisionRequest(string? Note);

/// <summary><c>PATCH /api/employees/{id}</c>. Fields left out are kept; <c>status</c> is <c>paused</c> or <c>idle</c> (resume).</summary>
public sealed record EmployeePatchRequest(string? Name, string? Role, JobDescriptionInput? JobDescription, Guid? ReportsTo, bool? ClearReportsTo, bool? ClearMonthlyCreditLimit, string? Status);

public sealed record ReassignRequest(string? Scope, Guid? ReportsTo);

public sealed record RehireRequest(string? Scope);

public sealed record MemoryWriteRequest(Guid? RunId, IReadOnlyList<MemoryInput>? Entries);

public sealed record MemoryReviewRequest(Guid? RunId, IReadOnlyList<MemoryMerge>? Merged, IReadOnlyList<MemoryRemoval>? Removed, IReadOnlyList<MemoryReviewCorrection>? Corrected);

public sealed record ContractorRequest(string? Scope, Guid? BriefedBy, string? Role, string? Name, string? Brief, Guid? RunId, decimal? MonthlyCreditLimit);

public sealed record ContractorFinishRequest(Guid? RunId, IReadOnlyList<MemoryInput>? Learned);

public sealed record ContractorFinished(EmployeeView Contractor, IReadOnlyList<MemoryEntryView> Learned, HireView? Promotion);

/// <summary>The workforce (spec, <i>Workforce</i>): employees, hire proposals, curated memory, track records, contractors and the ontology.</summary>
internal static class WorkforceEndpoints
{
    public static void MapWorkforceInternal(this RouteGroupBuilder group)
    {
        group.MapPost("/employees", async (HireRequest request, ScopeResolver scopes, EmployeeService employees, CancellationToken ct) =>
        {
            var scope = await scopes.RequireAsync(request.Scope, ct);
            var employee = await employees.HireAsync(scope, request.Name ?? "", request.Role ?? "",
                new JobDescriptionInput(request.Mandate ?? request.JobDescription, request.Tools, request.Services, request.MonthlyCreditLimit, request.ModelTier), request.ReportsTo, ct);
            return Results.Created($"/internal/employees/{employee.Id}", employee);
        })
        .WithName("HireEmployee").WithSummary("The factory's direct hire: an employee at a node with its job description. Needs go through POST /internal/hires.").Produces<EmployeeView>(201);

        group.MapGet("/employees", async (string? scope, bool? includeReleased, string? kind, ScopeResolver scopes, EmployeeService employees, CancellationToken ct) =>
            Results.Ok(await employees.ListAsync(await scopes.RequireAsync(scope, ct), includeReleased ?? false, ct, kind)))
        .WithName("ListEmployees").WithSummary("The workforce at the scope and beneath it: employees, and contractors while they work.").Produces<IReadOnlyList<EmployeeView>>();

        group.MapGet("/employees/{id:guid}", async (Guid id, EmployeeService employees, CancellationToken ct) =>
        {
            var employee = await employees.RequireAsync(id, ct);
            return Results.Ok(await employees.DetailAsync(employee.OrganisationId, id, ct));
        })
        .WithName("GetEmployeeInternal").WithSummary("An employee with its job description, track record, working contractors and reports.").Produces<EmployeeDetailView>();

        group.MapGet("/employees/recurring-roles", async (string? scope, ScopeResolver scopes, EmployeeService employees, CancellationToken ct) =>
            Results.Ok(await employees.RecurringRolesAsync(await scopes.RequireAsync(scope, ct), ct)))
        .WithName("RecurringRolesInternal").WithSummary("Contractor roles that keep recurring at a node with no employee in them: candidates for a permanent hire.").Produces<IReadOnlyList<RecurringRoleView>>();

        group.MapPost("/hires", async (HireProposalRequest request, ScopeResolver scopes, HireService hires, CancellationToken ct) =>
        {
            var scope = await scopes.RequireAsync(request.Scope, ct);
            var raised = await hires.RaiseAsync(scope, Input(request), null, request.RunId, ct);
            return raised.Created ? Results.Created($"/api/hires/{raised.Hire.Id}", raised) : Results.Ok(raised);
        })
        .WithName("RaiseHireInternal")
        .WithSummary("The Runner raises a need from the ontology: a hire proposal (201), or the open one for the same needKey (200). In auto-mode one within budget is accepted at once.")
        .Produces<HireRaised>(201).Produces<HireRaised>();

        group.MapGet("/employees/{id:guid}/memory", async (Guid id, string? scope, ScopeResolver scopes, EmployeeService employees, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await employees.RequireAsync(id, ct);
            var at = scope is null ? null : await scopes.RequireAsync(scope, ct);
            return Results.Ok(await memory.ForScopeAsync(employee.OrganisationId, id, at, includeArchived: false, ct));
        })
        .WithName("ReadMemoryForRun").WithSummary("What the employee remembers that bears on a scope (at it, above it or beneath it), at most 200 entries: read before each task.").Produces<IReadOnlyList<MemoryEntryView>>();

        group.MapPost("/employees/{id:guid}/memory", async (Guid id, MemoryWriteRequest request, EmployeeService employees, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await employees.RequireAsync(id, ct);
            var added = await memory.AddAsync(employee.OrganisationId, id, request.RunId, request.Entries ?? [], MemoryActors.Employee, null, ct);
            return Results.Created($"/internal/employees/{id}/memory", added);
        })
        .WithName("WriteMemory").WithSummary("After a task, the employee records what it learned: 1 to 20 entries {title, body, kind, scope?}, attributed to the run.").Produces<IReadOnlyList<MemoryEntryView>>(201);

        group.MapPost("/employees/{id:guid}/memory/review", async (Guid id, MemoryReviewRequest request, EmployeeService employees, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await employees.RequireAsync(id, ct);
            return Results.Ok(await memory.ReviewAsync(employee.OrganisationId, id, request.RunId, request.Merged ?? [], request.Removed ?? [], request.Corrected ?? [], ct));
        })
        .WithName("ApplyMemoryReview").WithSummary("A review run's result: entries merged, removed and corrected (each with why), applied at once; the rest stamped as reviewed.").Produces<MemoryReviewResult>();

        group.MapPost("/contractors", async (ContractorRequest request, ScopeResolver scopes, EmployeeService employees, CancellationToken ct) =>
        {
            if (request.BriefedBy is not { } briefer)
            {
                throw EndgameProblem.Invalid("A contractor is briefed by an employee: send briefedBy.");
            }

            var scope = await scopes.RequireAsync(request.Scope, ct);
            var contractor = await employees.StartContractorAsync(scope, briefer, request.Role ?? "", request.Name, request.Brief ?? "", request.RunId, request.MonthlyCreditLimit, ct);
            return Results.Created($"/internal/employees/{contractor.Id}", contractor);
        })
        .WithName("StartContractor").WithSummary("A contractor briefed by an employee, working at the brief's scope: on the chart while it works. Its model calls carry its id.").Produces<EmployeeView>(201);

        group.MapPost("/contractors/{id:guid}/finish", async (Guid id, ContractorFinishRequest request, EmployeeService employees, HireService hires, CancellationToken ct) =>
        {
            var contractor = await employees.RequireAsync(id, ct);
            var (done, learned, promotion) = await hires.FinishContractorAsync(contractor.OrganisationId, id, request.Learned ?? [], request.RunId, ct);
            return Results.Ok(new ContractorFinished(done, learned, promotion));
        })
        .WithName("FinishContractor").WithSummary("The contractor is done: gone from the chart, what it learned written to its briefer's memory, and a role that keeps recurring proposed as a hire.").Produces<ContractorFinished>();

        group.MapGet("/ontology", async (string? scope, string? view, ScopeResolver scopes, OntologyService ontology, CancellationToken ct) =>
            Results.Ok(await ontology.BuildAsync(await scopes.RequireAsync(scope, ct), view, ct)))
        .WithName("GetOntologyInternal").WithSummary("The organisation graph at a scope, for the Runner's hiring triggers.").Produces<OntologyView>();
    }

    public static void MapWorkforce(this RouteGroupBuilder api)
    {
        var employees = api.MapGroup("/employees").WithTags("Workforce");
        employees.MapGet("", async (string? scope, bool? includeReleased, string? kind, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await service.ListAsync(resolved, includeReleased ?? false, ct, kind));
        })
        .WithName("ListWorkforce").WithSummary("Employees at the scope and beneath it, with contractors while they work; released ones when includeReleased=true.").Produces<IReadOnlyList<EmployeeView>>();

        employees.MapGet("/recurring-roles", async (string? scope, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await service.RecurringRolesAsync(resolved, ct));
        })
        .WithName("RecurringRoles").WithSummary("Contractor roles that keep recurring with no employee in them — each is proposed as a hire when its contractor finishes.").Produces<IReadOnlyList<RecurringRoleView>>();

        employees.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Viewer, ct);
            return Results.Ok(await service.DetailAsync(employee.OrganisationId, id, ct));
        })
        .WithName("GetEmployee").WithSummary("An employee: its job description, place on the chart, status, idle flag, track record, working contractors and reports.").Produces<EmployeeDetailView>();

        employees.MapGet("/{id:guid}/track-record", async (Guid id, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Viewer, ct);
            return Results.Ok(await service.TrackRecordAsync(employee.OrganisationId, id, ct));
        })
        .WithName("GetTrackRecord").WithSummary("Work accepted and sent back, runs, repairs not charged, cost to date and this month, contractors and estimate accuracy — derived, never counted.").Produces<TrackRecordView>();

        employees.MapPatch("/{id:guid}", async (Guid id, EmployeePatchRequest request, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Admin, ct);
            return Results.Ok(await service.UpdateAsync(employee.OrganisationId, id, request.Name, request.Role, request.JobDescription, request.ReportsTo,
                request.ClearReportsTo ?? false, request.ClearMonthlyCreditLimit ?? false, request.Status, ct));
        })
        .WithName("UpdateEmployee").WithSummary("Changes the name, role, job description (mandate, tools, services, budget, model tier) or manager, or pauses and resumes (Admin and above).").Produces<EmployeeView>();

        employees.MapPost("/{id:guid}/reassign", async (Guid id, ReassignRequest request, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Admin, ct);
            var (to, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Admin, ct);
            return Results.Ok(await service.ReassignAsync(employee.OrganisationId, id, to, request.ReportsTo, ct));
        })
        .WithName("ReassignEmployee").WithSummary("Moves an employee to another node (Admin at both); its memory travels with it.").Produces<EmployeeView>();

        employees.MapPost("/{id:guid}/release", async (Guid id, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Admin, ct);
            return Results.Ok(await service.ReleaseAsync(employee.OrganisationId, id, ct));
        })
        .WithName("ReleaseEmployee").WithSummary("Lets an employee go: off the chart and the bill, its memory archived so a rehire starts warm. A standing hire is never released (409 standing_hire).").Produces<EmployeeView>();

        employees.MapPost("/{id:guid}/rehire", async (Guid id, HttpRequest http, ClaimsPrincipal principal, AccessService access, EmployeeService service, CancellationToken ct) =>
        {
            var request = await OptionalAsync<RehireRequest>(http, ct);
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Admin, ct);
            var to = request?.Scope is { } scope ? (await access.RequireAsync(principal.Id(), scope, MemberRole.Admin, ct)).Scope : null;
            return Results.Ok(await service.RehireAsync(employee.OrganisationId, id, to, ct));
        })
        .WithName("RehireEmployee").WithSummary("Brings a released employee back, optionally somewhere else, with its memory restored.").Accepts<RehireRequest>("application/json").Produces<EmployeeView>();

        employees.MapGet("/{id:guid}/memory", async (Guid id, string? scope, bool? includeArchived, ClaimsPrincipal principal, AccessService access, ScopeResolver scopes, EmployeeService service, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Viewer, ct);
            var at = scope is null ? null : await scopes.RequireAsync(scope, ct);
            return Results.Ok(await memory.ForScopeAsync(employee.OrganisationId, id, at, includeArchived ?? false, ct));
        })
        .WithName("ReadMemory").WithSummary("The employee's curated memory, most recently reviewed or written first; archived entries too with includeArchived=true.").Produces<IReadOnlyList<MemoryEntryView>>();

        employees.MapPost("/{id:guid}/memory", async (Guid id, MemoryInput request, ClaimsPrincipal principal, AccessService access, EmployeeService service, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Builder, ct);
            var added = await memory.AddAsync(employee.OrganisationId, id, null, [request], MemoryActors.Person, principal.Id(), ct);
            return Results.Created($"/api/employees/{id}/memory/{added[0].Id}", added[0]);
        })
        .WithName("AddMemory").WithSummary("A person adds an entry {title, body, kind, scope?} to the employee's memory.").Produces<MemoryEntryView>(201);

        employees.MapPatch("/{id:guid}/memory/{entryId:guid}", async (Guid id, Guid entryId, MemoryCorrection request, ClaimsPrincipal principal, AccessService access, EmployeeService service, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Builder, ct);
            return Results.Ok(await memory.CorrectAsync(employee.OrganisationId, id, entryId, request, principal.Id(), ct));
        })
        .WithName("CorrectMemory").WithSummary("A person corrects an entry; the change log keeps what it said before.").Produces<MemoryEntryView>();

        employees.MapDelete("/{id:guid}/memory/{entryId:guid}", async (Guid id, Guid entryId, string? why, ClaimsPrincipal principal, AccessService access, EmployeeService service, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Builder, ct);
            await memory.RemoveAsync(employee.OrganisationId, id, entryId, why, principal.Id(), ct);
            return Results.NoContent();
        })
        .WithName("RemoveMemory").WithSummary("A person removes an entry; the change log keeps it.");

        employees.MapGet("/{id:guid}/memory/changes", async (Guid id, int? limit, ClaimsPrincipal principal, AccessService access, EmployeeService service, MemoryService memory, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Viewer, ct);
            return Results.Ok(await memory.ChangesAsync(employee.OrganisationId, id, limit ?? 100, ct));
        })
        .WithName("MemoryChanges").WithSummary("The memory's change log, newest first: what was added, corrected, merged, removed, archived and restored, by whom, and why.").Produces<IReadOnlyList<MemoryChangeView>>();

        employees.MapPost("/{id:guid}/reviews", async (Guid id, ClaimsPrincipal principal, AccessService access, EmployeeService service, RunService runs, ReadModels reads, CancellationToken ct) =>
        {
            var employee = await RequireAsync(id, principal, access, service, MemberRole.Builder, ct);
            if (employee.Status == EmployeeStatuses.Released || employee.Kind != EmployeeKinds.Employee)
            {
                throw EndgameProblem.Conflict("Only an employee on the payroll has a memory to review.");
            }

            var scope = await service.ScopeOfAsync(employee, ct);
            var run = await runs.CreateAsync(scope, RunKinds.Review, $"Memory review: {employee.Name}", id, null, null, null, principal.Id(), ct);
            await runs.AppendAsync(employee.OrganisationId, run.Id, [new NewEvent(RunEventTypes.Message, new JsonObject
            {
                ["from"] = "owner",
                ["kind"] = "memory.review",
                ["employeeId"] = id.ToString(),
                ["text"] = $"Review {employee.Name}'s memory: merge what repeats, remove what is stale, correct what is wrong, then report it.",
            })], null, principal.Id(), ct);
            return Results.Created($"/api/runs/{run.Id}", await reads.RunAsync(employee.OrganisationId, run.Id, ct));
        })
        .WithName("ReviewMemory").WithSummary("Queues a performance review of the employee's memory: a review run that consolidates, prunes and corrects it.").Produces<PublicRunView>(201);

        var hires = api.MapGroup("/hires").WithTags("Workforce");
        hires.MapGet("", async (string? scope, string? status, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await service.ListAsync(resolved, status, ct));
        })
        .WithName("ListHires").WithSummary("Hire proposals at the scope and beneath it, newest first (status proposed, accepted or declined).").Produces<IReadOnlyList<HireView>>();

        hires.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Viewer, ct);
            return Results.Ok(await service.GetAsync(org, id, ct));
        })
        .WithName("GetHire").WithSummary("One hire proposal: the drafted job description, expected monthly cost, why, and whether it fits the budget now.").Produces<HireView>();

        hires.MapPost("", async (HireProposalRequest request, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var (scope, _) = await access.RequireAsync(principal.Id(), request.Scope, MemberRole.Admin, ct);
            var raised = await service.RaiseAsync(scope, Input(request) with { Trigger = request.Trigger ?? HireTriggers.Owner }, principal.Id(), null, ct);
            return raised.Created ? Results.Created($"/api/hires/{raised.Hire.Id}", raised.Hire) : Results.Ok(raised.Hire);
        })
        .WithName("RaiseHire").WithSummary("The owner raises a need for a hire. In auto-mode, one within budget is accepted at once; otherwise it waits in needsYou.").Produces<HireView>(201);

        hires.MapPatch("/{id:guid}", async (Guid id, HireEditRequest request, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Admin, ct);
            return Results.Ok(await service.EditAsync(org, id, new HireInput(null, null, request.Reason, request.Name, request.Role, request.JobDescription, request.ReportsTo, request.ExpectedMonthlyCredits, null),
                request.ClearReportsTo ?? false, ct));
        })
        .WithName("EditHire").WithSummary("Edits an open proposal: name, role, job description, manager, expected cost or reason.").Produces<HireView>();

        hires.MapPost("/{id:guid}/accept", async (Guid id, HttpRequest http, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var note = (await OptionalAsync<HireDecisionRequest>(http, ct))?.Note;
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Admin, ct);
            return Results.Ok(await service.AcceptAsync(org, id, principal.Id(), IdeaDecisions.ByPerson, null, note, ct));
        })
        .WithName("AcceptHire").WithSummary("Accepts a proposal: the employee is hired with its job description; the proposal names it (employeeId).").Accepts<HireDecisionRequest>("application/json").Produces<HireView>();

        hires.MapPost("/{id:guid}/decline", async (Guid id, HttpRequest http, ClaimsPrincipal principal, AccessService access, HireService service, CancellationToken ct) =>
        {
            var note = (await OptionalAsync<HireDecisionRequest>(http, ct))?.Note;
            var org = await service.OrganisationOfAsync(id, ct);
            await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(org, id, ct), MemberRole.Admin, ct);
            return Results.Ok(await service.DeclineAsync(org, id, principal.Id(), note, ct));
        })
        .WithName("DeclineHire").WithSummary("Declines a proposal. The same need may be raised again later.").Accepts<HireDecisionRequest>("application/json").Produces<HireView>();

        api.MapGet("/ontology", async (string? scope, string? view, ClaimsPrincipal principal, AccessService access, OntologyService ontology, CancellationToken ct) =>
        {
            var (resolved, _) = await access.RequireAsync(principal.Id(), scope, MemberRole.Viewer, ct);
            return Results.Ok(await ontology.BuildAsync(resolved, view, ct));
        })
        .WithTags("Workforce").WithName("GetOntology")
        .WithSummary("The organisation at and beneath a scope as a graph: nodes and typed edges (owns, works-on, reports-to, depends-on, data-flows-to), for the org-chart and data-flow views (view=org-chart|data-flow|all).")
        .Produces<OntologyView>();
    }

    /// <summary>An optional JSON body: read when one was sent (with a length or chunked), null when there is none.</summary>
    private static async Task<T?> OptionalAsync<T>(HttpRequest http, CancellationToken ct)
        where T : class =>
        http.HasJsonContentType() && (http.ContentLength is > 0 || http.Headers.TransferEncoding.Count > 0) ? await http.ReadFromJsonAsync<T>(ct) : null;

    private static HireInput Input(HireProposalRequest r) =>
        new(r.Trigger, r.NeedKey, r.Reason, r.Name, r.Role, r.JobDescription, r.ReportsTo, r.ExpectedMonthlyCredits, r.ContractorRole);

    private static async Task<EmployeeRecord> RequireAsync(Guid id, ClaimsPrincipal principal, AccessService access, EmployeeService service, MemberRole role, CancellationToken ct)
    {
        var employee = await service.RequireAsync(id, ct);
        await access.RequireAsync(principal.Id(), await service.ScopeOfAsync(employee, ct), role, ct);
        return employee;
    }
}
