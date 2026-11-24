using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Policy;

/// <summary>Fills in missing limits with defaults and holds every limit to Dock's maxima.</summary>
public static class LimitsPolicy
{
    public static ResourceLimits Resolve(ResourceLimits? requested, ResourceLimits defaults, ResourceLimits maxima)
    {
        if (requested is null)
        {
            return defaults;
        }

        return new ResourceLimits(
            Clamp(requested.Cpus, 0.1, maxima.Cpus, defaults.Cpus),
            (int)Clamp(requested.MemoryMb, 32, maxima.MemoryMb, defaults.MemoryMb),
            (int)Clamp(requested.Pids, 16, maxima.Pids, defaults.Pids));
    }

    private static double Clamp(double value, double floor, double ceiling, double fallback) =>
        value <= 0 || double.IsNaN(value) ? fallback : Math.Clamp(value, floor, ceiling);
}
