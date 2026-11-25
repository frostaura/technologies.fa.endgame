using System.Text.Json;
using Endgame.Ops;
using Endgame.Ops.Api;
using Endgame.Ops.Backups;
using Endgame.Ops.Cloudflare;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args.Length > 0 && OpsCli.IsCommand(args[0]) ? [] : args);
OpsServices.Add(builder.Services, builder.Configuration);
var app = builder.Build();

if (args.Length > 0 && OpsCli.IsCommand(args[0]))
{
    return await OpsCli.RunAsync(app.Services, args);
}

app.MapOps();
await app.RunAsync();
return 0;

/// <summary>Service registration, shared by the web host and the command line.</summary>
public static class OpsServices
{
    public static void Add(IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<CloudflareOptions>(configuration.GetSection(CloudflareOptions.Section));
        services.Configure<BackupOptions>(configuration.GetSection(BackupOptions.Section));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<CloudflareOptions>>().Value);
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<BackupOptions>>().Value);
        services.AddSingleton(TimeProvider.System);
        services.AddProblemDetails();
        services.AddSingleton<ServiceTokenFilter>();

        services.AddHttpClient<CloudflareClient>(c => c.Timeout = TimeSpan.FromSeconds(30));
        services.AddTransient<CloudflareReconciler>();
        // Holds its cache for the life of the service, and with it one typed client.
        services.AddSingleton<ReservedHosts>();

        // Uploads and downloads stream for as long as they take; each call is bounded by its caller.
        services.AddHttpClient("s3", c => c.Timeout = Timeout.InfiniteTimeSpan);
        services.AddSingleton<IBackupStore>(sp =>
        {
            var o = sp.GetRequiredService<BackupOptions>();
            return o.Offsite
                ? new S3Store(new S3Client(sp.GetRequiredService<IHttpClientFactory>().CreateClient("s3"), o, sp.GetRequiredService<TimeProvider>()), o)
                : new LocalDirectoryStore(o.LocalDirectory);
        });
        services.AddSingleton<PostgresTools>();
        services.AddSingleton<BackupStatus>();
        services.AddSingleton<BackupService>();
        services.AddSingleton<BackupScheduler>();
        services.AddHostedService(sp => sp.GetRequiredService<BackupScheduler>());
        services.AddSingleton<OpsHealth>();
    }
}

/// <summary>
/// The same binary as a command, for the Makefile (<c>docker compose exec ops /app/Endgame.Ops …</c>):
/// <c>backup</c>, <c>backups</c>, <c>verify &lt;id&gt;</c>, <c>restore &lt;id&gt; [--overwrite]</c>,
/// <c>cloudflare-plan</c>, <c>cloudflare-apply --confirm</c>. Restore exists only here: it is
/// never on the HTTP API.
/// </summary>
public static class OpsCli
{
    /// <summary>The exit code of a restore that failed after it began to write (every refusal before that is 1).</summary>
    public const int RestoreIncompleteExit = 4;

    private static readonly string[] Commands = ["backup", "backups", "verify", "restore", "cloudflare-plan", "cloudflare-apply", "reserved-hosts"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static bool IsCommand(string arg) => Commands.Contains(arg);

    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        using var cancel = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cancel.Cancel();
        };
        var ct = cancel.Token;
        var flags = args.Skip(1).Where(a => a.StartsWith("--", StringComparison.Ordinal)).ToHashSet(StringComparer.Ordinal);
        var positional = args.Skip(1).Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToList();
        try
        {
            switch (args[0])
            {
                case "backup":
                    {
                        // A refusal (a missing or malformed key above all) is said first, before anything is started.
                        if (services.GetRequiredService<BackupOptions>().WhyRefused() is { } why)
                        {
                            Console.Error.WriteLine(why);
                            return 1;
                        }

                        var store = services.GetRequiredService<IBackupStore>();
                        Console.WriteLine($"Backing up to {store.Describe}...");
                        var result = await services.GetRequiredService<BackupService>().BackupAsync("make backup", ct);
                        Console.WriteLine($"Backup {result.Id}: {result.ArchiveBytes:N0} bytes sealed ({result.PlaintextBytes:N0} before encryption) in {result.Seconds:0.0} s.");
                        Console.WriteLine($"  databases: {string.Join(", ", result.Databases)}");
                        foreach (var volume in result.Volumes)
                        {
                            Console.WriteLine($"  volume {volume.Name}: {volume.Files:N0} files, {volume.Bytes:N0} bytes");
                        }

                        if (result.Pruned.Count > 0)
                        {
                            Console.WriteLine($"  pruned by retention: {string.Join(", ", result.Pruned)}");
                        }

                        Console.WriteLine($"BACKUP_ID={result.Id}");
                        await PrintUsageAsync(services, ct);
                        return 0;
                    }

                case "backups":
                    {
                        var store = services.GetRequiredService<IBackupStore>();
                        var stored = await store.ListAsync(ct);
                        Console.WriteLine($"Backups in {store.Describe}:");
                        foreach (var b in stored.OrderByDescending(b => b.CreatedAt))
                        {
                            Console.WriteLine($"  {b.Id}  {b.Bytes,15:N0} bytes");
                        }

                        if (stored.Count == 0)
                        {
                            Console.WriteLine("  (none yet)");
                        }

                        await PrintUsageAsync(services, ct);
                        return 0;
                    }

                case "verify":
                    {
                        var manifest = await services.GetRequiredService<BackupService>().VerifyAsync(Required(positional), ct);
                        Console.WriteLine($"Backup {manifest.Id} is intact: {manifest.Databases.Count} database(s), {manifest.Volumes.Sum(v => v.Files)} file(s), every chunk authenticated against the manifest.");
                        return 0;
                    }

                case "restore":
                    {
                        var result = await services.GetRequiredService<BackupService>().RestoreAsync(Required(positional), flags.Contains("--overwrite"), Console.WriteLine, ct);
                        Console.WriteLine($"RESTORE_VERIFY_SECONDS={result.VerifySeconds:0.00}");
                        Console.WriteLine($"RESTORE_SECONDS={result.RestoreSeconds:0.00}");
                        return 0;
                    }

                case "reserved-hosts":
                    Console.WriteLine(JsonSerializer.Serialize(await services.GetRequiredService<ReservedHosts>().GetAsync(ct), Json));
                    return 0;

                case "cloudflare-plan":
                    {
                        var plan = await services.GetRequiredService<CloudflareReconciler>().PlanAsync(ct);
                        PrintPlan(plan.Changes);
                        Console.WriteLine(plan.InSync ? "In sync: apply would change nothing." : $"{plan.Mutations} change(s) to apply{(plan.HasConflicts ? "; conflicts must be resolved first" : "")}.");
                        return plan.HasConflicts ? 3 : 0;
                    }

                case "cloudflare-apply":
                    {
                        if (!flags.Contains("--confirm"))
                        {
                            Console.Error.WriteLine("cloudflare-apply changes the live Cloudflare account. Run the plan first, then pass --confirm (make ops-cloudflare-apply CONFIRM=yes).");
                            return 2;
                        }

                        var result = await services.GetRequiredService<CloudflareReconciler>().ApplyAsync(ct);
                        Console.WriteLine($"Applied {result.Applied.Count} change(s):");
                        PrintPlan(result.Applied);
                        Console.WriteLine(result.After.InSync ? "Read back: in sync." : "Read back: NOT in sync — run the plan again.");
                        return result.After.InSync ? 0 : 1;
                    }
            }
        }
        catch (RestoreIncompleteException ex)
        {
            // Distinct from a refusal (1): the Makefile leaves the stack stopped only for this one.
            Console.Error.WriteLine(ex.Message);
            return RestoreIncompleteExit;
        }
        catch (Exception ex) when (ex is RestoreRefusedException or ArchiveIntegrityException or BackupBusyException or CloudflarePlanRefusedException
            or CloudflareException or S3Exception or InvalidOperationException or ArgumentException or FileNotFoundException)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }

        return 2;
    }

    private static string Required(List<string> positional) =>
        positional.FirstOrDefault() ?? throw new ArgumentException("Name the backup (an id such as 20261125T010000Z; `make ops-backups` lists them).");

    private static void PrintPlan(IEnumerable<PlannedChange> changes)
    {
        foreach (var c in changes)
        {
            Console.WriteLine($"  {c.Action,-8} {c.Resource,-6} {c.Target}");
            Console.WriteLine($"           {c.Detail}");
        }
    }

    private static async Task PrintUsageAsync(IServiceProvider services, CancellationToken ct)
    {
        var store = services.GetRequiredService<IBackupStore>();
        var usage = StorageUsage.From(await store.ListAsync(ct), services.GetRequiredService<BackupOptions>(), store.Offsite);
        Console.WriteLine($"{(usage.State is "warning" or "over" ? "WARNING: " : "")}{usage.Message}");
    }
}

public partial class Program;
