namespace Endgame.Hosting.Contracts;

/// <summary>
/// <c>POST /internal/apps/{id}/published</c> on the control plane, its shape: Dock started a new
/// version. The version is the commit the running image was built from.
/// </summary>
public sealed record PublishedReport(string Version);

/// <summary>
/// <c>POST /internal/apps/{id}/state</c> on the control plane, its shape: one of
/// <c>building</c>, <c>running</c>, <c>sleeping</c>, <c>stopped</c> or <c>failed</c>.
/// </summary>
public sealed record ControlPlaneAppState(string Status)
{
    public const string Failed = "failed";
}

/// <summary>
/// <c>POST /internal/apps/{id}/state</c> on Edge's control listener, sent by Dock whenever an app's
/// runtime state changes without being asked to — above all a crash.
/// </summary>
/// <param name="AppId">The app.</param>
/// <param name="State">One of <see cref="AppRuntimeState"/>.</param>
/// <param name="ExitCode">The process's exit code, when it exited.</param>
/// <param name="OutOfMemory">Killed for exceeding its memory limit.</param>
/// <param name="At">When Dock saw the change.</param>
public sealed record AppStateReport(Guid AppId, string State, int? ExitCode, bool OutOfMemory, DateTimeOffset At);

/// <summary>Edge's control listener: <c>POST /internal/routes/refresh</c> answers with this.</summary>
public sealed record RoutesRefreshed(string Version, int Apps);
