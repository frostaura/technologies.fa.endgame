using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Policy;

/// <summary>
/// Hands out the /28 every app, workspace and build network gets (ARCH-005: Docker's own address
/// pools ran out after about 25 networks, so Dock assigns subnets itself from a private pool).
/// </summary>
public static class SubnetAllocator
{
    public const int PrefixLength = 28;

    /// <summary>
    /// The first /28 in <paramref name="pool"/> that overlaps nothing in <paramref name="inUse"/> —
    /// every subnet on the engine, not only Dock's, so a network created by hand is never collided with.
    /// </summary>
    public static Ipv4Cidr? Next(Ipv4Cidr pool, IEnumerable<Ipv4Cidr> inUse)
    {
        if (pool.PrefixLength > PrefixLength)
        {
            throw new ArgumentException($"The pool {pool} is smaller than one /{PrefixLength}.", nameof(pool));
        }

        var taken = inUse.Where(pool.Overlaps).ToList();
        var step = 1u << (32 - PrefixLength);
        var slots = pool.Size / step;
        for (var i = 0u; i < slots; i++)
        {
            var slot = new Ipv4Cidr(pool.Network + (i * step), PrefixLength);
            if (!taken.Any(slot.Overlaps))
            {
                return slot;
            }
        }

        return null;
    }
}
