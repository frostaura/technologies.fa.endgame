using System.Text.Json.Nodes;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Credits;

/// <param name="FrostauraLimit">The deepest overdraft FrostAura allows (0 when none was set).</param>
/// <param name="OwnLimit">The organisation's own, tighter limit, when it set one.</param>
/// <param name="Effective">What applies at the organisation: the tighter of the two.</param>
public sealed record OperatorOverdraftView(decimal FrostauraLimit, decimal? OwnLimit, decimal Effective);

/// <param name="Standing"><c>in-credit</c>, <c>overdrawn</c> (below zero, within the limit) or <c>at-limit</c> (work stopped, apps paused).</param>
public sealed record OrganisationSummary(Guid Id, string Slug, string Name, string Status, DateTimeOffset CreatedAt, decimal Balance, string Standing,
    OperatorOverdraftView Overdraft, int Apps, DateTimeOffset? LastActivityAt, int OpenTopUpRequests);

/// <summary>God mode's overview of every organisation: balance, overdraft and standing, apps, last activity, open top-up requests. Runs as the platform.</summary>
public sealed class OperatorOverview(EndgameDbContext db, TenantSession session)
{
    public async Task<IReadOnlyList<OrganisationSummary>> SummariesAsync(CancellationToken ct)
    {
        session.UseSystem();
        var organisations = await db.Organisations.AsNoTracking().OrderBy(o => o.Slug).ToListAsync(ct);
        var balances = new Dictionary<Guid, decimal>();
        var lastActivity = new Dictionary<Guid, DateTimeOffset>();
        await using (var command = await db.CommandAsync("""
            SELECT organisation_id,
                   COALESCE(SUM(amount) FILTER (WHERE kind = 'top_up'), 0) - COALESCE(SUM(amount) FILTER (WHERE kind IN ('settlement', 'hosting') AND billable), 0),
                   MAX(created_at) FILTER (WHERE kind <> 'top_up')
            FROM credit_entries GROUP BY organisation_id
            """, ct))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                balances[reader.GetGuid(0)] = reader.GetDecimal(1);
                if (!reader.IsDBNull(2))
                {
                    lastActivity[reader.GetGuid(0)] = reader.GetFieldValue<DateTimeOffset>(2);
                }
            }
        }

        await using (var command = await db.CommandAsync("SELECT organisation_id, MAX(created_at) FROM runs GROUP BY organisation_id", ct))
        await using (var reader = await command.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var at = reader.GetFieldValue<DateTimeOffset>(1);
                if (!lastActivity.TryGetValue(reader.GetGuid(0), out var known) || at > known)
                {
                    lastActivity[reader.GetGuid(0)] = at;
                }
            }
        }

        var apps = (await db.Apps.AsNoTracking().GroupBy(a => a.OrganisationId).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Key, x => x.Count);
        var requests = (await db.TopUpRequests.AsNoTracking().Where(r => r.Status == TopUpRequestStatuses.Open).GroupBy(r => r.OrganisationId)
            .Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Key, x => x.Count);
        var limits = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.Kind == "setting" && e.DivisionId == null && (e.Key == CascadeKeys.OverdraftLimit || e.Key == CascadeKeys.OverdraftOwnLimit)).ToListAsync(ct);
        session.Clear();
        return organisations.Select(o =>
        {
            var mine = limits.Where(l => l.OrganisationId == o.Id).ToList();
            var frostaura = mine.Where(l => l.Key == CascadeKeys.OverdraftLimit).Select(l => CascadeService.NumberOf(JsonNode.Parse(l.ValueJson)) ?? 0m).DefaultIfEmpty(0m).Min();
            decimal? own = mine.Where(l => l.Key == CascadeKeys.OverdraftOwnLimit).Select(l => CascadeService.NumberOf(JsonNode.Parse(l.ValueJson))).FirstOrDefault(v => v is not null);
            var effective = own is { } ownLimit ? Math.Min(frostaura, ownLimit) : frostaura;
            var balance = balances.GetValueOrDefault(o.Id);
            var standing = balance >= 0 ? "in-credit" : -balance >= effective ? "at-limit" : "overdrawn";
            return new OrganisationSummary(o.Id, o.Slug, o.Name, o.Status, o.CreatedAt, balance, standing, new OperatorOverdraftView(frostaura, own, effective),
                apps.GetValueOrDefault(o.Id), lastActivity.TryGetValue(o.Id, out var last) ? last : null, requests.GetValueOrDefault(o.Id));
        }).ToList();
    }
}
