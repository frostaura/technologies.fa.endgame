using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Endgame.Ops.Cloudflare;

/// <summary>One line of a plan: what would happen to one thing in the account, and why.</summary>
/// <param name="Resource"><c>dns</c>, <c>tunnel</c>, <c>worker</c> or <c>route</c>.</param>
/// <param name="Action"><c>create</c>, <c>update</c>, <c>delete</c>, <c>keep</c> or <c>conflict</c>.</param>
public sealed record PlannedChange(string Resource, string Action, string Target, string Detail);

/// <summary>A dry-run diff between the account and the desired state. <see cref="InSync"/> means applying it changes nothing.</summary>
public sealed record CloudflarePlan(DateTimeOffset GeneratedAt, IReadOnlyList<PlannedChange> Changes)
{
    public bool HasConflicts => Changes.Any(c => c.Action == "conflict");

    public bool InSync => Changes.All(c => c.Action == "keep");

    public int Mutations => Changes.Count(c => c.Action is "create" or "update" or "delete");
}

/// <summary>What <c>apply</c> did, and the plan read back afterwards (in sync when it worked).</summary>
public sealed record CloudflareApplyResult(IReadOnlyList<PlannedChange> Applied, CloudflarePlan After);

/// <summary>The plan refused to apply: conflicts, or configuration that cannot work. Nothing was changed.</summary>
public sealed class CloudflarePlanRefusedException(string message, CloudflarePlan? plan = null) : Exception(message)
{
    public CloudflarePlan? Plan { get; } = plan;
}

/// <summary>
/// Makes the account match Endgame's desired state, idempotently (ARCH-007):
/// <list type="bullet">
/// <item>DNS — the console host and ONE wildcard for organisation subdomains, both proxied CNAMEs to
/// <c>&lt;tunnel id&gt;.cfargotunnel.com</c>, each marked in its comment. A record without that mark
/// is never modified or deleted; if it is where Endgame needs one, that is a conflict.</item>
/// <item>Tunnel ingress — the console host and the wildcard to the Edge, other hostnames' rules kept
/// in their order, and a catch-all 404 last.</item>
/// <item>The outage Worker — uploaded when its source changed, routed on the console host and the
/// wildcard, with an excluding (Worker-less) route for every other web host on the zone, so the
/// wildcard route never runs in front of a site that is not Endgame's.</item>
/// </list>
/// </summary>
public sealed class CloudflareReconciler(CloudflareClient client, CloudflareOptions options, TimeProvider clock)
{
    /// <summary>Every record Endgame creates carries a comment starting with this (comments are on every plan; tags are not on Free).</summary>
    public const string ManagedMark = "endgame-managed";
    public const string SourceHashBinding = "ENDGAME_SOURCE_SHA256";
    public const string CompatibilityDate = "2025-11-01";
    public const string ModuleName = "worker.js";
    public const string NotFoundService = "http_status:404";

    private static readonly Lazy<string> WorkerSourceText = new(() =>
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("outage-worker.js")
            ?? throw new InvalidOperationException("The outage Worker's source is not embedded.");
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return reader.ReadToEnd();
    });

    public static string WorkerSource => WorkerSourceText.Value;

    public static string WorkerSourceHash => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(WorkerSource)));

    public static bool IsManaged(DnsRecord record) => record.Comment?.StartsWith(ManagedMark, StringComparison.Ordinal) == true;

    private string Zone => options.Zone.TrimEnd('.').ToLowerInvariant();

    private string ConsoleHost => options.ConsoleHost.TrimEnd('.').ToLowerInvariant();

    private string Wildcard => "*." + Zone;

    private string TunnelTarget => $"{options.TunnelId}.cfargotunnel.com";

    public async Task<CloudflarePlan> PlanAsync(CancellationToken cancellationToken) => (await BuildAsync(cancellationToken)).Plan;

    /// <summary>Applies a fresh plan, refusing outright if it has any conflict, then reads the account back.</summary>
    public async Task<CloudflareApplyResult> ApplyAsync(CancellationToken cancellationToken)
    {
        var (plan, steps) = await BuildAsync(cancellationToken);
        if (plan.HasConflicts)
        {
            throw new CloudflarePlanRefusedException(
                "The plan has conflicts, so nothing was applied: " + string.Join(" ", plan.Changes.Where(c => c.Action == "conflict").Select(c => $"[{c.Resource} {c.Target}] {c.Detail}")),
                plan);
        }

        var applied = new List<PlannedChange>();
        foreach (var (change, run) in steps)
        {
            await run(cancellationToken);
            applied.Add(change);
        }

        return new CloudflareApplyResult(applied, (await BuildAsync(cancellationToken)).Plan);
    }

    private delegate Task Step(CancellationToken cancellationToken);

    private async Task<(CloudflarePlan Plan, List<(PlannedChange Change, Step Run)> Steps)> BuildAsync(CancellationToken cancellationToken)
    {
        if (!options.HasToken)
        {
            throw new CloudflarePlanRefusedException("No Cloudflare API token is configured (CLOUDFLARE_API_TOKEN), so nothing is managed.");
        }

        if (options.Missing() is { Count: > 0 } missing)
        {
            throw new CloudflarePlanRefusedException($"Cloudflare is half configured; also needed: {string.Join(", ", missing)}.");
        }

        if (!ConsoleHost.EndsWith("." + Zone, StringComparison.Ordinal) || ConsoleHost[..^(Zone.Length + 1)].Contains('.', StringComparison.Ordinal))
        {
            throw new CloudflarePlanRefusedException(
                $"ENDGAME_CONSOLE_HOST ({ConsoleHost}) must be one label directly under ENDGAME_ZONE ({Zone}): the free certificate covers one level only.");
        }

        var changes = new List<PlannedChange>();
        var steps = new List<(PlannedChange, Step)>();
        void Add(PlannedChange change, Step? run = null)
        {
            changes.Add(change);
            if (run is not null)
            {
                steps.Add((change, run));
            }
        }

        var records = await client.ListDnsRecordsAsync(cancellationToken);
        var routes = await client.ListWorkerRoutesAsync(cancellationToken);
        var tunnel = await client.GetTunnelConfigurationAsync(cancellationToken);
        var bindings = await client.GetWorkerBindingsAsync(options.WorkerName, cancellationToken);

        // 1. The Worker, before any route names it.
        var hash = WorkerSourceHash;
        var deployedHash = bindings?.FirstOrDefault(b => b.Name == SourceHashBinding)?.Text;
        if (deployedHash == hash)
        {
            Add(new("worker", "keep", options.WorkerName, $"The outage page is deployed at this source (sha256 {hash[..12]})."));
        }
        else
        {
            var action = bindings is null ? "create" : "update";
            Add(
                new("worker", action, options.WorkerName, bindings is null
                    ? $"Upload the outage page Worker (sha256 {hash[..12]})."
                    : $"Upload the outage page Worker: deployed {(deployedHash is null ? "without Endgame's source mark" : $"sha256 {deployedHash[..Math.Min(12, deployedHash.Length)]}")}, wanted {hash[..12]}."),
                ct => client.UploadWorkerAsync(options.WorkerName, ModuleName, WorkerSource, CompatibilityDate,
                    [new WorkerBinding("plain_text", SourceHashBinding, hash), new WorkerBinding("plain_text", "ENDGAME_CONSOLE_HOST", ConsoleHost)], ct));
        }

        // 2. Routes: ours on the two Endgame patterns, an excluding route for every other web host.
        var workerPatterns = new[] { $"{ConsoleHost}/*", $"{Wildcard}/*" };
        var foreignHosts = records
            .Where(r => !IsManaged(r) && r.Type is "A" or "AAAA" or "CNAME")
            .Select(r => r.Name.TrimEnd('.').ToLowerInvariant())
            .Where(n => n.EndsWith("." + Zone, StringComparison.Ordinal) && n != ConsoleHost && n != Wildcard)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
        var exclusions = foreignHosts.Select(h => $"{h}/*").ToList();
        foreach (var pattern in workerPatterns)
        {
            var existing = routes.Where(r => r.Pattern == pattern).ToList();
            if (existing.Any(r => r.Script == options.WorkerName))
            {
                Add(new("route", "keep", pattern, $"Routed to {options.WorkerName}."));
            }
            else if (existing.FirstOrDefault() is { } other)
            {
                Add(new("route", "conflict", pattern, other.Script is null
                    ? "A route without a Worker already holds this pattern and is not Endgame's; it is left alone. Delete it to let the outage page run here."
                    : $"The Worker '{other.Script}' already holds this pattern and is not Endgame's; it is left alone."));
            }
            else
            {
                Add(new("route", "create", pattern, $"Route to {options.WorkerName}."), ct => client.CreateWorkerRouteAsync(pattern, options.WorkerName, ct));
            }
        }

        foreach (var pattern in exclusions)
        {
            var existing = routes.Where(r => r.Pattern == pattern).ToList();
            if (existing.Any(r => r.Script is null))
            {
                Add(new("route", "keep", pattern, "Excluded from the outage page (not an Endgame host)."));
            }
            else if (existing.FirstOrDefault(r => r.Script == options.WorkerName) is { } ours)
            {
                Add(new("route", "update", pattern, "Not an Endgame host: take the outage page off it."), ct => client.UpdateWorkerRouteAsync(ours.Id, pattern, null, ct));
            }
            else if (existing.Count > 0)
            {
                Add(new("route", "keep", pattern, $"Served by its own Worker ('{existing[0].Script}'), which already keeps Endgame's off it; untouched."));
            }
            else
            {
                Add(new("route", "create", pattern, "Exclude this host from the outage page: it is not Endgame's (a route with no Worker)."),
                    ct => client.CreateWorkerRouteAsync(pattern, null, ct));
            }
        }

        foreach (var stale in routes.Where(r => r.Script == options.WorkerName && !workerPatterns.Contains(r.Pattern) && !exclusions.Contains(r.Pattern)))
        {
            Add(new("route", "delete", stale.Pattern, "Endgame's Worker on a pattern it no longer needs."), ct => client.DeleteWorkerRouteAsync(stale.Id, ct));
        }

        // 3. Tunnel ingress.
        PlanIngress(tunnel, Add);

        // 4. DNS last, so a name resolves only once the tunnel knows where to send it.
        PlanRecord(records, ConsoleHost, "console host", Add);
        PlanRecord(records, Wildcard, "organisation subdomains", Add);
        foreach (var stale in records.Where(r => IsManaged(r) && r.Name.TrimEnd('.').ToLowerInvariant() is var n && n != ConsoleHost && n != Wildcard))
        {
            Add(new("dns", "delete", $"{stale.Type} {stale.Name}", "Endgame created this record and no longer needs it."), ct => client.DeleteDnsRecordAsync(stale.Id, ct));
        }

        return (new CloudflarePlan(clock.GetUtcNow(), changes), steps);
    }

    private void PlanRecord(IReadOnlyList<DnsRecord> records, string name, string purpose, Action<PlannedChange, Step?> add)
    {
        var wanted = new DnsRecordInput("CNAME", name, TunnelTarget, Proxied: true, Ttl: 1, $"{ManagedMark}: {purpose}");
        var atName = records.Where(r => r.Name.TrimEnd('.').Equals(name, StringComparison.OrdinalIgnoreCase)).ToList();
        var foreign = atName.Where(r => !IsManaged(r)).ToList();
        if (foreign.Count > 0)
        {
            add(new("dns", "conflict", name,
                $"{string.Join(", ", foreign.Select(r => $"{r.Type} → {r.Content}"))} already exists and was not created by Endgame, so it is never modified. " +
                $"Delete it, or mark it as Endgame's by setting its comment to '{wanted.Comment}'."), null);
            return;
        }

        var ours = atName.FirstOrDefault();
        if (ours is null)
        {
            add(new("dns", "create", name, $"CNAME → {TunnelTarget}, proxied ({purpose})."), async ct => await client.CreateDnsRecordAsync(wanted, ct));
        }
        else if (ours.Type == wanted.Type && ours.Content.TrimEnd('.').Equals(TunnelTarget, StringComparison.OrdinalIgnoreCase) && ours.Proxied && ours.Ttl == 1 && ours.Comment == wanted.Comment)
        {
            add(new("dns", "keep", name, $"CNAME → {TunnelTarget}, proxied ({purpose})."), null);
        }
        else
        {
            add(new("dns", "update", name, $"{ours.Type} → {ours.Content}{(ours.Proxied ? ", proxied" : ", DNS only")} becomes CNAME → {TunnelTarget}, proxied."),
                async ct => await client.EditDnsRecordAsync(ours.Id, wanted, ct));
        }

        foreach (var extra in atName.Skip(1))
        {
            add(new("dns", "delete", $"{extra.Type} {extra.Name}", "A second Endgame record at the same name."), ct => client.DeleteDnsRecordAsync(extra.Id, ct));
        }
    }

    private void PlanIngress(TunnelConfiguration tunnel, Action<PlannedChange, Step?> add)
    {
        var current = tunnel.Config["ingress"] as JsonArray ?? [];
        var ours = new[] { ConsoleHost, Wildcard };
        var kept = current
            .OfType<JsonObject>()
            .Where(rule => rule["hostname"]?.GetValue<string>() is { Length: > 0 } host && !ours.Contains(host.ToLowerInvariant()))
            .Select(rule => rule.DeepClone())
            .ToList();
        var desired = new JsonArray([.. kept]);
        desired.Add(new JsonObject { ["hostname"] = ConsoleHost, ["service"] = options.EdgeService });
        desired.Add(new JsonObject { ["hostname"] = Wildcard, ["service"] = options.EdgeService });
        desired.Add(new JsonObject { ["service"] = NotFoundService });

        if (JsonNode.DeepEquals(current, desired))
        {
            add(new("tunnel", "keep", options.TunnelId, $"Ingress: {ConsoleHost} and {Wildcard} → {options.EdgeService}, then 404."), null);
            return;
        }

        var catchAll = current.OfType<JsonObject>().LastOrDefault(r => r["hostname"] is null)?["service"]?.GetValue<string>();
        var detail = $"Ingress becomes: {(kept.Count > 0 ? $"{kept.Count} other hostname rule(s) kept as they are, then " : "")}" +
            $"{ConsoleHost} and {Wildcard} → {options.EdgeService}, then 404 for anything else" +
            (catchAll is not null && catchAll != NotFoundService ? $" (the catch-all was {catchAll})." : ".") +
            $" Currently {current.Count} rule(s), version {tunnel.Version}.";
        var config = (JsonObject)tunnel.Config.DeepClone();
        config["ingress"] = desired;
        add(new("tunnel", current.Count == 0 ? "create" : "update", options.TunnelId, detail), async ct => await client.PutTunnelConfigurationAsync(config, ct));
    }
}
