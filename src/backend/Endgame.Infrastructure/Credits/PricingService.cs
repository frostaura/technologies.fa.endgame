using System.Text.Json;
using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Application.Gateway;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tenancy;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Infrastructure.Credits;

public sealed record HostingRates(decimal UsdPerAwakeHour, decimal UsdPerGbHourMemory, decimal UsdPerGbMonthStorage, decimal UsdPerMillionRequests);

/// <summary>
/// The figures every bill is made from (spec, <i>Credits</i>): credits per dollar, the one margin
/// factor (1.0 is none), the hosting rates, and the default monthly model allowance of an app. The
/// founder's to set; the defaults are what configuration held before this document existed.
/// </summary>
public sealed record PricingDocument(decimal CreditsPerUsd, decimal Margin, HostingRates Hosting, decimal DefaultAppModelMonthlyCredits);

public sealed record PricingChange(DateTimeOffset At, Guid By, string? ByEmail, JsonNode? Before, JsonNode? After);

/// <param name="Source"><c>defaults</c> until an operator first saves the document, then <c>stored</c>.</param>
public sealed record PricingView(PricingDocument Pricing, string Source, DateTimeOffset? UpdatedAt, Guid? UpdatedBy, IReadOnlyList<PricingChange> History);

/// <summary>
/// One settings document for prices, read and changed at runtime by operators and audited
/// (<c>platform_setting_changes</c>, append-only). Every scope resolves its <see cref="CreditOptions"/>
/// and hosting rates from here, so a change applies to the next call without a restart. The figure
/// is cached for <see cref="CacheSeconds"/> and refreshed at once on a change.
/// </summary>
public sealed class PricingService(IServiceScopeFactory scopes, IConfiguration configuration, TimeProvider clock)
{
    public const string Key = "pricing";
    public const int CacheSeconds = 30;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly object gate = new();
    private (PricingDocument Document, DateTimeOffset LoadedAt)? cached;

    /// <summary>What configuration says: the defaults until a document is stored.</summary>
    public PricingDocument Defaults()
    {
        var credits = configuration.GetSection(CreditOptions.SectionName).Get<CreditOptions>() ?? new CreditOptions();
        var hosting = configuration.GetSection(HostingOptions.SectionName).Get<HostingOptions>() ?? new HostingOptions();
        var models = configuration.GetSection(AppModelOptions.SectionName).Get<AppModelOptions>() ?? new AppModelOptions();
        return new PricingDocument(credits.CreditsPerUsd, credits.Margin,
            new HostingRates(hosting.UsdPerAwakeHour, hosting.UsdPerGbHourMemory, hosting.UsdPerGbMonthStorage, hosting.UsdPerMillionRequests),
            models.DefaultMonthlyCredits);
    }

    public PricingDocument Current()
    {
        lock (gate)
        {
            if (cached is { } c && clock.GetUtcNow() - c.LoadedAt < TimeSpan.FromSeconds(CacheSeconds))
            {
                return c.Document;
            }
        }

        var loaded = Load();
        lock (gate)
        {
            cached = (loaded, clock.GetUtcNow());
        }

        return loaded;
    }

    /// <summary>The credit settings for one scope's work: configuration's reservation window, the current prices.</summary>
    public CreditOptions Credits()
    {
        var configured = configuration.GetSection(CreditOptions.SectionName).Get<CreditOptions>() ?? new CreditOptions();
        var current = Current();
        return new CreditOptions { CreditsPerUsd = current.CreditsPerUsd, Margin = current.Margin, ReservationMinutes = configured.ReservationMinutes };
    }

    public HostingOptions Hosting()
    {
        var configured = configuration.GetSection(HostingOptions.SectionName).Get<HostingOptions>() ?? new HostingOptions();
        var rates = Current().Hosting;
        configured.UsdPerAwakeHour = rates.UsdPerAwakeHour;
        configured.UsdPerGbHourMemory = rates.UsdPerGbHourMemory;
        configured.UsdPerGbMonthStorage = rates.UsdPerGbMonthStorage;
        configured.UsdPerMillionRequests = rates.UsdPerMillionRequests;
        return configured;
    }

    public AppModelOptions AppModels()
    {
        var configured = configuration.GetSection(AppModelOptions.SectionName).Get<AppModelOptions>() ?? new AppModelOptions();
        configured.DefaultMonthlyCredits = Current().DefaultAppModelMonthlyCredits;
        return configured;
    }

    public async Task<PricingView> ViewAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var row = await db.PlatformSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == Key, cancellationToken);
        var history = await (from c in db.PlatformSettingChanges.AsNoTracking()
                             join u in db.Users.AsNoTracking() on c.ChangedBy equals u.Id into people
                             from u in people.DefaultIfEmpty()
                             where c.Key == Key
                             orderby c.ChangedAt descending
                             select new { c.ChangedAt, c.ChangedBy, Email = u == null ? null : u.Email, c.BeforeJson, c.AfterJson }).Take(50).ToListAsync(cancellationToken);
        return new PricingView(row is null ? Defaults() : Parse(row.ValueJson), row is null ? "defaults" : "stored", row?.UpdatedAt, row?.UpdatedBy,
            history.Select(h => new PricingChange(h.ChangedAt, h.ChangedBy, h.Email, JsonNode.Parse(h.BeforeJson), JsonNode.Parse(h.AfterJson))).ToList());
    }

    /// <summary>Replaces the document (operators only; checked by the caller), audited with what it was before.</summary>
    public async Task<PricingView> SetAsync(PricingDocument document, Guid by, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(document);
        var faults = Validate(document);
        if (faults.Count > 0)
        {
            throw EndgameProblem.Invalid(string.Join(" ", faults));
        }

        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
            scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var row = await db.PlatformSettings.SingleOrDefaultAsync(s => s.Key == Key, cancellationToken);
            var before = row?.ValueJson ?? JsonSerializer.Serialize(Defaults(), Json);
            var after = JsonSerializer.Serialize(document, Json);
            var now = clock.GetUtcNow();
            if (row is null)
            {
                db.PlatformSettings.Add(new PlatformSettingRecord { Key = Key, ValueJson = after, UpdatedAt = now, UpdatedBy = by });
            }
            else
            {
                row.ValueJson = after;
                row.UpdatedAt = now;
                row.UpdatedBy = by;
            }

            db.PlatformSettingChanges.Add(new PlatformSettingChangeRecord { Id = Guid.NewGuid(), Key = Key, BeforeJson = before, AfterJson = after, ChangedBy = by, ChangedAt = now });
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        lock (gate)
        {
            cached = (document, clock.GetUtcNow());
        }

        return await ViewAsync(cancellationToken);
    }

    public static IReadOnlyList<string> Validate(PricingDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var faults = new CreditOptions { CreditsPerUsd = document.CreditsPerUsd, Margin = document.Margin }.Validate().ToList();
        if (document.Hosting is null)
        {
            faults.Add("hosting holds the four hosting rates.");
        }
        else if (document.Hosting.UsdPerAwakeHour < 0 || document.Hosting.UsdPerGbHourMemory < 0 || document.Hosting.UsdPerGbMonthStorage < 0 || document.Hosting.UsdPerMillionRequests < 0)
        {
            faults.Add("Hosting rates cannot be negative.");
        }

        if (document.DefaultAppModelMonthlyCredits < 0)
        {
            faults.Add("defaultAppModelMonthlyCredits cannot be negative.");
        }

        return faults;
    }

    private PricingDocument Load()
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EndgameDbContext>();
        scope.ServiceProvider.GetRequiredService<TenantSession>().UseSystem();
        var row = db.PlatformSettings.AsNoTracking().SingleOrDefault(s => s.Key == Key);
        return row is null ? Defaults() : Parse(row.ValueJson);
    }

    private PricingDocument Parse(string json) => JsonSerializer.Deserialize<PricingDocument>(json, Json) ?? Defaults();
}
