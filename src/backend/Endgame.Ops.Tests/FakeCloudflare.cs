using System.Net;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Endgame.Ops.Tests;

/// <summary>
/// A local stand-in for the parts of Cloudflare's v4 API Endgame uses, on a loopback port, holding
/// one account, one zone and one tunnel in memory. Request and response shapes follow the reference
/// pages cited on each <see cref="Cloudflare.CloudflareClient"/> method: the
/// <c>{ success, errors[{code, message}], messages, result, result_info }</c> envelope, paged DNS
/// listing, the tunnel configuration's <c>{ config: { ingress } }</c> with a version that moves on
/// every PUT, multipart Worker upload with a <c>metadata</c> part, and Worker routes with an optional
/// script. It also enforces the rules the real API enforces that this code could break: a CNAME
/// may not share its name with another A/AAAA/CNAME record, a Free-plan comment is at most 100
/// characters, the last ingress rule must be a catch-all, and a route pattern is unique.
/// It never talks to Cloudflare.
/// </summary>
public sealed class FakeCloudflare : IAsyncDisposable
{
    public const string Token = "fake-cloudflare-token-0001";
    public const string AccountId = "0123456789abcdef0123456789abcdef";
    public const string ZoneId = "fedcba9876543210fedcba9876543210";
    public const string TunnelId = "5b7c3f0e-9a1d-4e2b-8c6f-1d2e3f4a5b6c";

    private readonly WebApplication app;
    private readonly Lock gate = new();

    private FakeCloudflare(WebApplication app)
    {
        this.app = app;
    }

    public string BaseUrl { get; private set; } = "";

    public List<JsonObject> Records { get; } = [];

    public List<JsonObject> Routes { get; } = [];

    public JsonObject TunnelConfig { get; set; } = new() { ["ingress"] = new JsonArray(new JsonObject { ["service"] = "http_status:404" }) };

    public long TunnelVersion { get; private set; } = 1;

    public string? WorkerSource { get; private set; }

    public JsonArray? WorkerBindings { get; private set; }

    public int WorkerUploads { get; private set; }

    /// <summary>Every request, in order: method, path and query, and the body as sent.</summary>
    public List<(string Method, string Path, string Body)> Requests { get; } = [];

    public IEnumerable<(string Method, string Path, string Body)> Mutations => Requests.Where(r => r.Method != "GET");

    public static async Task<FakeCloudflare> StartAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        var fake = new FakeCloudflare(app);
        fake.Map(app);
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        fake.BaseUrl = address.TrimEnd('/') + "/client/v4";
        return fake;
    }

    public JsonObject AddRecord(string type, string name, string content, bool proxied = false, string? comment = null)
    {
        var record = Record(type, name, content, proxied, 1, comment);
        lock (gate)
        {
            Records.Add(record);
        }

        return record;
    }

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
    }

    private static string NewId() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    private static JsonObject Record(string type, string name, string content, bool proxied, int ttl, string? comment) => new()
    {
        ["id"] = NewId(),
        ["zone_id"] = ZoneId,
        ["zone_name"] = "example.test",
        ["name"] = name,
        ["type"] = type,
        ["content"] = content,
        ["proxiable"] = true,
        ["proxied"] = proxied,
        ["ttl"] = ttl,
        ["comment"] = comment,
        ["tags"] = new JsonArray(),
        ["settings"] = new JsonObject(),
        ["meta"] = new JsonObject(),
        ["created_on"] = "2026-11-25T00:00:00.000000Z",
        ["modified_on"] = "2026-11-25T00:00:00.000000Z",
    };

    private static IResult Ok(JsonNode? result, JsonObject? resultInfo = null)
    {
        var body = new JsonObject { ["success"] = true, ["errors"] = new JsonArray(), ["messages"] = new JsonArray(), ["result"] = result };
        if (resultInfo is not null)
        {
            body["result_info"] = resultInfo;
        }

        return Results.Text(body.ToJsonString(), "application/json");
    }

    private static IResult Fail(HttpStatusCode status, int code, string message) => Results.Text(
        new JsonObject
        {
            ["success"] = false,
            ["errors"] = new JsonArray(new JsonObject { ["code"] = code, ["message"] = message }),
            ["messages"] = new JsonArray(),
            ["result"] = null,
        }.ToJsonString(),
        "application/json",
        statusCode: (int)status);

    private void Map(WebApplication web)
    {
        web.Use(async (context, next) =>
        {
            context.Request.EnableBuffering();
            var body = await new StreamReader(context.Request.Body).ReadToEndAsync();
            context.Request.Body.Position = 0;
            lock (gate)
            {
                Requests.Add((context.Request.Method, context.Request.Path + context.Request.QueryString, body));
            }

            if (context.Request.Headers.Authorization != $"Bearer {Token}")
            {
                await Fail(HttpStatusCode.Forbidden, 10000, "Authentication error").ExecuteAsync(context);
                return;
            }

            await next(context);
        });

        var zone = web.MapGroup($"/client/v4/zones/{{zone}}").AddEndpointFilter(async (ctx, next) =>
            (string?)ctx.HttpContext.GetRouteValue("zone") == ZoneId ? await next(ctx) : Fail(HttpStatusCode.NotFound, 7003, "Could not route to /zones, perhaps your object identifier is invalid?"));
        var account = web.MapGroup($"/client/v4/accounts/{{account}}").AddEndpointFilter(async (ctx, next) =>
            (string?)ctx.HttpContext.GetRouteValue("account") == AccountId ? await next(ctx) : Fail(HttpStatusCode.NotFound, 7003, "Could not route to /accounts."));

        zone.MapGet("/dns_records", (int? page, int? per_page) =>
        {
            lock (gate)
            {
                var size = Math.Clamp(per_page ?? 100, 1, 5_000_000);
                var number = Math.Max(1, page ?? 1);
                var slice = Records.Skip((number - 1) * size).Take(size).Select(r => r.DeepClone()).ToArray();
                return Ok(new JsonArray(slice), new JsonObject
                {
                    ["page"] = number,
                    ["per_page"] = size,
                    ["count"] = slice.Length,
                    ["total_count"] = Records.Count,
                    ["total_pages"] = Math.Max(1, (Records.Count + size - 1) / size),
                });
            }
        });

        zone.MapPost("/dns_records", (JsonObject body) =>
        {
            lock (gate)
            {
                if (Validate(body, null) is { } refusal)
                {
                    return refusal;
                }

                var record = Record((string)body["type"]!, (string)body["name"]!, (string)body["content"]!, (bool?)body["proxied"] ?? false, (int?)body["ttl"] ?? 1, (string?)body["comment"]);
                Records.Add(record);
                return Ok(record.DeepClone());
            }
        });

        zone.MapMethods("/dns_records/{id}", ["PATCH"], (string id, JsonObject body) =>
        {
            lock (gate)
            {
                var record = Records.FirstOrDefault(r => (string)r["id"]! == id);
                if (record is null)
                {
                    return Fail(HttpStatusCode.NotFound, 81044, "Record does not exist.");
                }

                if (Validate(body, id) is { } refusal)
                {
                    return refusal;
                }

                foreach (var (key, value) in body)
                {
                    record[key] = value?.DeepClone();
                }

                record["modified_on"] = "2026-11-25T00:00:01.000000Z";
                return Ok(record.DeepClone());
            }
        });

        zone.MapDelete("/dns_records/{id}", (string id) =>
        {
            lock (gate)
            {
                return Records.RemoveAll(r => (string)r["id"]! == id) == 0
                    ? Fail(HttpStatusCode.NotFound, 81044, "Record does not exist.")
                    : Ok(new JsonObject { ["id"] = id });
            }
        });

        account.MapGet($"/cfd_tunnel/{{tunnel}}/configurations", (string tunnel) =>
        {
            lock (gate)
            {
                return tunnel != TunnelId ? Fail(HttpStatusCode.NotFound, 1003, "Tunnel not found") : Ok(TunnelResult());
            }
        });

        account.MapPut($"/cfd_tunnel/{{tunnel}}/configurations", (string tunnel, JsonObject body) =>
        {
            lock (gate)
            {
                if (tunnel != TunnelId)
                {
                    return Fail(HttpStatusCode.NotFound, 1003, "Tunnel not found");
                }

                if (body["config"] is not JsonObject config || config["ingress"] is not JsonArray ingress || ingress.Count == 0)
                {
                    return Fail(HttpStatusCode.BadRequest, 1055, "Invalid configuration: config.ingress is required");
                }

                if (ingress[^1]?["hostname"] is not null || ingress[^1]?["path"] is not null)
                {
                    return Fail(HttpStatusCode.BadRequest, 1056, "Invalid ingress: the last ingress rule must match all URLs (no hostname or path)");
                }

                TunnelConfig = (JsonObject)config.DeepClone();
                TunnelVersion++;
                return Ok(TunnelResult());
            }
        });

        account.MapGet("/workers/scripts/{script}/settings", (string script) =>
        {
            lock (gate)
            {
                return WorkerSource is null || script != "endgame-outage"
                    ? Fail(HttpStatusCode.NotFound, 10007, "This Worker does not exist on your account.")
                    : Ok(new JsonObject
                    {
                        ["bindings"] = WorkerBindings!.DeepClone(),
                        ["compatibility_date"] = "2025-11-01",
                        ["compatibility_flags"] = new JsonArray(),
                        ["logpush"] = false,
                        ["placement"] = new JsonObject(),
                        ["tags"] = new JsonArray(),
                        ["usage_model"] = "standard",
                    });
            }
        });

        account.MapPut("/workers/scripts/{script}", async (string script, HttpRequest request) =>
        {
            if (!request.HasFormContentType)
            {
                return Fail(HttpStatusCode.BadRequest, 10021, "Expected multipart/form-data");
            }

            var form = await request.ReadFormAsync();
            var metadataText = form["metadata"].ToString();
            if (metadataText.Length == 0 && form.Files.GetFile("metadata") is { } metadataFile)
            {
                using var reader = new StreamReader(metadataFile.OpenReadStream());
                metadataText = await reader.ReadToEndAsync();
            }

            if (JsonNode.Parse(metadataText) is not JsonObject metadata || metadata["main_module"]?.GetValue<string>() is not { } main)
            {
                return Fail(HttpStatusCode.BadRequest, 10021, "metadata with main_module is required");
            }

            var module = form.Files.GetFile(main);
            if (module is null || module.ContentType != "application/javascript+module")
            {
                return Fail(HttpStatusCode.BadRequest, 10021, $"No module part named {main} of type application/javascript+module");
            }

            using var source = new StreamReader(module.OpenReadStream());
            var text = await source.ReadToEndAsync();
            lock (gate)
            {
                WorkerSource = text;
                WorkerBindings = metadata["bindings"] as JsonArray ?? [];
                WorkerUploads++;
                return Ok(new JsonObject
                {
                    ["id"] = script,
                    ["etag"] = Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text))),
                    ["handlers"] = new JsonArray("fetch"),
                    ["modified_on"] = "2026-11-25T00:00:00.000000Z",
                    ["created_on"] = "2026-11-25T00:00:00.000000Z",
                    ["usage_model"] = "standard",
                    ["compatibility_date"] = metadata["compatibility_date"]?.DeepClone(),
                });
            }
        });

        zone.MapGet("/workers/routes", () =>
        {
            lock (gate)
            {
                return Ok(new JsonArray(Routes.Select(r => r.DeepClone()).ToArray()));
            }
        });

        zone.MapPost("/workers/routes", (JsonObject body) =>
        {
            lock (gate)
            {
                var pattern = (string?)body["pattern"];
                if (string.IsNullOrEmpty(pattern))
                {
                    return Fail(HttpStatusCode.BadRequest, 10019, "pattern is required");
                }

                if (Routes.Any(r => (string)r["pattern"]! == pattern))
                {
                    return Fail(HttpStatusCode.Conflict, 10020, "A route with the same pattern already exists.");
                }

                var route = new JsonObject { ["id"] = NewId(), ["pattern"] = pattern };
                if (body["script"] is { } s)
                {
                    route["script"] = s.DeepClone();
                }

                Routes.Add(route);
                return Ok(route.DeepClone());
            }
        });

        zone.MapPut("/workers/routes/{id}", (string id, JsonObject body) =>
        {
            lock (gate)
            {
                var route = Routes.FirstOrDefault(r => (string)r["id"]! == id);
                if (route is null)
                {
                    return Fail(HttpStatusCode.NotFound, 10022, "Route not found");
                }

                route["pattern"] = body["pattern"]?.DeepClone();
                route.Remove("script");
                if (body["script"] is { } s)
                {
                    route["script"] = s.DeepClone();
                }

                return Ok(route.DeepClone());
            }
        });

        zone.MapDelete("/workers/routes/{id}", (string id) =>
        {
            lock (gate)
            {
                return Routes.RemoveAll(r => (string)r["id"]! == id) == 0 ? Fail(HttpStatusCode.NotFound, 10022, "Route not found") : Ok(new JsonObject { ["id"] = id });
            }
        });
    }

    private JsonObject TunnelResult() => new()
    {
        ["account_id"] = AccountId,
        ["tunnel_id"] = TunnelId,
        ["version"] = TunnelVersion,
        ["config"] = TunnelConfig.DeepClone(),
        ["source"] = "cloudflare",
        ["created_at"] = "2026-11-25T00:00:00Z",
    };

    /// <summary>The checks Cloudflare applies to a record write that matter here.</summary>
    private IResult? Validate(JsonObject body, string? id)
    {
        var existing = id is null ? null : Records.First(r => (string)r["id"]! == id);
        var type = (string?)body["type"] ?? (string?)existing?["type"];
        var name = (string?)body["name"] ?? (string?)existing?["name"];
        if (type is null || name is null || ((string?)body["content"] ?? (string?)existing?["content"]) is null)
        {
            return Fail(HttpStatusCode.BadRequest, 9000, "type, name and content are required.");
        }

        if (((string?)body["comment"])?.Length > 100)
        {
            return Fail(HttpStatusCode.BadRequest, 9101, "DNS record comment cannot be longer than 100 characters on this plan.");
        }

        if (type is "CNAME" or "A" or "AAAA" && Records.Any(r => (string)r["id"]! != id && ((string)r["name"]!).Equals(name, StringComparison.OrdinalIgnoreCase)
            && ((string)r["type"]! == "CNAME" || type == "CNAME")))
        {
            return Fail(HttpStatusCode.BadRequest, 81053, "An A, AAAA, or CNAME record with that host already exists.");
        }

        return null;
    }
}
