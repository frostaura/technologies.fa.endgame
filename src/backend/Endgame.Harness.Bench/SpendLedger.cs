using System.Globalization;
using System.Text.Json.Nodes;

namespace Endgame.Harness.Bench;

/// <summary>
/// The benchmark's spend, across every invocation, kept in a file beside the results. A call is
/// admitted only if what is settled, plus what is reserved, plus this call's worst case stays under
/// the stop line — the same reserve-before-call rule the gateway follows (CLAUDE.md rule 8).
/// </summary>
public sealed class SpendLedger
{
    private readonly string path;
    private readonly Lock gate = new();
    private decimal reserved;

    public SpendLedger(string path, decimal stopAt, decimal hardCap)
    {
        if (stopAt > hardCap)
        {
            throw new ArgumentException("The stop line cannot be above the hard cap.", nameof(stopAt));
        }

        this.path = path;
        StopAt = stopAt;
        HardCap = hardCap;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        Settled = File.Exists(path) ? decimal.Parse(JsonNode.Parse(File.ReadAllText(path))!["settledUsd"]!.ToString(), CultureInfo.InvariantCulture) : 0m;
    }

    public decimal StopAt { get; }

    public decimal HardCap { get; }

    public decimal Settled { get; private set; }

    public bool TryReserve(decimal worstCase, out string? refusal)
    {
        lock (gate)
        {
            if (Settled + reserved + worstCase > StopAt)
            {
                refusal = string.Create(CultureInfo.InvariantCulture, $"the lane's spend would pass its US${StopAt} stop line (settled {Settled:0.0000}, reserved {reserved:0.0000}, this call up to {worstCase:0.0000}; hard cap US${HardCap})");
                return false;
            }

            reserved += worstCase;
            refusal = null;
            return true;
        }
    }

    public void Settle(decimal reservation, decimal actual)
    {
        lock (gate)
        {
            reserved -= reservation;
            Settled += actual;
            File.WriteAllText(path, new JsonObject { ["settledUsd"] = Settled.ToString(CultureInfo.InvariantCulture), ["updatedAt"] = DateTimeOffset.UtcNow.ToString("O") }.ToJsonString());
        }
    }
}
