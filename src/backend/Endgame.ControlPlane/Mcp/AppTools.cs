using System.Text.Json.Nodes;
using Endgame.Application.Common;
using Endgame.Domain.Access;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Access;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.ControlPlane.Mcp;

/// <summary>
/// One app's MCP surface, derived at request time from the app's own OpenAPI document (cached with
/// the app's published version): a tool per operation. A call goes to the app through Edge with an
/// app-scoped session for the token's person, so the app sees that person exactly as it would at its
/// door. Only someone with a role on the app reaches it, as the app's access setting requires.
/// </summary>
internal static class AppTools
{
    public static async Task<IReadOnlyList<McpTool>> ForAsync(HttpContext http, Guid appId, CancellationToken cancellationToken)
    {
        var services = http.RequestServices;
        var app = await services.GetRequiredService<ScopeResolver>().FindNodeAsync(NodeLevel.App, appId, cancellationToken) ?? throw EndgameProblem.NotFound("The app");
        await services.GetRequiredService<AccessService>().RequireAsync(Endpoints.Caller.Id(http.User), app, MemberRole.Viewer, cancellationToken);
        var db = services.GetRequiredService<EndgameDbContext>();
        var version = await db.Apps.AsNoTracking().Where(a => a.OrganisationId == app.OrganisationId && a.Id == appId).Select(a => a.CurrentVersion).SingleOrDefaultAsync(cancellationToken);
        var gateway = services.GetRequiredService<AppGateway>();
        // An access token's role is the most the app may see this person as, however high their own role (D61).
        var ceiling = services.GetRequiredService<CallerCeiling>().Role;
        var operations = await gateway.OperationsAsync(appId, version, cancellationToken);
        return operations.Select(op => new McpTool(op.Tool, op.Description, op.InputSchema, op.Method == "get", async call =>
        {
            var token = await call.S<AppIdentityService>().MemberTokenAsync(app, call.UserId, call.Ct, ceiling);
            var result = await gateway.CallAsync(appId, op, call.Args, token, call.Ct);
            if (result.Status >= 400)
            {
                var problem = new EndgameProblem(result.Status, (result.Json?["code"] as JsonValue)?.GetValue<string>() ?? "app_error", "The app refused the call",
                    (result.Json?["detail"] as JsonValue)?.GetValue<string>() ?? result.Text);
                throw problem;
            }

            return (object?)new JsonObject
            {
                ["status"] = result.Status,
                ["body"] = result.Json?.DeepClone() ?? JsonValue.Create(result.Text),
                ["truncated"] = result.Truncated,
            };
        })).ToList();
    }
}
