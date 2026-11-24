using System.Text.Json.Nodes;

namespace Endgame.Application.Gateway;

/// <summary>Who a model call is charged to: the whole cascade path, the employee and the run.</summary>
public sealed record Attribution(
    Guid OrganisationId,
    Guid? DivisionId,
    Guid? ProjectId,
    Guid? AppId,
    Guid? EmployeeId,
    Guid? RunId,
    string ScopePath,
    DateTimeOffset? RunLeaseExpiresAt);

public sealed record ReservationRequest(
    Attribution Attribution,
    string TaskType,
    string Models,
    decimal Credits,
    decimal WorstCaseUsd,
    bool Billable,
    DateTimeOffset ExpiresAt,
    string? IdempotencyKey,
    decimal? AppMonthlyCap = null);

public abstract record Admission;

public sealed record Admitted(Guid ReservationId, decimal Credits) : Admission;

/// <summary>
/// The call does not fit. <paramref name="BindingScope"/> says which cap refused it; <paramref name="Code"/>
/// is <see cref="Refusals.BudgetExhausted"/> for a budget or <see cref="Refusals.OverdraftLimit"/> when the
/// organisation's balance has reached its overdraft limit. Both are terminal.
/// </summary>
public sealed record Refused(string Reason, string BindingScope, decimal Headroom, decimal Needed, string Code = Refusals.BudgetExhausted) : Admission;

public static class Refusals
{
    public const string BudgetExhausted = "budget_exhausted";
    public const string OverdraftLimit = "overdraft_limit";
}

public sealed record Settlement(Guid OrganisationId, Guid ReservationId, decimal Credits, decimal CostUsd, string? Model, string? GenerationId, string? Note);

/// <summary>Port: the one ledger. Admission reserves in the same transaction that decides.</summary>
public interface ICreditLedger
{
    Task<Admission> AdmitAsync(ReservationRequest request, CancellationToken cancellationToken);

    Task SettleAsync(Settlement settlement, CancellationToken cancellationToken);

    Task ReleaseAsync(Guid organisationId, Guid reservationId, string reason, CancellationToken cancellationToken);
}

/// <summary>Port: what the gateway needs from the tree and the run log.</summary>
public interface IGatewayContext
{
    /// <summary>Resolves the scope, and checks the run and employee belong to it. Throws a problem otherwise.</summary>
    Task<Attribution> ResolveAsync(string scope, Guid? runId, Guid? employeeId, CancellationToken cancellationToken);

    /// <summary>Records that the run hit its budget. Every later call for it is refused at once.</summary>
    Task MarkBudgetExhaustedAsync(Guid organisationId, Guid runId, CancellationToken cancellationToken);

    Task AppendEventAsync(Guid organisationId, Guid runId, string type, JsonObject payload, CancellationToken cancellationToken);
}

/// <summary>One complete (non-streamed) answer from the upstream.</summary>
public sealed record ProviderReply(int StatusCode, string Body);

/// <summary>A streamed answer: the status, and the body's lines as they arrive.</summary>
public sealed record ProviderStream(int StatusCode, IAsyncEnumerable<string> Lines, string? ErrorBody);

/// <summary>Port: OpenRouter. The adapter is the only holder of the API key.</summary>
public interface IModelProvider
{
    /// <summary>False when no API key is configured; the gateway then refuses before reserving anything.</summary>
    bool IsConfigured { get; }

    Task<ProviderReply> CompleteAsync(JsonObject body, CancellationToken cancellationToken);

    Task<ProviderStream> StreamAsync(JsonObject body, CancellationToken cancellationToken);

    /// <summary>The generation record's total cost, or null when it is not (yet) recorded.</summary>
    Task<decimal?> GetGenerationCostAsync(string generationId, CancellationToken cancellationToken);
}
