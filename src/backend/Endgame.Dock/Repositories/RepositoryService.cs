using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using Endgame.Dock.Api;
using Endgame.Dock.Policy;
using Endgame.Hosting.Contracts;
using Microsoft.Extensions.Options;

namespace Endgame.Dock.Repositories;

/// <summary>
/// One bare git repository per app on Dock's volume — the app's whole version history. Created
/// from the app-kit template; written only by Dock, never mounted into a workspace.
/// </summary>
public sealed partial class RepositoryService(IOptions<DockOptions> options, ILogger<RepositoryService> logger)
{
    public const string Branch = "main";
    private const string BranchRef = "refs/heads/" + Branch;
    private const string SystemName = "Endgame";
    private const string SystemEmail = "dock@endgame.invalid";

    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> locks = new();

    private string Root => Path.Combine(options.Value.DataDirectory, "repos");

    public string PathOf(Guid appId) => Path.Combine(Root, $"{appId:D}.git");

    public bool Exists(Guid appId) => Directory.Exists(PathOf(appId));

    public bool TemplateAvailable =>
        Directory.Exists(options.Value.TemplateDirectory) && Directory.EnumerateFileSystemEntries(options.Value.TemplateDirectory).Any();

    public async Task<RepositoryInfo> CreateAsync(Guid appId, CancellationToken cancellationToken)
    {
        if (!TemplateAvailable)
        {
            throw new DockProblem(StatusCodes.Status503ServiceUnavailable, DockProblemCodes.TemplateUnavailable, "The app-kit template is not available.");
        }

        return await LockedAsync(appId, async () =>
        {
            var repository = PathOf(appId);
            if (Directory.Exists(repository))
            {
                throw DockProblem.Exists("The app's repository");
            }

            var work = TemporaryDirectory("seed");
            try
            {
                CopyTemplate(options.Value.TemplateDirectory, work);
                await GitCli.RunAsync(work, ["init", "-q", "-b", Branch]);
                await GitCli.RunAsync(work, ["add", "-A"]);
                await GitCli.RunAsync(work, ["commit", "-q", "-m", "Start from the app kit"], SystemIdentity(), cancellationToken);
                Directory.CreateDirectory(Root);
                var staging = repository + ".creating";
                await GitCli.RunAsync(null, ["clone", "-q", "--bare", "--no-hardlinks", work, staging], cancellationToken: cancellationToken);
                await GitCli.RunAsync(staging, ["remote", "remove", "origin"], cancellationToken: cancellationToken);
                Directory.Move(staging, repository);
                logger.LogInformation("Created the repository of app {AppId}.", appId);
            }
            finally
            {
                TryDelete(work);
            }

            return await InfoAsync(appId, cancellationToken);
        }, cancellationToken);
    }

    public async Task<RepositoryInfo> InfoAsync(Guid appId, CancellationToken cancellationToken)
    {
        RequireExists(appId);
        var head = (await GitCli.RunAsync(PathOf(appId), ["rev-parse", BranchRef], cancellationToken: cancellationToken)).Trim();
        return new RepositoryInfo(appId, Branch, head);
    }

    /// <summary>The commit a branch, tag or commit id names, or a 404 problem.</summary>
    public async Task<string> ResolveAsync(Guid appId, string? reference, CancellationToken cancellationToken)
    {
        RequireExists(appId);
        var name = string.IsNullOrWhiteSpace(reference) ? BranchRef : reference.Trim();
        if (!IsSafeReference(name))
        {
            throw DockProblem.Invalid($"'{reference}' is not a branch, tag or commit.");
        }

        var (exit, stdout, _) = await GitCli.RunRawAsync(PathOf(appId), ["rev-parse", "--verify", "--quiet", "--end-of-options", name + "^{commit}"], cancellationToken: cancellationToken);
        return exit == 0 ? stdout.Trim() : throw DockProblem.NotFound($"The version '{reference}'");
    }

    /// <summary>
    /// The versions on a line, newest first. First parent only: a published run's own commits sit behind its one published
    /// version and are not versions of the app (R2-4).
    /// </summary>
    public async Task<CommitLog> LogAsync(Guid appId, string? reference, int skip, int limit, CancellationToken cancellationToken)
    {
        var commit = await ResolveAsync(appId, reference, cancellationToken);
        limit = Math.Clamp(limit <= 0 ? 50 : limit, 1, 500);
        var output = await GitCli.RunAsync(PathOf(appId),
        [
            "log", "--first-parent", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e",
            $"--skip={Math.Max(0, skip)}", $"--max-count={limit + 1}", commit,
        ], cancellationToken: cancellationToken);
        var commits = output.Split('\x1e', StringSplitOptions.RemoveEmptyEntries)
            .Select(r => r.TrimStart('\n'))
            .Where(r => r.Length > 0)
            .Select(ParseCommit)
            .ToList();
        return new CommitLog(commits.Take(limit).ToList(), commits.Count > limit);
    }

    public async Task<CommitInfo> CommitAsync(Guid appId, string commit, CancellationToken cancellationToken)
    {
        var resolved = await ResolveAsync(appId, commit, cancellationToken);
        var output = await GitCli.RunAsync(PathOf(appId), ["log", "-1", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%B", resolved], cancellationToken: cancellationToken);
        return ParseCommit(output);
    }

    /// <summary>A file or directory at a version, paged like the workspace files API.</summary>
    public async Task<FilePage> ReadAsync(Guid appId, string? reference, string? path, int offset, int limit, CancellationToken cancellationToken)
    {
        var commit = await ResolveAsync(appId, reference, cancellationToken);
        var decision = WorkspacePaths.Resolve(string.IsNullOrEmpty(path) ? "." : path);
        if (!decision.Allowed)
        {
            throw DockProblem.ProtectedPath(decision.Reason!);
        }

        var relative = decision.RelativePath;
        var spec = $"{commit}:{relative}";
        var (exit, type, _) = await GitCli.RunRawAsync(PathOf(appId), ["cat-file", "-t", spec], cancellationToken: cancellationToken);
        if (exit != 0)
        {
            throw DockProblem.NotFound($"'{relative}'");
        }

        if (type.Trim() == "tree")
        {
            var listing = await GitCli.RunAsync(PathOf(appId), ["ls-tree", "-l", "-z", spec], cancellationToken: cancellationToken);
            var entries = listing.Split('\0', StringSplitOptions.RemoveEmptyEntries).Select(line =>
            {
                var tab = line.IndexOf('\t', StringComparison.Ordinal);
                var meta = line[..tab].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var kind = meta[1] == "tree" ? "directory" : meta[0] == "120000" ? "link" : "file";
                var size = long.TryParse(meta[3], NumberStyles.None, CultureInfo.InvariantCulture, out var s) ? s : 0;
                return new DirectoryEntry(line[(tab + 1)..], kind, size);
            }).ToList();
            return FilePaging.Directory(relative, entries, offset, limit);
        }

        var size = long.Parse((await GitCli.RunAsync(PathOf(appId), ["cat-file", "-s", spec], cancellationToken: cancellationToken)).Trim(), CultureInfo.InvariantCulture);
        if (size > options.Value.MaxFileBytes)
        {
            throw new DockProblem(StatusCodes.Status413PayloadTooLarge, DockProblemCodes.TooLarge, "That file is too large to read here.", $"{size} bytes.");
        }

        var content = await ReadBlobAsync(appId, spec, cancellationToken);
        return FilePaging.File(relative, content, offset, limit);
    }

    /// <summary>Makes an earlier version current as a new commit on top; history is never rewritten.</summary>
    public async Task<CommitInfo> RestoreAsync(Guid appId, RestoreRequest request, CancellationToken cancellationToken)
    {
        RequireAuthor(request.AuthorName, request.AuthorEmail);
        return await LockedAsync(appId, async () =>
        {
            var target = await ResolveAsync(appId, request.Ref, cancellationToken);
            var head = await ResolveAsync(appId, null, cancellationToken);
            var repository = PathOf(appId);
            var tree = (await GitCli.RunAsync(repository, ["rev-parse", target + "^{tree}"], cancellationToken: cancellationToken)).Trim();
            var headTree = (await GitCli.RunAsync(repository, ["rev-parse", head + "^{tree}"], cancellationToken: cancellationToken)).Trim();
            if (tree == headTree)
            {
                return await CommitAsync(appId, head, cancellationToken);
            }

            var message = string.IsNullOrWhiteSpace(request.Message) ? $"Restore the version {target[..12]}" : request.Message.Trim();
            var environment = AuthorIdentity(request.AuthorName, request.AuthorEmail);
            var created = (await GitCli.RunAsync(repository, ["commit-tree", tree, "-p", head, "-m", message], environment, cancellationToken)).Trim();
            await GitCli.RunAsync(repository, ["update-ref", BranchRef, created, head], cancellationToken: cancellationToken);
            return await CommitAsync(appId, created, cancellationToken);
        }, cancellationToken);
    }

    /// <summary>The tree at a version as a gzipped tar, in a file deleted once closed.</summary>
    public async Task<Stream> ArchiveAsync(Guid appId, string? reference, CancellationToken cancellationToken)
    {
        var commit = await ResolveAsync(appId, reference, cancellationToken);
        var file = TemporaryFile("archive", ".tar.gz");
        await GitCli.RunAsync(PathOf(appId), ["archive", "--format=tar.gz", $"--output={file}", commit], cancellationToken: cancellationToken);
        return OpenDeleteOnClose(file);
    }

    /// <summary>Writes the tree at a commit as an uncompressed tar (for builds).</summary>
    public async Task<string> TarAsync(Guid appId, string commit, CancellationToken cancellationToken)
    {
        var file = TemporaryFile("tree", ".tar");
        await GitCli.RunAsync(PathOf(appId), ["archive", "--format=tar", $"--output={file}", commit], cancellationToken: cancellationToken);
        return file;
    }

    /// <summary>The whole history as a git bundle — the app's code, leaving with everything.</summary>
    public async Task<Stream> ExportAsync(Guid appId, CancellationToken cancellationToken)
    {
        RequireExists(appId);
        var file = TemporaryFile("export", ".bundle");
        await GitCli.RunAsync(PathOf(appId), ["bundle", "create", "-q", file, "--all"], cancellationToken: cancellationToken);
        return OpenDeleteOnClose(file);
    }

    /// <summary>A working copy at <paramref name="commit"/> on the app's branch, for a workspace.</summary>
    public async Task<string> CheckoutAsync(Guid appId, string commit, CancellationToken cancellationToken)
    {
        var work = TemporaryDirectory("checkout");
        await GitCli.RunAsync(null, ["clone", "-q", "--no-hardlinks", "--no-checkout", PathOf(appId), work], cancellationToken: cancellationToken);
        await GitCli.RunAsync(work, ["checkout", "-q", "-B", Branch, commit], cancellationToken: cancellationToken);
        await GitCli.RunAsync(work, ["remote", "remove", "origin"], cancellationToken: cancellationToken);
        return work;
    }

    /// <summary>
    /// Takes the commits in a workspace's bundle onto the run's own branch (<see cref="RunBranches.Of"/>), never the app's
    /// line: a run's work reaches the app's history only when it is published (<see cref="PublishRunAsync"/>, R2-4). The
    /// first commit starts the branch; later ones must build on its head, or a conflict is returned and the commits are kept
    /// under <c>refs/workspaces/</c>: nothing is lost and nothing is overwritten.
    /// </summary>
    public async Task<string> AcceptBundleAsync(Guid appId, Guid runId, string bundle, CancellationToken cancellationToken)
    {
        return await LockedAsync(appId, async () =>
        {
            var repository = PathOf(appId);
            await GitCli.RunAsync(repository, ["bundle", "verify", "-q", bundle], cancellationToken: cancellationToken);
            var holding = $"refs/workspaces/{runId:D}";
            await GitCli.RunAsync(repository, ["fetch", "-q", "--no-tags", "--no-write-fetch-head", bundle, $"+HEAD:{holding}"], cancellationToken: cancellationToken);
            var incoming = (await GitCli.RunAsync(repository, ["rev-parse", holding], cancellationToken: cancellationToken)).Trim();
            var branch = "refs/heads/" + RunBranches.Of(runId);
            var head = await HeadOfAsync(repository, branch, cancellationToken);
            if (head is null)
            {
                await GitCli.RunAsync(repository, ["update-ref", branch, incoming], cancellationToken: cancellationToken);
                return incoming;
            }

            if (incoming == head)
            {
                return head;
            }

            var (fastForward, _, _) = await GitCli.RunRawAsync(repository, ["merge-base", "--is-ancestor", head, incoming], cancellationToken: cancellationToken);
            if (fastForward != 0)
            {
                throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.Conflict,
                    "This run's code changed since this workspace was created.",
                    $"The workspace's commit {incoming[..12]} is kept; the run's newest is {head[..12]}.");
            }

            await GitCli.RunAsync(repository, ["update-ref", branch, incoming, head], cancellationToken: cancellationToken);
            return incoming;
        }, cancellationToken);
    }

    /// <summary>The commit a run's branch is at, or null when the run has committed nothing.</summary>
    public async Task<string?> RunHeadAsync(Guid appId, Guid runId, CancellationToken cancellationToken)
    {
        RequireExists(appId);
        return await HeadOfAsync(PathOf(appId), "refs/heads/" + RunBranches.Of(runId), cancellationToken);
    }

    /// <summary>
    /// Publishes a run's work (R2-4): one commit on the app's line whose tree is the run's newest and whose message is the
    /// title — what the person asked for — with the run named in a trailer; the run's own commits are its second parent, so
    /// nothing is lost and the line's first-parent history is exactly the versions that were published. A run with nothing
    /// new publishes the line as it is. When the line moved since the run began (a restore, another change), nothing is
    /// published: 409.
    /// </summary>
    public async Task<CommitInfo> PublishRunAsync(Guid appId, Guid runId, PublishRunRequest request, CancellationToken cancellationToken)
    {
        RequireAuthor(request.AuthorName, request.AuthorEmail);
        var title = (request.Title ?? "").ReplaceLineEndings(" ").Trim();
        if (title.Length is 0 or > 500)
        {
            throw DockProblem.Invalid("A published version needs a title of 1 to 500 characters.");
        }

        return await LockedAsync(appId, async () =>
        {
            var repository = PathOf(appId);
            var line = await ResolveAsync(appId, null, cancellationToken);
            var work = await HeadOfAsync(repository, "refs/heads/" + RunBranches.Of(runId), cancellationToken);
            if (work is null || work == line || (await GitCli.RunRawAsync(repository, ["merge-base", "--is-ancestor", work, line], cancellationToken: cancellationToken)).ExitCode == 0)
            {
                return await CommitAsync(appId, line, cancellationToken);
            }

            if ((await GitCli.RunRawAsync(repository, ["merge-base", "--is-ancestor", line, work], cancellationToken: cancellationToken)).ExitCode != 0)
            {
                throw new DockProblem(StatusCodes.Status409Conflict, DockProblemCodes.Conflict,
                    "The app's code changed since this work began.",
                    $"The run's work {work[..12]} does not build on the app's current version {line[..12]}; it is kept on {RunBranches.Of(runId)}.");
            }

            var tree = (await GitCli.RunAsync(repository, ["rev-parse", work + "^{tree}"], cancellationToken: cancellationToken)).Trim();
            var message = $"{title}\n\n{RunBranches.Trailer}: {runId:D}";
            var created = (await GitCli.RunAsync(repository, ["commit-tree", tree, "-p", line, "-p", work, "-m", message], AuthorIdentity(request.AuthorName, request.AuthorEmail), cancellationToken)).Trim();
            await GitCli.RunAsync(repository, ["update-ref", BranchRef, created, line], cancellationToken: cancellationToken);
            return await CommitAsync(appId, created, cancellationToken);
        }, cancellationToken);
    }

    private static async Task<string?> HeadOfAsync(string repository, string reference, CancellationToken cancellationToken)
    {
        var (exit, stdout, _) = await GitCli.RunRawAsync(repository, ["rev-parse", "--verify", "--quiet", reference + "^{commit}"], cancellationToken: cancellationToken);
        return exit == 0 ? stdout.Trim() : null;
    }

    public static void RequireAuthor(string? name, string? email)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 200 || name.IndexOfAny(['<', '>', '\n', '\0']) >= 0)
        {
            throw DockProblem.Invalid("An author name is required, without angle brackets or line breaks.");
        }

        if (string.IsNullOrWhiteSpace(email) || email.Length > 254 || !email.Contains('@', StringComparison.Ordinal) || email.IndexOfAny(['<', '>', ' ', '\n', '\0']) >= 0)
        {
            throw DockProblem.Invalid("An author email address is required.");
        }
    }

    public string TemporaryDirectory(string purpose)
    {
        var path = Path.Combine(options.Value.DataDirectory, "tmp", $"{purpose}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    public string TemporaryFile(string purpose, string extension)
    {
        var directory = Path.Combine(options.Value.DataDirectory, "tmp");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, $"{purpose}-{Guid.NewGuid():N}{extension}");
    }

    public static void TryDelete(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
            else if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    public static Dictionary<string, string> AuthorIdentity(string name, string email) => new(StringComparer.Ordinal)
    {
        ["GIT_AUTHOR_NAME"] = name.Trim(),
        ["GIT_AUTHOR_EMAIL"] = email.Trim(),
        ["GIT_COMMITTER_NAME"] = SystemName,
        ["GIT_COMMITTER_EMAIL"] = SystemEmail,
    };

    private static Dictionary<string, string> SystemIdentity() => AuthorIdentity(SystemName, SystemEmail);

    private void RequireExists(Guid appId)
    {
        if (!Exists(appId))
        {
            throw DockProblem.NotFound("The app's repository");
        }
    }

    private async Task<T> LockedAsync<T>(Guid appId, Func<Task<T>> action, CancellationToken cancellationToken)
    {
        var gate = locks.GetOrAdd(appId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            return await action();
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<byte[]> ReadBlobAsync(Guid appId, string spec, CancellationToken cancellationToken)
    {
        var start = new System.Diagnostics.ProcessStartInfo("git") { RedirectStandardOutput = true, UseShellExecute = false, WorkingDirectory = PathOf(appId) };
        foreach (var argument in new[] { "cat-file", "blob", spec })
        {
            start.ArgumentList.Add(argument);
        }

        start.Environment["GIT_CONFIG_NOSYSTEM"] = "1";
        start.Environment["GIT_CONFIG_GLOBAL"] = "/dev/null";
        using var process = System.Diagnostics.Process.Start(start)!;
        using var buffer = new MemoryStream();
        await process.StandardOutput.BaseStream.CopyToAsync(buffer, cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        return buffer.ToArray();
    }

    private static CommitInfo ParseCommit(string record)
    {
        var fields = record.Split('\x1f');
        return new CommitInfo(
            fields[0].Trim(),
            fields.Length > 5 ? fields[5].Trim() : "",
            fields[2],
            fields[3],
            DateTimeOffset.Parse(fields[4], CultureInfo.InvariantCulture),
            fields[1].Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static void CopyTemplate(string source, string destination)
    {
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(source, directory);
            if (IsExcluded(relative))
            {
                continue;
            }

            Directory.CreateDirectory(Path.Combine(destination, relative));
        }

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(source, file);
            if (IsExcluded(relative))
            {
                continue;
            }

            File.Copy(file, Path.Combine(destination, relative));
        }
    }

    // Build output and dependencies are never part of an app's source.
    private static bool IsExcluded(string relative) =>
        relative.Split(Path.DirectorySeparatorChar).Any(s => s is ".git" or "bin" or "obj" or "node_modules");

    private static Stream OpenDeleteOnClose(string file) =>
        new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, FileOptions.DeleteOnClose | FileOptions.Asynchronous);

    private static bool IsSafeReference(string name) => name.Length <= 200 && !name.StartsWith('-') && SafeReference().IsMatch(name) && !name.Contains("..", StringComparison.Ordinal);

    [GeneratedRegex("^[A-Za-z0-9._/@^~{}-]+$")]
    private static partial Regex SafeReference();
}
