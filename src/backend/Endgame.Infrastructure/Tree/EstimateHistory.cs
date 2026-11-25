using Endgame.Application.Gateway;

namespace Endgame.Infrastructure.Tree;

/// <summary>The billable actuals of an organisation's own finished runs of a kind, newest first: what estimates calibrate against.</summary>
public sealed class EstimateHistory(ReadModels reads) : IEstimateHistory
{
    public const int Samples = 20;

    public async Task<IReadOnlyList<decimal>> ActualsAsync(Guid organisationId, string kind, CancellationToken cancellationToken) =>
        (await reads.CostHistoryAsync(organisationId, kind, Samples, cancellationToken)).Select(r => r.Credits).ToList();
}
