namespace Endgame.Hosting.Contracts;

/// <summary>
/// <c>POST /internal/apps/{id}/published</c> on the control plane: Dock started a new version.
/// </summary>
public sealed record AppPublished(Guid AppId, string Commit, string Image, DateTimeOffset At);

/// <summary>
/// <c>POST /internal/apps/{id}/state</c>, sent by Dock to the control plane and to Edge's control
/// listener whenever an app's runtime state changes without being asked to — above all a crash.
/// </summary>
/// <param name="AppId">The app.</param>
/// <param name="State">One of <see cref="AppRuntimeState"/>.</param>
/// <param name="ExitCode">The process's exit code, when it exited.</param>
/// <param name="OutOfMemory">Killed for exceeding its memory limit.</param>
/// <param name="At">When Dock saw the change.</param>
public sealed record AppStateReport(Guid AppId, string State, int? ExitCode, bool OutOfMemory, DateTimeOffset At);

/// <summary>Edge's control listener: <c>POST /internal/routes/refresh</c> answers with this.</summary>
public sealed record RoutesRefreshed(string Version, int Apps);
