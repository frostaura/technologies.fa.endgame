using Endgame.Tests.Fixtures;

namespace Endgame.Tests.ControlPlane;

/// <summary>The OpenAPI document lists every public endpoint ARCH-004 names, and the extensions this lane added.</summary>
[Collection(PostgresCollection.Name)]
public sealed class OpenApiContractTests(PostgresServer postgres)
{
    public static readonly (string Method, string Path)[] Arch004Public =
    [
        ("post", "/api/auth/passkey/register/options"),
        ("post", "/api/auth/passkey/register/complete"),
        ("post", "/api/auth/passkey/login/options"),
        ("post", "/api/auth/passkey/login/complete"),
        ("post", "/api/auth/logout"),
        ("get", "/api/me"),
        ("get", "/api/tree"),
        ("post", "/api/organisations"), ("patch", "/api/organisations/{id}"), ("delete", "/api/organisations/{id}"),
        ("post", "/api/divisions"), ("patch", "/api/divisions/{id}"), ("delete", "/api/divisions/{id}"),
        ("post", "/api/projects"), ("patch", "/api/projects/{id}"), ("delete", "/api/projects/{id}"),
        ("post", "/api/apps"), ("patch", "/api/apps/{id}"), ("delete", "/api/apps/{id}"),
        ("post", "/api/ideas"), ("get", "/api/ideas/{id}"), ("post", "/api/ideas/{id}/decision"),
        ("get", "/api/runs/{id}"), ("get", "/api/runs/{id}/events"),
        ("post", "/api/runs/{id}/pause"), ("post", "/api/runs/{id}/resume"), ("post", "/api/runs/{id}/cancel"),
        ("post", "/api/runs/{id}/approvals/{approvalId}"),
        ("get", "/api/tasks"),
        ("get", "/api/credits"),
        ("get", "/api/apps/{id}"), ("post", "/api/apps/{id}/settings"),
        ("post", "/api/conversations"),
        ("get", "/api/system/status"),
    ];

    public static readonly (string Method, string Path)[] Extensions =
    [
        ("get", "/api/auth/options"),
        ("post", "/api/ideas/estimate"),
        ("get", "/api/conversations"),
        ("get", "/api/cascade"), ("put", "/api/cascade"), ("delete", "/api/cascade"),
        ("get", "/api/members"), ("post", "/api/members"), ("delete", "/api/members/{membershipId}"),
        ("post", "/api/credits/top-ups"),
        ("get", "/api/autonomy"), ("put", "/api/autonomy"), ("delete", "/api/autonomy"),
        ("put", "/api/autonomy/rule-sets"), ("delete", "/api/autonomy/rule-sets"),
        ("get", "/api/employees"), ("get", "/api/employees/recurring-roles"), ("get", "/api/employees/{id}"), ("patch", "/api/employees/{id}"),
        ("get", "/api/employees/{id}/track-record"), ("post", "/api/employees/{id}/reassign"), ("post", "/api/employees/{id}/release"), ("post", "/api/employees/{id}/rehire"),
        ("get", "/api/employees/{id}/memory"), ("post", "/api/employees/{id}/memory"), ("patch", "/api/employees/{id}/memory/{entryId}"), ("delete", "/api/employees/{id}/memory/{entryId}"),
        ("get", "/api/employees/{id}/memory/changes"), ("post", "/api/employees/{id}/reviews"),
        ("get", "/api/hires"), ("post", "/api/hires"), ("get", "/api/hires/{id}"), ("patch", "/api/hires/{id}"), ("post", "/api/hires/{id}/accept"), ("post", "/api/hires/{id}/decline"),
        ("get", "/api/ontology"),
    ];

    [Fact]
    public async Task Lists_every_public_endpoint()
    {
        await using var app = await ControlPlaneApp.StartAsync(postgres);
        var paths = (await ControlPlaneApp.Ok(app.Client().GetAsync("/api/openapi/v1.json")))["paths"]!.AsObject();
        var missing = Arch004Public.Concat(Extensions)
            .Where(e => !paths.ContainsKey(e.Path) || !paths[e.Path]!.AsObject().ContainsKey(e.Method))
            .Select(e => $"{e.Method.ToUpperInvariant()} {e.Path}")
            .ToList();
        Assert.Empty(missing);
    }
}
