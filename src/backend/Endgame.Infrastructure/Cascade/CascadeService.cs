using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tree;
using Endgame.Infrastructure.Vault;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Cascade;

/// <summary>One effective value as the API shows it. A secret's value is never shown; only that it is set.</summary>
public sealed record EffectiveValue(string Kind, string Key, JsonNode? Value, string SetAtLevel, string SetAtPath, DateTimeOffset SetAt, IReadOnlyList<string> Overrides);

/// <summary>
/// The cascade resolver over storage: reads every entry on a scope's chain and hands them to the pure
/// <see cref="CascadeResolver"/>. Permissions are read from role grants; the other five kinds from
/// <c>cascade_entries</c>. Nothing else in the control plane implements inheritance.
/// </summary>
public sealed class CascadeService(EndgameDbContext db, IDataProtectionProvider protection, EnvelopeVault vault, TimeProvider clock)
{
    /// <summary>The first control-plane pass sealed secrets with the data-protection key ring; those still open.</summary>
    private const string LegacyVaultPurpose = "Endgame.Vault.v1";

    public async Task<IReadOnlyList<CascadeEntry>> ChainEntriesAsync(ResolvedScope scope, CascadeKind? kind, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var entries = new List<CascadeEntry>();
        if (kind is null or CascadeKind.Permission)
        {
            var grants = await db.Memberships.AsNoTracking()
                .Where(m => m.OrganisationId == scope.OrganisationId)
                .Where(m => m.DivisionId == null || m.DivisionId == scope.DivisionId)
                .Where(m => m.ProjectId == null || m.ProjectId == scope.ProjectId)
                .Where(m => m.AppId == null || m.AppId == scope.AppId)
                .ToListAsync(cancellationToken);
            entries.AddRange(grants.Select(g => new RoleGrant(g.UserId, MemberRoles.FromWire(g.Role), g.Level(), g.NodeId(), scope.PathAt(g.Level())).ToEntry(g.GrantedAt)));
        }

        if (kind is not CascadeKind.Permission)
        {
            var wire = kind?.ToWire();
            var rows = await db.CascadeEntries.AsNoTracking()
                .Where(e => e.OrganisationId == scope.OrganisationId)
                .Where(e => wire == null || e.Kind == wire)
                .Where(e => e.DivisionId == null || e.DivisionId == scope.DivisionId)
                .Where(e => e.ProjectId == null || e.ProjectId == scope.ProjectId)
                .Where(e => e.AppId == null || e.AppId == scope.AppId)
                .ToListAsync(cancellationToken);
            entries.AddRange(rows.Select(r => new CascadeEntry(CascadeKinds.FromWire(r.Kind), r.Key, r.ValueJson, r.Level(), r.NodeId(), scope.PathAt(r.Level()), r.SetAt)));
        }

        return entries;
    }

    /// <summary>The effective values of one kind at a scope, each with the level that set it.</summary>
    public async Task<IReadOnlyList<EffectiveValue>> ResolveAsync(ResolvedScope scope, CascadeKind kind, CancellationToken cancellationToken)
    {
        var entries = await ChainEntriesAsync(scope, kind, cancellationToken);
        if (kind == CascadeKind.Permission)
        {
            return entries.GroupBy(e => e.Key)
                .Select(g => RoleResolver.Resolve(g.Select(e => new RoleGrant(Guid.Parse(e.Key), MemberRoles.FromWire(JsonSerializer.Deserialize<string>(e.ValueJson)), e.Level, e.NodeId, e.Path)))!)
                .Select(grant => new EffectiveValue("permission", grant.UserId.ToString(), JsonValue.Create(grant.Role.ToWire()), grant.Level.ToWire(), grant.Path, default,
                    entries.Where(e => e.Key == grant.UserId.ToString() && e.Level < grant.Level).Select(e => e.Path).ToList()))
                .OrderBy(v => v.Key, StringComparer.Ordinal)
                .ToList();
        }

        return CascadeResolver.Resolve(kind, entries).Select(View).ToList();
    }

    /// <summary>Every entry of a kind set at nodes beneath the scope (not on its chain).</summary>
    public async Task<IReadOnlyList<CascadeEntryRecord>> BelowAsync(ResolvedScope scope, CascadeKind kind, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var wire = kind.ToWire();
        var rows = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId && e.Kind == wire)
            .Where(e => scope.DivisionId == null || e.DivisionId == scope.DivisionId)
            .Where(e => scope.ProjectId == null || e.ProjectId == scope.ProjectId)
            .Where(e => scope.AppId == null || e.AppId == scope.AppId)
            .ToListAsync(cancellationToken);
        return rows.Where(r => r.Level() > scope.Level).ToList();
    }

    /// <summary>The role needed to set a value of this kind and key.</summary>
    public static MemberRole RoleToSet(CascadeKind kind, string key) => kind switch
    {
        CascadeKind.Context => MemberRole.Builder,
        CascadeKind.Setting when key.StartsWith("sleep.", StringComparison.Ordinal) => MemberRole.Builder,
        CascadeKind.Setting when key == CascadeKeys.OverdraftOwnLimit => MemberRole.Owner,
        _ => MemberRole.Admin,
    };

    /// <summary>Sets one value at the scope's own node, replacing what was set there before.</summary>
    public async Task<EffectiveValue> SetAsync(ResolvedScope scope, CascadeKind kind, string key, JsonNode? value, Guid setBy, Actor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        try
        {
            _ = kind == CascadeKind.Secret ? SecretNames.Require(key) : CascadeKinds.RequireKey(key);
        }
        catch (DomainException ex)
        {
            throw EndgameProblem.Invalid(ex.Message);
        }

        if (kind == CascadeKind.Permission)
        {
            throw EndgameProblem.Invalid("Roles are granted through /api/members, which records who granted them.");
        }

        string valueJson;
        string? protectedValue = null;
        if (kind == CascadeKind.Secret)
        {
            if (value is not JsonValue v || v.GetValueKind() != JsonValueKind.String || string.IsNullOrEmpty(v.GetValue<string>()))
            {
                throw EndgameProblem.Invalid("A secret's value is a non-empty string.");
            }

            if (v.GetValue<string>().Length > MaxSecretLength)
            {
                throw EndgameProblem.Invalid($"A secret's value is at most {MaxSecretLength} characters.");
            }

            protectedValue = vault.Seal(v.GetValue<string>(), SecretBinding(scope.OrganisationId, scope.NodeId, key));
            valueJson = """{"set":true}""";
        }
        else
        {
            valueJson = (value ?? JsonValue.Create((string?)null))?.ToJsonString() ?? "null";
            await ValidateWellKnownAsync(scope, kind, key, value, actor, cancellationToken);
        }

        var wire = kind.ToWire();
        var row = await db.CascadeEntries.SingleOrDefaultAsync(
            e => e.OrganisationId == scope.OrganisationId && e.DivisionId == scope.DivisionId && e.ProjectId == scope.ProjectId && e.AppId == scope.AppId && e.Kind == wire && e.Key == key,
            cancellationToken);
        if (row is null)
        {
            row = new CascadeEntryRecord
            {
                Id = Guid.NewGuid(),
                OrganisationId = scope.OrganisationId,
                DivisionId = scope.DivisionId,
                ProjectId = scope.ProjectId,
                AppId = scope.AppId,
                Kind = wire,
                Key = key,
            };
            db.CascadeEntries.Add(row);
        }

        row.ValueJson = valueJson;
        row.ProtectedValue = protectedValue;
        row.SetBy = setBy;
        row.SetAt = clock.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return View(new EffectiveEntry(new CascadeEntry(kind, key, valueJson, scope.Level, scope.NodeId, scope.Path.ToString(), row.SetAt), []));
    }

    /// <summary>Removes the value set at the scope's own node. Inherited values then apply again.</summary>
    public async Task<bool> RemoveAsync(ResolvedScope scope, CascadeKind kind, string key, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var wire = kind.ToWire();
        var removed = await db.CascadeEntries
            .Where(e => e.OrganisationId == scope.OrganisationId && e.DivisionId == scope.DivisionId && e.ProjectId == scope.ProjectId && e.AppId == scope.AppId && e.Kind == wire && e.Key == key)
            .ExecuteDeleteAsync(cancellationToken);
        return removed > 0;
    }

    /// <summary>The numbers the control plane itself reads, the overdraft rule (never deeper than what is inherited) and the access rule.</summary>
    private async Task ValidateWellKnownAsync(ResolvedScope scope, CascadeKind kind, string key, JsonNode? value, Actor actor, CancellationToken cancellationToken)
    {
        var isOverdraft = kind == CascadeKind.Setting && key is CascadeKeys.OverdraftLimit or CascadeKeys.OverdraftOwnLimit;
        var isCreditNumber = (kind == CascadeKind.Budget && key == CascadeKeys.MonthlyCredits) || (kind == CascadeKind.Setting && key == CascadeKeys.AppModelMonthlyCredits);
        if (isOverdraft || isCreditNumber)
        {
            var number = NumberOf(value) ?? throw EndgameProblem.Invalid($"'{key}' is a number of credits.");
            if (number < 0)
            {
                throw EndgameProblem.Invalid($"'{key}' cannot be negative.");
            }
        }

        if (isOverdraft)
        {
            var number = NumberOf(value)!.Value;
            var chain = await ChainEntriesAsync(scope, CascadeKind.Setting, cancellationToken);
            if (key == CascadeKeys.OverdraftLimit && scope.Level == NodeLevel.Organisation)
            {
                if (actor != Actor.Operator)
                {
                    throw EndgameProblem.Forbidden("An organisation's deepest overdraft is set by a FrostAura operator. Set a tighter one of your own (overdraft_own_limit), or on a division, project or app.");
                }
            }
            else if (key == CascadeKeys.OverdraftOwnLimit)
            {
                if (scope.Level != NodeLevel.Organisation)
                {
                    throw EndgameProblem.Invalid("overdraft_own_limit is the organisation's own limit; narrow a division, project or app with overdraft_limit.");
                }

                var operatorMax = OperatorOverdraft(chain);
                if (number > operatorMax)
                {
                    throw EndgameProblem.Invalid($"The organisation's own overdraft may be tighter than the {operatorMax.ToString(CultureInfo.InvariantCulture)} credits FrostAura set, never deeper.");
                }
            }
            else
            {
                var inherited = EffectiveOverdraft(chain.Where(e => e.Level < scope.Level));
                if (number > inherited)
                {
                    throw EndgameProblem.Invalid($"An overdraft here may be tighter than the {inherited.ToString(CultureInfo.InvariantCulture)} credits inherited, never deeper.");
                }
            }
        }

        if (kind == CascadeKind.Setting && key == CascadeKeys.SleepMode && value?.ToString() is not ("auto" or "always_on"))
        {
            throw EndgameProblem.Invalid("sleep.mode is 'auto' or 'always_on'.");
        }

        if (kind == CascadeKind.Setting && key == CascadeKeys.SleepIdleMinutes && NumberOf(value) is not (>= 1 and <= 1440))
        {
            throw EndgameProblem.Invalid("sleep.idle_minutes is a whole number from 1 to 1440.");
        }

        if (kind == CascadeKind.Setting && key == CascadeKeys.Access)
        {
            var access = value is JsonValue a && a.GetValueKind() == JsonValueKind.String ? a.GetValue<string>() : null;
            if (access is null || !AppAccess.All.Contains(access))
            {
                throw EndgameProblem.Invalid("access is 'private', 'shared' or 'public'.");
            }

            if (access == AppAccess.Public && !actor.IsHuman())
            {
                // CLAUDE.md rule 10: going public is a human act. No agent, and no service, may do it.
                throw new EndgameProblem(403, "human_only", "Only a person can make an app public",
                    "Making an app public is a human act; an agent or a service can never set it.");
            }
        }
    }

    /// <summary>The deepest overdraft a FrostAura operator allows the organisation: zero when none was set.</summary>
    public static decimal OperatorOverdraft(IEnumerable<CascadeEntry> chainSettings) =>
        chainSettings.Where(e => e.Key == CascadeKeys.OverdraftLimit && e.Level == NodeLevel.Organisation)
            .Select(e => NumberOf(JsonNode.Parse(e.ValueJson)) ?? 0m)
            .DefaultIfEmpty(0m)
            .Min();

    /// <summary>
    /// How far below zero the organisation's balance may run for work at a scope: the operator's
    /// maximum (zero when unset), narrowed by the organisation's own limit and by any overdraft set
    /// lower on the chain. The tightest wins; nothing can make it deeper.
    /// </summary>
    public static decimal EffectiveOverdraft(IEnumerable<CascadeEntry> chainSettings)
    {
        var list = chainSettings.ToList();
        var narrower = list
            .Where(e => (e.Key == CascadeKeys.OverdraftOwnLimit && e.Level == NodeLevel.Organisation) || (e.Key == CascadeKeys.OverdraftLimit && e.Level > NodeLevel.Organisation))
            .Select(e => NumberOf(JsonNode.Parse(e.ValueJson)) ?? 0m);
        return narrower.Prepend(OperatorOverdraft(list)).Min();
    }

    /// <summary>
    /// A secret's value, resolved through the cascade from <paramref name="scope"/> upwards: the
    /// deepest level that sets it wins. Null when no level on the chain sets it.
    /// </summary>
    public async Task<(string Value, string SetAtPath)?> RevealSecretAsync(ResolvedScope scope, string name, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);
        var rows = await db.CascadeEntries.AsNoTracking()
            .Where(e => e.OrganisationId == scope.OrganisationId && e.Kind == "secret" && e.Key == name)
            .Where(e => e.DivisionId == null || e.DivisionId == scope.DivisionId)
            .Where(e => e.ProjectId == null || e.ProjectId == scope.ProjectId)
            .Where(e => e.AppId == null || e.AppId == scope.AppId)
            .ToListAsync(cancellationToken);
        var row = rows.OrderByDescending(r => r.Level()).FirstOrDefault();
        if (row?.ProtectedValue is not { } sealedValue)
        {
            return null;
        }

        var value = EnvelopeVault.IsSealed(sealedValue)
            ? vault.Open(sealedValue, SecretBinding(row.OrganisationId, row.NodeId(), row.Key))
            : protection.CreateProtector(LegacyVaultPurpose).Unprotect(sealedValue);
        return (value, scope.PathAt(row.Level()));
    }

    /// <summary>What a sealed secret is bound to: its organisation, its node and its name.</summary>
    private static string SecretBinding(Guid organisationId, Guid nodeId, string name) => $"secret:{organisationId:N}:{nodeId:N}:{name}";

    public const int MaxSecretLength = 16_384;

    public static decimal? NumberOf(JsonNode? value) =>
        value is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<decimal>(out var d) ? d : null;

    private static EffectiveValue View(EffectiveEntry effective)
    {
        var entry = effective.Entry;
        var value = entry.Kind == CascadeKind.Secret ? new JsonObject { ["set"] = true } : JsonNode.Parse(entry.ValueJson);
        return new EffectiveValue(entry.Kind.ToWire(), entry.Key, value, entry.Level.ToWire(), entry.Path, entry.SetAt, effective.Overridden.Select(o => o.Path).ToList());
    }
}
