using System.Security.Cryptography;
using System.Text;
using Endgame.Ops.Backups;
using Endgame.Ops.Cloudflare;

namespace Endgame.Ops.Api;

/// <summary>
/// Every <c>/internal</c> call carries <c>Authorization: Bearer $ENDGAME_SERVICE_TOKEN</c> (ARCH-004),
/// compared in constant time. With no token configured every call is refused.
/// </summary>
public sealed class ServiceTokenFilter(IConfiguration configuration) : IEndpointFilter
{
    public const string Variable = "ENDGAME_SERVICE_TOKEN";

    private readonly byte[]? expected = configuration[Variable] is { Length: >= 16 } token ? SHA256.HashData(Encoding.UTF8.GetBytes(token)) : null;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var header = context.HttpContext.Request.Headers.Authorization.ToString();
        var presented = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header["Bearer ".Length..] : "";
        if (expected is null || !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
        {
            return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "A valid service token is required.", extensions: new Dictionary<string, object?> { ["code"] = "unauthorized" });
        }

        return await next(context);
    }
}

public static class OpsEndpoints
{
    public static void MapOps(this WebApplication app)
    {
        app.MapGet("/health", async (OpsHealth health, CancellationToken ct) =>
        {
            var report = await health.ReportAsync(ct);
            return Results.Json(report, statusCode: report.Status == "unhealthy" ? StatusCodes.Status503ServiceUnavailable : StatusCodes.Status200OK);
        });

        var api = app.MapGroup("/internal/ops").AddEndpointFilter<ServiceTokenFilter>();

        api.MapGet("/reserved-hosts", (ReservedHosts hosts, CancellationToken ct) => hosts.GetAsync(ct));

        api.MapGet("/cloudflare/plan", async (CloudflareReconciler reconciler, CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await reconciler.PlanAsync(ct));
            }
            catch (CloudflarePlanRefusedException ex)
            {
                return Problem(StatusCodes.Status409Conflict, "cloudflare_unconfigured", ex.Message);
            }
            catch (CloudflareException ex)
            {
                return Problem(StatusCodes.Status502BadGateway, "cloudflare_error", ex.Message);
            }
        });

        api.MapPost("/cloudflare/apply", async (bool? confirm, CloudflareReconciler reconciler, CancellationToken ct) =>
        {
            if (confirm != true)
            {
                return Problem(StatusCodes.Status400BadRequest, "confirmation_required",
                    "apply changes the live Cloudflare account. Read GET /internal/ops/cloudflare/plan first, then call again with ?confirm=true.");
            }

            try
            {
                return Results.Ok(await reconciler.ApplyAsync(ct));
            }
            catch (CloudflarePlanRefusedException ex)
            {
                return Problem(StatusCodes.Status409Conflict, ex.Plan is null ? "cloudflare_unconfigured" : "plan_has_conflicts", ex.Message, ex.Plan);
            }
            catch (CloudflareException ex)
            {
                return Problem(StatusCodes.Status502BadGateway, "cloudflare_error", ex.Message);
            }
        });

        api.MapGet("/backups", async (BackupService backups, BackupOptions options, IBackupStore store, BackupStatus status, CancellationToken ct) =>
        {
            try
            {
                var stored = await backups.ListAsync(ct);
                return Results.Ok(new
                {
                    destination = store.Offsite ? "offsite" : "local",
                    describe = store.Describe,
                    backups = stored.OrderByDescending(b => b.CreatedAt),
                    usage = StorageUsage.From(stored, options, store.Offsite),
                    last = status.Last,
                    running = status.Running,
                });
            }
            catch (Exception ex) when (ex is S3Exception or HttpRequestException or IOException)
            {
                return Problem(StatusCodes.Status502BadGateway, "backup_store_unreachable", $"The backups could not be listed: {ex.Message}");
            }
        });

        api.MapPost("/backups", async (BackupService backups, CancellationToken ct) =>
        {
            try
            {
                return Results.Ok(await backups.BackupAsync("on demand", ct));
            }
            catch (BackupBusyException ex)
            {
                return Problem(StatusCodes.Status409Conflict, "backup_running", ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return Problem(StatusCodes.Status409Conflict, "backup_refused", ex.Message);
            }
        });
    }

    private static IResult Problem(int status, string code, string detail, object? plan = null) =>
        Results.Problem(statusCode: status, title: detail, extensions: new Dictionary<string, object?> { ["code"] = code, ["plan"] = plan });
}

/// <summary><c>/health</c>: alive, and what it is (and is not) doing, in plain words.</summary>
public sealed class OpsHealth(CloudflareOptions cloudflare, BackupOptions backups, IBackupStore store, BackupStatus status, BackupScheduler scheduler)
{
    public async Task<HealthReport> ReportAsync(CancellationToken cancellationToken) => new HealthReport(
        backups.WhyRefused() is null ? "healthy" : "unhealthy",
        CloudflareState(),
        await BackupStateAsync(cancellationToken));

    public sealed record HealthReport(string Status, object Cloudflare, object Backups);

    private object CloudflareState()
    {
        if (!cloudflare.HasToken)
        {
            return new { state = "idle", message = "No Cloudflare API token is configured (CLOUDFLARE_API_TOKEN): DNS, the tunnel's routes and the outage page are not managed from here." };
        }

        var missing = cloudflare.Missing();
        return missing.Count > 0
            ? new { state = "misconfigured", message = $"A Cloudflare token is set but {string.Join(", ", missing)} is not; nothing is managed." }
            : new { state = "configured", message = $"Manages {cloudflare.ConsoleHost} and *.{cloudflare.Zone} through tunnel {cloudflare.TunnelId}. Changes happen only on an explicit apply." };
    }

    private async Task<object> BackupStateAsync(CancellationToken cancellationToken)
    {
        if (backups.WhyRefused() is { } why)
        {
            return new { state = "refused", message = why };
        }

        try
        {
            var stored = await store.ListAsync(cancellationToken);
            var usage = StorageUsage.From(stored, backups, store.Offsite);
            var newest = stored.Count == 0 ? null : stored.MaxBy(b => b.CreatedAt);
            return new
            {
                state = store.Offsite ? "offsite" : "local",
                message = $"Backups go to {store.Describe}.",
                schedule = backups.ScheduleEnabled ? $"nightly, from {backups.HourUtc:00}:00 UTC; keeps {backups.KeepDaily} daily and {backups.KeepWeekly} weekly" : "off",
                nextCheckAt = scheduler.NextCheckAt,
                newest,
                count = stored.Count,
                usage,
                last = status.Last,
                running = status.Running,
            };
        }
        catch (Exception ex) when (ex is S3Exception or HttpRequestException or IOException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return new { state = "unreachable", message = $"Backups go to {store.Describe}, which could not be read just now: {ex.Message}", last = status.Last };
        }
    }
}
