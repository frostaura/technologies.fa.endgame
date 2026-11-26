using System.Formats.Tar;
using System.Globalization;
using System.Text;
using Docker.DotNet;
using Docker.DotNet.Models;
using Endgame.Dock.Api;
using Endgame.Dock.Egress;
using Endgame.Dock.Engine;
using Endgame.Dock.Policy;
using Endgame.Dock.Repositories;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Workspaces;

/// <summary>The leases Dock was told about, by run id. Renewals outlive a Dock restart.</summary>
public sealed class LeaseState
{
    public Dictionary<Guid, DateTimeOffset> Leases { get; set; } = [];
}

/// <summary>
/// Workspace containers (ARCH-004): one per run, holding a working copy of the app's repository.
/// The agent's tools execute here, never beside the harness (CLAUDE.md rule 6): no socket, an
/// internal network of its own whose only way out is the egress proxy, CPU, memory and process
/// limits, every capability dropped, a non-root user.
/// </summary>
public sealed class WorkspaceService(
    DockerClient docker,
    ContainerExec exec,
    ContainerFiles files,
    NetworkManager networks,
    EgressManager egress,
    Apps.DatabaseProvisioner databases,
    RepositoryService repositories,
    WorkspaceImage image,
    ResourceNames names,
    IOptions<DockOptions> options,
    TimeProvider time,
    ILogger<WorkspaceService> logger)
{
    public const int Uid = 1654;
    private const string User = "1654:1654";
    private const string BaseCommitLabel = "endgame.base-commit";
    private const string LimitsLabel = "endgame.limits";

    private readonly StateFile<LeaseState> leases = new(Path.Combine(options.Value.DataDirectory, "state", "leases.json"));

    /// <summary>
    /// Where a run's workspace starts (R2-4): the run's own branch when it has committed before (a workspace recreated after
    /// a lost lease), otherwise the reference asked for — an earlier attempt's branch, for "Try again" — when it exists,
    /// otherwise the app's published line. A change never starts from another run's unpublished work unless it asks to.
    /// </summary>
    private async Task<string> BaseOfAsync(CreateWorkspaceRequest request, CancellationToken cancellationToken)
    {
        if (await repositories.RunHeadAsync(request.AppId, request.RunId, cancellationToken) is { } own)
        {
            return own;
        }

        if (!string.IsNullOrWhiteSpace(request.Ref))
        {
            try
            {
                return await repositories.ResolveAsync(request.AppId, request.Ref, cancellationToken);
            }
            catch (DockProblem problem) when (problem.Status == StatusCodes.Status404NotFound)
            {
                // An earlier attempt that never committed has no branch: start from the line.
            }
        }

        return await repositories.ResolveAsync(request.AppId, null, cancellationToken);
    }

    public async Task<WorkspaceInfo> CreateAsync(CreateWorkspaceRequest request, CancellationToken cancellationToken)
    {
        if (request.RunId == Guid.Empty || request.AppId == Guid.Empty)
        {
            throw DockProblem.Invalid("A run id and an app id are required.");
        }

        if (request.LeaseExpiresAt <= time.GetUtcNow())
        {
            throw DockProblem.Invalid("The lease has already expired.");
        }

        var workspaceImage = image.Require();
        var commit = await BaseOfAsync(request, cancellationToken);
        var allowed = EgressRules.NormaliseAll(request.AllowedHosts, out var rejected);
        if (rejected.Count > 0)
        {
            throw DockProblem.Invalid($"Not host names: {string.Join(", ", rejected)}.");
        }

        var name = names.WorkspaceContainer(request.RunId);
        if (await TryInspectAsync(name, cancellationToken) is not null)
        {
            throw DockProblem.Exists("A workspace for this run");
        }

        var o = options.Value;
        var limits = LimitsPolicy.Resolve(request.Limits, o.WorkspaceDefaults, o.WorkspaceMaxima);
        var network = names.WorkspaceNetwork(request.RunId);
        var labels = names.Labels(ResourceNames.WorkspaceKind, request.AppId, request.RunId);
        labels[BaseCommitLabel] = commit;
        labels[LimitsLabel] = string.Create(CultureInfo.InvariantCulture, $"{limits.Cpus}/{limits.MemoryMb}/{limits.Pids}");
        labels[ResourceNames.LeaseLabel] = request.LeaseExpiresAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);

        await leases.UpdateAsync(s => s.Leases[request.RunId] = request.LeaseExpiresAt, cancellationToken);
        var checkout = "";
        try
        {
            var peers = databases.Configured ? NetworkPeers.Egress | NetworkPeers.Postgres : NetworkPeers.Egress;
            var subnet = await networks.EnsureAsync(network, names.Labels(ResourceNames.WorkspaceNetworkKind, request.AppId, request.RunId), peers, cancellationToken);
            await egress.SetAsync(network, subnet, o.PackageRegistries.Concat(allowed), platform: false, cancellationToken);
            var proxy = $"http://{o.Peers.EgressAlias}:{o.Peers.EgressPort}";
            var environment = new List<string>
            {
                $"HTTP_PROXY={proxy}", $"HTTPS_PROXY={proxy}", $"http_proxy={proxy}", $"https_proxy={proxy}",
                $"NO_PROXY=localhost,127.0.0.1,{o.Peers.PostgresAlias}", $"no_proxy=localhost,127.0.0.1,{o.Peers.PostgresAlias}",
                $"{AppEnvironment.EgressProxy}={proxy}", "HOME=/home/app",
            };
            if (databases.Configured)
            {
                environment.Add($"{AppEnvironment.TestDatabase}={await databases.EnsureTestServerAsync(request.RunId, cancellationToken)}");
            }

            await docker.Containers.CreateContainerAsync(new CreateContainerParameters
            {
                Name = name,
                Image = workspaceImage,
                User = User,
                WorkingDir = WorkspacePaths.Root,
                Cmd = ["sleep", "infinity"],
                Env = environment,
                Labels = labels,
                StopTimeout = TimeSpan.FromSeconds(2),
                HostConfig = Hardening.Workspace(limits, network),
                NetworkingConfig = new NetworkingConfig { EndpointsConfig = new Dictionary<string, EndpointSettings> { [network] = new() } },
            }, cancellationToken);
            await docker.Containers.StartContainerAsync(name, new ContainerStartParameters(), cancellationToken);

            checkout = await repositories.CheckoutAsync(request.AppId, commit, cancellationToken);
            await using (var tar = new FileStream(repositories.TemporaryFile("workspace", ".tar"), FileMode.Create, FileAccess.ReadWrite, FileShare.None, 81920, FileOptions.DeleteOnClose))
            {
                await WriteOwnedTarAsync(checkout, tar, cancellationToken);
                tar.Position = 0;
                await files.WriteArchiveAsync(name, WorkspacePaths.Root, tar, cancellationToken);
            }

            logger.LogInformation("Workspace for run {RunId} created at {Commit}.", request.RunId, commit[..12]);
            return new WorkspaceInfo(request.RunId, request.AppId, commit, WorkspacePaths.Root, request.LeaseExpiresAt, limits);
        }
        catch
        {
            await DestroyAsync(request.RunId, CancellationToken.None);
            throw;
        }
        finally
        {
            if (checkout.Length > 0)
            {
                RepositoryService.TryDelete(checkout);
            }
        }
    }

    public async Task<WorkspaceInfo> GetAsync(Guid runId, CancellationToken cancellationToken)
    {
        var container = await RequireAsync(runId, cancellationToken);
        var state = await leases.ReadAsync(cancellationToken);
        return Describe(runId, container, state);
    }

    public async Task<WorkspaceInfo> RenewAsync(Guid runId, DateTimeOffset expiresAt, CancellationToken cancellationToken)
    {
        var container = await RequireAsync(runId, cancellationToken);
        var state = await leases.UpdateAsync(s => s.Leases[runId] = expiresAt, cancellationToken);
        return Describe(runId, container, state);
    }

    public async Task<ExecResult> ExecAsync(Guid runId, ExecRequest request, CancellationToken cancellationToken)
    {
        var container = await RequireAsync(runId, cancellationToken);
        var hasCommand = request.Command is { Count: > 0 };
        var hasShell = !string.IsNullOrWhiteSpace(request.Shell);
        if (hasCommand == hasShell)
        {
            throw DockProblem.Invalid("Give exactly one of command or shell.");
        }

        var directory = await CheckPathAsync(container.ID, request.WorkingDirectory ?? ".", cancellationToken);
        var environment = new List<string>();
        foreach (var (key, value) in request.Environment ?? new Dictionary<string, string>())
        {
            if (key.Length == 0 || key.Contains('=', StringComparison.Ordinal) || key.Contains('\0', StringComparison.Ordinal) || value.Contains('\0', StringComparison.Ordinal))
            {
                throw DockProblem.Invalid($"'{key}' is not a usable environment variable.");
            }

            environment.Add($"{key}={value}");
        }

        var timeout = TimeSpan.FromSeconds(Math.Clamp(request.TimeoutSeconds ?? 120, 1, 3600));
        var maxBytes = Math.Clamp(request.MaxOutputBytes ?? 64 * 1024, 1024, 4 * 1024 * 1024);
        IReadOnlyList<string> argv = hasCommand ? request.Command! : ["bash", "-lc", request.Shell!];
        return await exec.RunAsync(container.ID, argv, timeout, maxBytes, User, directory, environment, cancellationToken);
    }

    public async Task<FilePage> ReadAsync(Guid runId, string? path, int offset, int limit, CancellationToken cancellationToken)
    {
        var container = await RequireAsync(runId, cancellationToken);
        var absolute = await CheckPathAsync(container.ID, path ?? ".", cancellationToken);
        var relative = WorkspacePaths.Resolve(absolute).RelativePath;
        var kind = (await exec.RunCheckedAsync(container.ID, ["stat", "-c", "%F", "--", absolute], User, cancellationToken: cancellationToken).ContinueWith(
            t => t.IsCompletedSuccessfully ? t.Result.Trim() : "", TaskScheduler.Default));
        if (kind.Length == 0)
        {
            throw DockProblem.NotFound($"'{relative}'");
        }

        if (kind == "directory")
        {
            var listing = await exec.RunCheckedAsync(container.ID, ["find", absolute, "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\t%s\t%f\\0"], User, cancellationToken: cancellationToken);
            var entries = listing.Split('\0', StringSplitOptions.RemoveEmptyEntries)
                .Select(line => line.Split('\t', 3))
                .Where(f => f.Length == 3 && !(absolute == WorkspacePaths.Root && string.Equals(f[2], ".git", StringComparison.OrdinalIgnoreCase)))
                .Select(f => new DirectoryEntry(f[2], f[0] switch { "d" => "directory", "l" => "link", _ => "file" }, long.TryParse(f[1], CultureInfo.InvariantCulture, out var size) ? size : 0))
                .ToList();
            return FilePaging.Directory(relative, entries, offset, limit);
        }

        byte[]? content;
        try
        {
            content = await files.ReadAsync(container.ID, absolute, options.Value.MaxFileBytes, cancellationToken);
        }
        catch (FileTooLargeException e)
        {
            throw new DockProblem(StatusCodes.Status413PayloadTooLarge, DockProblemCodes.TooLarge, "That file is too large to read here.", $"{e.Size} bytes.");
        }

        return content is null ? throw DockProblem.NotFound($"'{relative}'") : FilePaging.File(relative, content, offset, limit);
    }

    public async Task<WriteFileResult> WriteAsync(Guid runId, WriteFileRequest request, CancellationToken cancellationToken)
    {
        var container = await RequireAsync(runId, cancellationToken);
        var lexical = WorkspacePaths.Resolve(request.Path);
        if (!lexical.Allowed)
        {
            throw DockProblem.ProtectedPath(lexical.Reason!);
        }

        if (lexical.RelativePath.Length == 0)
        {
            throw DockProblem.Invalid("A file path is required, not the workspace root.");
        }

        byte[] content;
        try
        {
            content = (request.Encoding ?? "utf-8").ToLowerInvariant() switch
            {
                "utf-8" or "utf8" => Encoding.UTF8.GetBytes(request.Content ?? ""),
                "base64" => Convert.FromBase64String(request.Content ?? ""),
                _ => throw DockProblem.Invalid("The encoding must be utf-8 or base64."),
            };
        }
        catch (FormatException)
        {
            throw DockProblem.Invalid("The content is not valid base64.");
        }

        if (content.Length > options.Value.MaxFileBytes)
        {
            throw new DockProblem(StatusCodes.Status413PayloadTooLarge, DockProblemCodes.TooLarge, "That file is too large to write here.");
        }

        // The path the container resolves — through any symbolic link — must pass the floor too.
        await CheckPathAsync(container.ID, lexical.AbsolutePath, cancellationToken);
        await files.WriteAsync(container.ID, WorkspacePaths.Root, [new ContainerFiles.Entry(lexical.RelativePath, content)], Uid, cancellationToken);
        return new WriteFileResult(lexical.RelativePath, content.Length);
    }

    /// <summary>
    /// Commits the workspace with the employee as author, then carries the commit to the app's
    /// repository as a bundle: the workspace never reaches Dock's repositories directly.
    /// </summary>
    public async Task<WorkspaceCommitResult> CommitAsync(Guid runId, WorkspaceCommitRequest request, CancellationToken cancellationToken)
    {
        RepositoryService.RequireAuthor(request.AuthorName, request.AuthorEmail);
        if (string.IsNullOrWhiteSpace(request.Message))
        {
            throw DockProblem.Invalid("A commit message is required.");
        }

        var container = await RequireAsync(runId, cancellationToken);
        var appId = Guid.Parse(container.LabelMap()[ResourceNames.AppLabel]);
        var baseCommit = container.LabelMap()[BaseCommitLabel];
        string[] git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-C", WorkspacePaths.Root];
        var add = await exec.RunAsync(container.ID, [.. git, "add", "-A"], TimeSpan.FromMinutes(2), 16 * 1024, User, cancellationToken: cancellationToken);
        if (add.ExitCode != 0)
        {
            throw DockProblem.Invalid($"The workspace's changes could not be staged: {add.Stderr.Trim()}");
        }

        var status = await exec.RunCheckedAsync(container.ID, [.. git, "status", "--porcelain"], User, cancellationToken: cancellationToken);
        if (status.Trim().Length > 0)
        {
            var commit = await exec.RunAsync(container.ID,
                [.. git, "-c", $"user.name={request.AuthorName.Trim()}", "-c", $"user.email={request.AuthorEmail.Trim()}", "commit", "-q", "--no-verify", "-m", request.Message.Trim()],
                TimeSpan.FromMinutes(2), 16 * 1024, User, cancellationToken: cancellationToken);
            if (commit.ExitCode != 0)
            {
                throw DockProblem.Invalid($"The workspace could not be committed: {commit.Stderr.Trim()}");
            }
        }

        var head = (await exec.RunCheckedAsync(container.ID, [.. git, "rev-parse", "HEAD"], User, cancellationToken: cancellationToken)).Trim();
        var repositoryHead = await repositories.RunHeadAsync(appId, runId, cancellationToken);
        if (head == repositoryHead || head == baseCommit)
        {
            return new WorkspaceCommitResult(head, false);
        }

        const string bundlePath = "/tmp/endgame-commit.bundle";
        var range = await exec.RunAsync(container.ID, [.. git, "cat-file", "-e", baseCommit + "^{commit}"], TimeSpan.FromSeconds(30), 1024, User, cancellationToken: cancellationToken);
        // Only what the app's repository lacks: everything since the commit the workspace started from.
        string[] bundleArgs = range.ExitCode == 0
            ? ["bundle", "create", "-q", bundlePath, "HEAD", $"^{baseCommit}"]
            : ["bundle", "create", "-q", bundlePath, "HEAD"];

        var bundled = await exec.RunAsync(container.ID, [.. git, .. bundleArgs], TimeSpan.FromMinutes(5), 16 * 1024, User, cancellationToken: cancellationToken);
        if (bundled.ExitCode != 0)
        {
            throw DockProblem.Invalid($"The workspace's history could not be packed: {bundled.Stderr.Trim()}");
        }

        var local = repositories.TemporaryFile("commit", ".bundle");
        try
        {
            if (!await files.CopyOutAsync(container.ID, bundlePath, local, options.Value.MaxBundleBytes, cancellationToken))
            {
                throw DockProblem.Unavailable("The workspace's commit could not be read back.");
            }

            var accepted = await repositories.AcceptBundleAsync(appId, runId, local, cancellationToken);
            return new WorkspaceCommitResult(accepted, true);
        }
        catch (FileTooLargeException e)
        {
            throw new DockProblem(StatusCodes.Status413PayloadTooLarge, DockProblemCodes.TooLarge, "The workspace's changes are too large to commit.", $"{e.Size} bytes.");
        }
        catch (GitException e)
        {
            throw DockProblem.Invalid($"The workspace's commit was not accepted: {e.Stderr.Trim()}");
        }
        finally
        {
            RepositoryService.TryDelete(local);
            await exec.RunAsync(container.ID, ["rm", "-f", bundlePath], TimeSpan.FromSeconds(10), 1024, User, cancellationToken: CancellationToken.None);
        }
    }

    /// <summary>Removes the container, its network and its allow-list. Missing parts are fine.</summary>
    public async Task<bool> DestroyAsync(Guid runId, CancellationToken cancellationToken)
    {
        var name = names.WorkspaceContainer(runId);
        var existed = false;
        try
        {
            await docker.Containers.RemoveContainerAsync(name, new ContainerRemoveParameters { Force = true, RemoveVolumes = true }, cancellationToken);
            existed = true;
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
        }

        var network = names.WorkspaceNetwork(runId);
        await networks.RemoveAsync(network, cancellationToken);
        await egress.RemoveAsync(network, cancellationToken);
        await databases.DropTestServerAsync(runId, cancellationToken);
        await leases.UpdateAsync(s => s.Leases.Remove(runId), cancellationToken);
        if (existed)
        {
            logger.LogInformation("Workspace for run {RunId} destroyed.", runId);
        }

        return existed;
    }

    /// <summary>Destroys every workspace whose lease has lapsed. Returns how many.</summary>
    public async Task<int> SweepAsync(CancellationToken cancellationToken)
    {
        var containers = await docker.Containers.ListContainersAsync(new ContainersListParameters
        {
            All = true,
            Filters = new Dictionary<string, IDictionary<string, bool>>
            {
                ["label"] = new Dictionary<string, bool>
                {
                    [$"{ResourceNames.ManagedByLabel}={names.Instance}"] = true,
                    [$"{ResourceNames.KindLabel}={ResourceNames.WorkspaceKind}"] = true,
                },
            },
        }, cancellationToken);
        var state = await leases.ReadAsync(cancellationToken);
        var now = time.GetUtcNow();
        var swept = 0;
        foreach (var container in containers)
        {
            if (!container.LabelMap().TryGetValue(ResourceNames.RunLabel, out var run) || !Guid.TryParse(run, out var runId))
            {
                continue;
            }

            var expires = state.Leases.TryGetValue(runId, out var renewed) ? renewed : LabelExpiry(container.LabelMap());
            if (expires <= now)
            {
                logger.LogInformation("The lease of run {RunId} lapsed at {Expiry}; destroying its workspace.", runId, expires);
                await DestroyAsync(runId, cancellationToken);
                swept++;
            }
        }

        return swept;
    }

    private static DateTimeOffset LabelExpiry(IReadOnlyDictionary<string, string> labels) =>
        labels.TryGetValue(ResourceNames.LeaseLabel, out var value) && long.TryParse(value, CultureInfo.InvariantCulture, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : DateTimeOffset.MinValue;

    private WorkspaceInfo Describe(Guid runId, ContainerInspectResponse container, LeaseState state)
    {
        var labels = container.LabelMap();
        var limits = labels.TryGetValue(LimitsLabel, out var text) && text.Split('/') is [var c, var m, var p]
            ? new ResourceLimits(double.Parse(c, CultureInfo.InvariantCulture), int.Parse(m, CultureInfo.InvariantCulture), int.Parse(p, CultureInfo.InvariantCulture))
            : options.Value.WorkspaceDefaults;
        var expires = state.Leases.TryGetValue(runId, out var renewed) ? renewed : LabelExpiry(labels);
        return new WorkspaceInfo(runId, Guid.Parse(labels[ResourceNames.AppLabel]), labels[BaseCommitLabel], WorkspacePaths.Root, expires, limits);
    }

    /// <summary>Applies the lexical floor, then the floor again on what the container resolves.</summary>
    private async Task<string> CheckPathAsync(string container, string path, CancellationToken cancellationToken)
    {
        var lexical = WorkspacePaths.Resolve(path);
        if (!lexical.Allowed)
        {
            throw DockProblem.ProtectedPath(lexical.Reason!);
        }

        var resolved = (await exec.RunCheckedAsync(container, ["realpath", "-m", "--", lexical.AbsolutePath], User, cancellationToken: cancellationToken)).Trim();
        var real = WorkspacePaths.CheckResolved(resolved);
        return real.Allowed ? lexical.AbsolutePath : throw DockProblem.ProtectedPath(real.Reason!);
    }

    private async Task<ContainerInspectResponse> RequireAsync(Guid runId, CancellationToken cancellationToken) =>
        await TryInspectAsync(names.WorkspaceContainer(runId), cancellationToken) is { } container
        && container.LabelMap().TryGetValue(ResourceNames.ManagedByLabel, out var owner) && owner == names.Instance
            ? container
            : throw DockProblem.NotFound("The workspace");

    private async Task<ContainerInspectResponse?> TryInspectAsync(string name, CancellationToken cancellationToken)
    {
        try
        {
            return await docker.Containers.InspectContainerAsync(name, cancellationToken);
        }
        catch (Exception e) when (EngineErrors.IsNotFound(e))
        {
            return null;
        }
    }

    /// <summary>Tars a checkout with every entry owned by the workspace user.</summary>
    private static async Task WriteOwnedTarAsync(string directory, Stream output, CancellationToken cancellationToken)
    {
        await using var writer = new TarWriter(output, TarEntryFormat.Pax, leaveOpen: true);
        foreach (var path in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            var relative = Path.GetRelativePath(directory, path).Replace('\\', '/');
            var info = new FileInfo(path);
            PaxTarEntry entry;
            if (info.LinkTarget is { } target)
            {
                entry = new PaxTarEntry(TarEntryType.SymbolicLink, relative) { LinkName = target };
            }
            else if (Directory.Exists(path))
            {
                entry = new PaxTarEntry(TarEntryType.Directory, relative + "/") { Mode = (UnixFileMode)0b111_101_101 };
            }
            else
            {
                entry = new PaxTarEntry(TarEntryType.RegularFile, relative)
                {
                    Mode = !OperatingSystem.IsWindows() && (File.GetUnixFileMode(path) & UnixFileMode.UserExecute) != 0 ? (UnixFileMode)0b111_101_101 : (UnixFileMode)0b110_100_100,
                    DataStream = File.OpenRead(path),
                };
            }

            entry.Uid = Uid;
            entry.Gid = Uid;
            await writer.WriteEntryAsync(entry, cancellationToken);
            entry.DataStream?.Dispose();
        }
    }
}

/// <summary>Destroys workspaces whose run's lease has lapsed.</summary>
public sealed class LeaseSweeper(WorkspaceService workspaces, IOptions<DockOptions> options, ILogger<LeaseSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.LeaseSweepSeconds)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await workspaces.SweepAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "The workspace lease sweep failed.");
            }
        }
    }
}
