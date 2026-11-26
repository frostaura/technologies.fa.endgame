namespace Endgame.Hosting.Contracts;

// Dock's internal API (ARCH-004, "Dock — internal API"). Every call carries the service token;
// every failure is a problem-details body whose `code` extension is one of DockProblemCodes.

/// <summary><c>POST /internal/repos</c>: create an app's repository from the app-kit template.</summary>
public sealed record CreateRepositoryRequest(Guid AppId);

/// <summary>An app's repository.</summary>
/// <param name="AppId">The app.</param>
/// <param name="Branch">The branch every version is committed to.</param>
/// <param name="Head">The newest commit on it.</param>
public sealed record RepositoryInfo(Guid AppId, string Branch, string Head);

/// <summary>One commit.</summary>
public sealed record CommitInfo(
    string Id,
    string Message,
    string AuthorName,
    string AuthorEmail,
    DateTimeOffset At,
    IReadOnlyList<string> Parents);

/// <summary><c>GET /internal/repos/{appId}/log</c>: newest first, paged by <c>skip</c> and <c>limit</c>.</summary>
public sealed record CommitLog(IReadOnlyList<CommitInfo> Commits, bool HasMore);

/// <summary>
/// <c>POST /internal/repos/{appId}/restore</c>: make the tree at <paramref name="Ref"/> the newest
/// version, as a new commit on top. History is never rewritten.
/// </summary>
public sealed record RestoreRequest(string Ref, string AuthorName, string AuthorEmail, string? Message);

/// <summary><c>POST /internal/workspaces</c>.</summary>
/// <param name="RunId">The run the workspace serves; also its id (one workspace per run).</param>
/// <param name="AppId">Whose repository to check out.</param>
/// <param name="Ref">Branch, tag or commit; the app's branch head when null.</param>
/// <param name="LeaseExpiresAt">The run's lease. Dock destroys the workspace once it lapses.</param>
/// <param name="Limits">Resource limits; Dock's defaults when null, capped at Dock's maxima.</param>
/// <param name="AllowedHosts">Outbound hosts beyond the package registries. Default deny.</param>
public sealed record CreateWorkspaceRequest(
    Guid RunId,
    Guid AppId,
    string? Ref,
    DateTimeOffset LeaseExpiresAt,
    ResourceLimits? Limits,
    IReadOnlyList<string>? AllowedHosts);

/// <summary>CPU, memory and process limits for a workspace or an app.</summary>
public sealed record ResourceLimits(double Cpus, int MemoryMb, int Pids);

/// <summary>A workspace.</summary>
/// <param name="Id">Equal to the run id.</param>
/// <param name="AppId">The app whose code it holds.</param>
/// <param name="BaseCommit">The commit it was created at.</param>
/// <param name="Root">The directory every path is relative to.</param>
/// <param name="LeaseExpiresAt">When Dock destroys it unless the lease is renewed.</param>
/// <param name="Limits">The limits it runs under.</param>
public sealed record WorkspaceInfo(
    Guid Id,
    Guid AppId,
    string BaseCommit,
    string Root,
    DateTimeOffset LeaseExpiresAt,
    ResourceLimits Limits);

/// <summary><c>PUT /internal/workspaces/{id}/lease</c>: the run's lease was renewed.</summary>
public sealed record RenewLeaseRequest(DateTimeOffset LeaseExpiresAt);

/// <summary>
/// <c>POST /internal/workspaces/{id}/exec</c>. Give exactly one of <paramref name="Command"/> (an
/// argument vector, run directly) or <paramref name="Shell"/> (a line run by <c>bash -lc</c>).
/// </summary>
public sealed record ExecRequest(
    IReadOnlyList<string>? Command,
    string? Shell,
    int? TimeoutSeconds,
    int? MaxOutputBytes,
    string? WorkingDirectory,
    IReadOnlyDictionary<string, string>? Environment);

/// <summary>
/// The outcome of an exec. Output past the cap keeps its head and tail with a marker between, so
/// both the command and the error at the end survive.
/// </summary>
public sealed record ExecResult(
    int ExitCode,
    string Stdout,
    string Stderr,
    bool Truncated,
    bool TimedOut,
    long DurationMs);

/// <summary>
/// <c>GET /internal/workspaces/{id}/files</c> and <c>GET /internal/repos/{appId}/files</c>. A file
/// is paged by line (<c>offset</c>, <c>limit</c>); a directory by entry.
/// </summary>
/// <param name="Path">The path, relative to the root.</param>
/// <param name="Kind"><c>file</c> or <c>directory</c>.</param>
/// <param name="Content">The page of lines, joined by <c>\n</c>; base64 of the whole file when binary.</param>
/// <param name="Binary">The file is not text.</param>
/// <param name="Entries">The page of entries, for a directory.</param>
/// <param name="Offset">The first line or entry returned (zero-based).</param>
/// <param name="Total">Lines or entries in all.</param>
/// <param name="HasMore">Another page follows.</param>
public sealed record FilePage(
    string Path,
    string Kind,
    string? Content,
    bool Binary,
    IReadOnlyList<DirectoryEntry>? Entries,
    int Offset,
    int Total,
    bool HasMore);

/// <summary>One entry in a directory listing.</summary>
/// <param name="Name">Its name.</param>
/// <param name="Kind"><c>file</c>, <c>directory</c> or <c>link</c>.</param>
/// <param name="Size">Bytes, for a file.</param>
public sealed record DirectoryEntry(string Name, string Kind, long Size);

/// <summary><c>PUT /internal/workspaces/{id}/files</c>. Encoding is <c>utf-8</c> (default) or <c>base64</c>.</summary>
public sealed record WriteFileRequest(string Path, string Content, string? Encoding);

/// <summary>The written file.</summary>
public sealed record WriteFileResult(string Path, long Bytes);

/// <summary><c>POST /internal/workspaces/{id}/commit</c>: the employee is the author.</summary>
public sealed record WorkspaceCommitRequest(string Message, string AuthorName, string AuthorEmail);

/// <summary>
/// <c>POST /internal/repos/{appId}/runs/{runId}/publish</c>: the run's work becomes the app's next version (R2-4). A run's
/// commits are kept on its own branch (<see cref="RunBranches"/>) while it works; only publishing puts them on the app's
/// line, as one commit whose message is <paramref name="Title"/> — what the person asked for — so the history lists what
/// was live, and a run that never published leaves nothing on it.
/// </summary>
public sealed record PublishRunRequest(string Title, string AuthorName, string AuthorEmail);

/// <summary>Where a run's work is kept until it is published.</summary>
public static class RunBranches
{
    /// <summary>The trailer naming the run in a published version's commit message.</summary>
    public const string Trailer = "Endgame-Run";

    /// <summary>The branch a run's commits are kept on: <c>runs/&lt;run id, 32 hex&gt;</c>.</summary>
    public static string Of(Guid runId) => $"runs/{runId:N}";

    /// <summary>The run a published version's message names, or null.</summary>
    public static Guid? RunOf(string? message)
    {
        foreach (var line in (message ?? "").Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith(Trailer + ":", StringComparison.Ordinal) && Guid.TryParse(trimmed[(Trailer.Length + 1)..].Trim(), out var run))
            {
                return run;
            }
        }

        return null;
    }
}

/// <summary>The commit now at the head of the run's branch.</summary>
/// <param name="CommitId">The commit.</param>
/// <param name="Changed">False when the workspace held nothing new: the id is the unchanged head.</param>
public sealed record WorkspaceCommitResult(string CommitId, bool Changed);

/// <summary><c>POST /internal/apps/{id}/build</c>.</summary>
/// <param name="Ref">Branch, tag or commit; the branch head when null.</param>
public sealed record BuildRequest(string? Ref);

/// <summary>A built image, ready to start.</summary>
public sealed record BuildResult(Guid AppId, string Commit, string Image, long DurationMs, string LogTail);

/// <summary>
/// <c>POST /internal/apps/{id}/start</c>. Provisions the app's network, database and role on first
/// use, and replaces the container when the image or token changed — that is a publish, reported
/// to the control plane.
/// </summary>
/// <param name="OrganisationId">The app's organisation.</param>
/// <param name="Image">A built image; the newest build of the app when null.</param>
/// <param name="AppToken">The platform token the app kit presents. Minted by the control plane.</param>
/// <param name="Limits">The app's limits; Dock's defaults when null.</param>
/// <param name="AllowedHosts">Outbound hosts the app may reach through the egress proxy.</param>
public sealed record StartAppRequest(
    Guid OrganisationId,
    string? Image,
    string? AppToken,
    ResourceLimits? Limits,
    IReadOnlyList<string>? AllowedHosts);

/// <summary><c>PUT /internal/apps/{id}/egress</c>: replace an app's outbound allow-list.</summary>
public sealed record EgressAllowList(IReadOnlyList<string> AllowedHosts);

/// <summary><c>GET /internal/apps/{id}</c> and the answer to every lifecycle call.</summary>
/// <param name="AppId">The app.</param>
/// <param name="State">One of <see cref="AppRuntimeState"/>.</param>
/// <param name="Image">The image its container runs.</param>
/// <param name="Commit">The commit that image was built from.</param>
/// <param name="Target">Where Edge reaches it.</param>
/// <param name="Subnet">Its network's subnet.</param>
/// <param name="StartedAt">Last start.</param>
/// <param name="StoppedAt">Last stop or crash.</param>
/// <param name="ExitCode">Exit code of the last exit.</param>
/// <param name="OutOfMemory">The last exit was the memory limit.</param>
/// <param name="MemoryBytes">Memory in real use when last sampled, while running.</param>
/// <param name="Limits">The limits it runs under.</param>
public sealed record AppStatus(
    Guid AppId,
    string State,
    string? Image,
    string? Commit,
    string Target,
    string? Subnet,
    DateTimeOffset? StartedAt,
    DateTimeOffset? StoppedAt,
    int? ExitCode,
    bool OutOfMemory,
    long? MemoryBytes,
    ResourceLimits? Limits);

/// <summary>An app's runtime state, as Dock sees it.</summary>
public static class AppRuntimeState
{
    /// <summary>Never started: no container yet.</summary>
    public const string NotProvisioned = "not_provisioned";

    /// <summary>Its process is running.</summary>
    public const string Running = "running";

    /// <summary>Stopped on purpose and kept, ready to wake.</summary>
    public const string Sleeping = "sleeping";

    /// <summary>Its process exited without being asked to.</summary>
    public const string Crashed = "crashed";
}

/// <summary>The <c>code</c> extension on every problem-details body Dock returns.</summary>
public static class DockProblemCodes
{
    /// <summary>Missing or wrong service token.</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>The request body or a parameter is invalid.</summary>
    public const string Invalid = "invalid_request";

    /// <summary>The named repository, workspace, app, ref or file does not exist.</summary>
    public const string NotFound = "not_found";

    /// <summary>It already exists.</summary>
    public const string AlreadyExists = "already_exists";

    /// <summary>A path outside the workspace root or inside <c>.git/</c>.</summary>
    public const string ProtectedPath = "protected_path";

    /// <summary>The app's branch moved since the workspace was created; nothing was lost.</summary>
    public const string Conflict = "conflict";

    /// <summary>The app has no built image, or no container, to act on.</summary>
    public const string NotPublished = "not_published";

    /// <summary>Starting the app would exceed the memory budget of the machine.</summary>
    public const string Capacity = "capacity";

    /// <summary>The build of the app failed; the problem's detail carries the log's tail.</summary>
    public const string BuildFailed = "build_failed";

    /// <summary>The workspace image is still being prepared, or failed to build.</summary>
    public const string WorkspaceImageNotReady = "workspace_image_not_ready";

    /// <summary>The app-kit template is missing from Dock.</summary>
    public const string TemplateUnavailable = "template_unavailable";

    /// <summary>The file is too large to return or accept.</summary>
    public const string TooLarge = "too_large";

    /// <summary>The Docker Engine or the database server did not answer.</summary>
    public const string Unavailable = "unavailable";
}
