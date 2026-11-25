namespace Endgame.Ops.Cloudflare;

/// <summary>One label an organisation may not take, and why.</summary>
public sealed record ReservedLabel(string Label, string Reason, IReadOnlyList<string> Records);

/// <summary>
/// <c>GET /internal/ops/reserved-hosts</c>. <see cref="Complete"/> is false when the zone could not
/// be read (no token, or Cloudflare did not answer): the list then holds only the fixed
/// reservations, and the control plane should refuse new organisation names until it is complete.
/// </summary>
public sealed record ReservedHostsView(
    string? Zone,
    bool Complete,
    string Source,
    DateTimeOffset? ReadAt,
    IReadOnlyList<string> Labels,
    IReadOnlyList<ReservedLabel> Reserved,
    string? Reason);

/// <summary>
/// Which organisation names would collide with a subdomain the zone already uses. A wildcard DNS
/// record never answers for a name that exists — including a name that exists only because a
/// deeper one does (<c>a.b.zone</c> makes <c>b.zone</c> exist) — so every such label is reserved.
/// </summary>
public sealed class ReservedHosts(CloudflareClient client, CloudflareOptions options, TimeProvider clock, ILogger<ReservedHosts> logger)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private ReservedHostsView? cached;

    public async Task<ReservedHostsView> GetAsync(CancellationToken cancellationToken)
    {
        var fixedLabels = Fixed();
        if (!options.HasToken || options.Missing().Count > 0)
        {
            return View(fixedLabels, [], complete: false, "static", null,
                options.HasToken
                    ? $"Cloudflare is half configured ({string.Join(", ", options.Missing())} missing): the zone's existing records were not read."
                    : "No Cloudflare API token is configured: the zone's existing records were not read, so only the fixed reservations are listed.");
        }

        await gate.WaitAsync(cancellationToken);
        try
        {
            var now = clock.GetUtcNow();
            if (cached is { ReadAt: { } at } && now - at < TimeSpan.FromSeconds(options.ReservedCacheSeconds))
            {
                return cached;
            }

            var records = await client.ListDnsRecordsAsync(cancellationToken);
            cached = View(fixedLabels, records, complete: true, "cloudflare", now, null);
            return cached;
        }
        catch (Exception ex) when (ex is CloudflareException or HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "The zone's DNS records could not be read for reserved hosts");
            return View(fixedLabels, [], complete: false, "static", null, $"The zone's records could not be read just now: {ex.Message}");
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>The reservations that hold whatever DNS says: the configured list and the console host's own label.</summary>
    private Dictionary<string, ReservedLabel> Fixed()
    {
        var labels = new Dictionary<string, ReservedLabel>(StringComparer.Ordinal);
        foreach (var label in options.ReservedLabels.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            labels[label.ToLowerInvariant()] = new ReservedLabel(label.ToLowerInvariant(), "always reserved", []);
        }

        var zone = options.Zone.TrimEnd('.').ToLowerInvariant();
        var console = options.ConsoleHost.TrimEnd('.').ToLowerInvariant();
        if (zone.Length > 0 && console.EndsWith("." + zone, StringComparison.Ordinal))
        {
            var label = console[..^(zone.Length + 1)].Split('.')[^1];
            labels[label] = new ReservedLabel(label, "the console host", []);
        }

        return labels;
    }

    private ReservedHostsView View(Dictionary<string, ReservedLabel> labels, IReadOnlyList<DnsRecord> records, bool complete, string source, DateTimeOffset? readAt, string? reason)
    {
        var zone = options.Zone.TrimEnd('.').ToLowerInvariant();
        foreach (var record in records.Where(r => !CloudflareReconciler.IsManaged(r)))
        {
            var name = record.Name.TrimEnd('.').ToLowerInvariant();
            if (!name.EndsWith("." + zone, StringComparison.Ordinal))
            {
                continue;
            }

            var label = name[..^(zone.Length + 1)].Split('.')[^1];
            if (label == "*")
            {
                continue;
            }

            var description = $"{record.Type} {name}";
            labels[label] = labels.TryGetValue(label, out var existing)
                ? existing with { Records = [.. existing.Records, description] }
                : new ReservedLabel(label, "an existing DNS record", [description]);
        }

        var ordered = labels.Values.OrderBy(l => l.Label, StringComparer.Ordinal).ToList();
        return new ReservedHostsView(zone.Length > 0 ? zone : null, complete, source, readAt, ordered.Select(l => l.Label).ToList(), ordered, reason);
    }
}
