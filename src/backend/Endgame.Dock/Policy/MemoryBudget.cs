namespace Endgame.Dock.Policy;

/// <summary>
/// Admission for starting an app, by memory in real use rather than by limits (ARCH-005: forty
/// 256 MB limits exceed the machine, yet forty idle apps fit). The estimate for an app is the most
/// it has been seen using, so a heavy app is never admitted on a light app's figure.
/// </summary>
public static class MemoryBudget
{
    public static BudgetDecision Admit(long budgetBytes, IEnumerable<long> runningUsageBytes, long estimateBytes)
    {
        var used = runningUsageBytes.Sum();
        var projected = used + Math.Max(0, estimateBytes);
        return projected <= budgetBytes
            ? new BudgetDecision(true, used, projected)
            : new BudgetDecision(false, used, projected);
    }
}

/// <summary>Whether an app may start, with the figures behind the answer.</summary>
public sealed record BudgetDecision(bool Admitted, long UsedBytes, long ProjectedBytes);
