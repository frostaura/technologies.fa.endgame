using Endgame.Application.Gateway;
using Endgame.Infrastructure.Work;

namespace Endgame.Tests.ControlPlane;

/// <summary>
/// R7-3: a build whose every part passed but which was not published was offered again with "Only 0 of its 5 parts are left to
/// build, so it is priced for those". With nothing left to build, the estimate says what is left — the security review and
/// publishing (a change: the security review and the new version) — and prices that; one part left and every part left still
/// read as they did.
/// </summary>
public sealed class RetryEstimateWordingTests
{
    private static readonly FactoryEstimates Estimates = new(new FactoryEstimateOptions(), new ModelGatewayOptions(), new CreditOptions());

    [Fact]
    public async Task A_build_with_every_part_done_says_what_is_left_and_is_priced_for_it()
    {
        var estimate = await Estimates.BuildAsync(Guid.NewGuid(), 0, 5, CancellationToken.None);
        Assert.Contains("Every part is built and checked. What is left is the security review and publishing", estimate.Basis, StringComparison.Ordinal);
        Assert.DoesNotContain("Only 0", estimate.Basis, StringComparison.Ordinal);
        Assert.DoesNotContain("left to build", estimate.Basis, StringComparison.Ordinal);
        // Priced as one part's share of the whole: 20 credits over five parts.
        Assert.Equal(4m, estimate.Credits);
    }

    [Fact]
    public async Task A_change_with_every_part_done_says_its_new_version_is_what_is_left()
    {
        var estimate = await Estimates.ChangeAsync(Guid.NewGuid(), 0, 2, CancellationToken.None);
        Assert.Contains("Every part is built and checked. What is left is the security review and the new version", estimate.Basis, StringComparison.Ordinal);
        Assert.Equal(5m, estimate.Credits);
    }

    [Fact]
    public async Task One_part_left_and_every_part_left_read_as_before()
    {
        var one = await Estimates.BuildAsync(Guid.NewGuid(), 1, 5, CancellationToken.None);
        Assert.Contains("Only 1 of its 5 parts is left to build, so it is priced for those", one.Basis, StringComparison.Ordinal);
        Assert.Equal(4m, one.Credits);
        var two = await Estimates.BuildAsync(Guid.NewGuid(), 2, 5, CancellationToken.None);
        Assert.Contains("Only 2 of its 5 parts are left to build", two.Basis, StringComparison.Ordinal);
        var all = await Estimates.BuildAsync(Guid.NewGuid(), 5, 5, CancellationToken.None);
        Assert.DoesNotContain("left to build", all.Basis, StringComparison.Ordinal);
        Assert.DoesNotContain("Every part", all.Basis, StringComparison.Ordinal);
        Assert.Equal(20m, all.Credits);
    }
}
