using Endgame.Dock.Apps;
using Endgame.Dock.Repositories;
using Endgame.Dock.Workspaces;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Api;

/// <summary>Dock's internal API (ARCH-004, "Dock — internal API"), plus the extensions it lists.</summary>
public static class DockEndpoints
{
    public static void MapDockApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/internal").AddEndpointFilter<ServiceTokenFilter>();

        // Repositories
        api.MapPost("/repos", async (CreateRepositoryRequest body, RepositoryService repos, CancellationToken ct) =>
        {
            RequireId(body.AppId, "appId");
            var info = await repos.CreateAsync(body.AppId, ct);
            return Results.Created($"/internal/repos/{body.AppId:D}", info);
        });
        api.MapGet("/repos/{appId:guid}", (Guid appId, RepositoryService repos, CancellationToken ct) => repos.InfoAsync(appId, ct));
        api.MapGet("/repos/{appId:guid}/log", (Guid appId, string? @ref, int? skip, int? limit, RepositoryService repos, CancellationToken ct) =>
            repos.LogAsync(appId, @ref, skip ?? 0, limit ?? 50, ct));
        api.MapGet("/repos/{appId:guid}/files", (Guid appId, string? @ref, string? path, int? offset, int? limit, RepositoryService repos, CancellationToken ct) =>
            repos.ReadAsync(appId, @ref, path, offset ?? 0, limit ?? 0, ct));
        api.MapPost("/repos/{appId:guid}/restore", (Guid appId, RestoreRequest body, RepositoryService repos, CancellationToken ct) => repos.RestoreAsync(appId, body, ct));
        api.MapGet("/repos/{appId:guid}/archive", async (Guid appId, string? @ref, RepositoryService repos, CancellationToken ct) =>
            Results.File(await repos.ArchiveAsync(appId, @ref, ct), "application/gzip", $"{appId:D}.tar.gz"));
        api.MapGet("/repos/{appId:guid}/export", async (Guid appId, RepositoryService repos, CancellationToken ct) =>
            Results.File(await repos.ExportAsync(appId, ct), "application/octet-stream", $"{appId:D}.bundle"));

        // Workspaces
        api.MapPost("/workspaces", async (CreateWorkspaceRequest body, WorkspaceService workspaces, CancellationToken ct) =>
        {
            var info = await workspaces.CreateAsync(body, ct);
            return Results.Created($"/internal/workspaces/{info.Id:D}", info);
        });
        api.MapGet("/workspaces/{id:guid}", (Guid id, WorkspaceService workspaces, CancellationToken ct) => workspaces.GetAsync(id, ct));
        api.MapPut("/workspaces/{id:guid}/lease", (Guid id, RenewLeaseRequest body, WorkspaceService workspaces, CancellationToken ct) => workspaces.RenewAsync(id, body.LeaseExpiresAt, ct));
        api.MapPost("/workspaces/{id:guid}/exec", (Guid id, ExecRequest body, WorkspaceService workspaces, CancellationToken ct) => workspaces.ExecAsync(id, body, ct));
        api.MapGet("/workspaces/{id:guid}/files", (Guid id, string? path, int? offset, int? limit, WorkspaceService workspaces, CancellationToken ct) =>
            workspaces.ReadAsync(id, path, offset ?? 0, limit ?? 0, ct));
        api.MapPut("/workspaces/{id:guid}/files", (Guid id, WriteFileRequest body, WorkspaceService workspaces, CancellationToken ct) => workspaces.WriteAsync(id, body, ct));
        api.MapPost("/workspaces/{id:guid}/commit", (Guid id, WorkspaceCommitRequest body, WorkspaceService workspaces, CancellationToken ct) => workspaces.CommitAsync(id, body, ct));
        api.MapDelete("/workspaces/{id:guid}", async (Guid id, WorkspaceService workspaces, CancellationToken ct) =>
            await workspaces.DestroyAsync(id, ct) ? Results.NoContent() : throw DockProblem.NotFound("The workspace"));

        // Apps
        api.MapPost("/apps/{id:guid}/build", (Guid id, BuildRequest? body, BuildService builds, CancellationToken ct) => builds.BuildAsync(id, body ?? new BuildRequest(null), ct));
        api.MapPost("/apps/{id:guid}/start", (Guid id, StartAppRequest body, AppService apps, CancellationToken ct) => apps.StartAsync(id, body, ct));
        // The evaluator's preview: the image on the app's network with a throwaway database of its own; destroyed after evaluation.
        api.MapPost("/apps/{id:guid}/preview", (Guid id, StartAppRequest body, AppService apps, CancellationToken ct) => apps.StartPreviewAsync(id, body, ct));
        api.MapDelete("/apps/{id:guid}/preview", async (Guid id, AppService apps, CancellationToken ct) =>
        {
            await apps.RemovePreviewAsync(id, ct);
            return Results.NoContent();
        });
        api.MapPost("/apps/{id:guid}/stop", (Guid id, AppService apps, CancellationToken ct) => apps.StopAsync(id, ct));
        api.MapPost("/apps/{id:guid}/wake", (Guid id, AppService apps, CancellationToken ct) => apps.WakeAsync(id, ct));
        api.MapGet("/apps/{id:guid}", (Guid id, AppService apps, CancellationToken ct) => apps.StatusAsync(id, ct));
        // The app's own data for the Owner's export: a pg_dump custom-format archive, or 404 not_found before it has a database.
        api.MapGet("/apps/{id:guid}/database/dump", async (Guid id, DatabaseProvisioner databases, CancellationToken ct) =>
        {
            var dump = await databases.DumpAsync(id, ct) ?? throw DockProblem.NotFound("The app's database");
            return Results.Stream(dump, "application/octet-stream", $"{id:D}.dump");
        });
        api.MapPut("/apps/{id:guid}/egress", (Guid id, EgressAllowList body, AppService apps, CancellationToken ct) => apps.SetEgressAsync(id, body, ct));
        // Hosting usage: close the period now and report it (the timer does this every UsageReportSeconds).
        api.MapPost("/usage/flush", async (Endgame.Dock.Platform.HostingUsageReporter usage, CancellationToken ct) => Results.Ok(new { taken = await usage.FlushAsync(ct) }));

        api.MapDelete("/apps/{id:guid}", async (Guid id, AppService apps, CancellationToken ct) =>
        {
            await apps.RetireAsync(id, ct);
            return Results.NoContent();
        });
    }

    private static void RequireId(Guid id, string name)
    {
        if (id == Guid.Empty)
        {
            throw DockProblem.Invalid($"{name} is required.");
        }
    }
}
