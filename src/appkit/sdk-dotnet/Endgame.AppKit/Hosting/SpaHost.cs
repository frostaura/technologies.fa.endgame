using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace Endgame.AppKit;

/// <summary>
/// Serves the built front end so one image works under any address prefix (ARCH-005): the page's
/// <c>&lt;base href&gt;</c> is rewritten on every request from the forwarded prefix, and the page is
/// never served by default-file handling.
/// </summary>
internal sealed partial class SpaHost(IWebHostEnvironment environment)
{
    internal const string IndexFile = "index.html";

    /// <summary>Path prefixes that are never the front end, even when nothing else matched.</summary>
    internal static readonly string[] ReservedPrefixes =
        ["/api", "/" + CallbackEndpointExtensions.PlatformCallbackPrefix, "/" + CallbackEndpointExtensions.WebhookPrefix, "/_endgame", "/openapi", "/health"];

    private string? _template;

    [GeneratedRegex(@"<base\s+href=""[^""]*""\s*/?>", RegexOptions.IgnoreCase)]
    private static partial Regex BaseElement();

    // A src or href that starts with a single slash ignores <base> and breaks under a prefix.
    [GeneratedRegex(@"\s(?:src|href)=""/(?!/)[^""]*""", RegexOptions.IgnoreCase)]
    private static partial Regex RootRelativeUrl();

    // Anything fetched from another host at runtime: CDNs and font services are not allowed.
    [GeneratedRegex(@"\s(?:src|href)=""(?:https?:)?//[^""]*""", RegexOptions.IgnoreCase)]
    private static partial Regex ExternalUrl();

    internal IFileInfo Index => environment.WebRootFileProvider.GetFileInfo(IndexFile);

    /// <summary>Reads and checks the built page. Throws with the fix when the build is wrong.</summary>
    internal void Load()
    {
        var index = Index;
        if (!index.Exists)
        {
            if (environment.IsProduction())
            {
                throw new InvalidOperationException(
                    $"Endgame app kit: wwwroot/{IndexFile} is missing, so the app has no front end. " +
                    "The web build writes it; build the image with `make image` (dotnet publish runs the web build).");
            }

            return;
        }

        using var reader = new StreamReader(index.CreateReadStream());
        var html = reader.ReadToEnd();
        var problems = Check(html);
        if (problems.Count > 0)
        {
            throw new InvalidOperationException(
                $"Endgame app kit: wwwroot/{IndexFile} cannot be served under an address prefix:\n  - " + string.Join("\n  - ", problems));
        }

        _template = html;
    }

    internal static List<string> Check(string html)
    {
        var problems = new List<string>();
        if (!BaseElement().IsMatch(html))
        {
            problems.Add("it has no <base href=\"/\" /> element. Put one in web/index.html, first thing in <head>; the server rewrites it per request.");
        }

        var withoutBase = BaseElement().Replace(html, "");
        foreach (Match m in RootRelativeUrl().Matches(withoutBase))
        {
            problems.Add($"{m.Value.Trim()} is root-relative. Build with base: './' in vite.config.ts and write URLs without a leading slash.");
        }

        foreach (Match m in ExternalUrl().Matches(withoutBase))
        {
            problems.Add($"{m.Value.Trim()} loads from another host at runtime. Self-host it (fonts come from @fontsource packages).");
        }

        return problems;
    }

    internal static string Render(string template, PathString pathBase)
    {
        var href = WebUtility.HtmlEncode((pathBase.Value ?? "").TrimEnd('/') + "/");
        return BaseElement().Replace(template, $"<base href=\"{href}\" />", 1);
    }

    internal static bool IsReserved(PathString path) =>
        ReservedPrefixes.Any(prefix => path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase));

    internal IResult Page(HttpContext context)
    {
        if (IsReserved(context.Request.Path))
        {
            return Results.Problem(statusCode: 404, title: "Not found", detail: $"Nothing is mapped at {context.Request.Path}.");
        }

        if (_template is null)
        {
            return Results.Problem(statusCode: 404, title: "The front end is not built",
                detail: "wwwroot/index.html does not exist. Run `make build` (it builds web/ into api/wwwroot).");
        }

        context.Response.Headers.CacheControl = "no-cache";
        context.Response.Headers.XContentTypeOptions = "nosniff";
        return Results.Content(Render(_template, context.Request.PathBase), "text/html; charset=utf-8");
    }

    internal StaticFileOptions StaticFiles() => new()
    {
        FileProvider = new WithoutIndex(environment.WebRootFileProvider),
        ContentTypeProvider = new FileExtensionContentTypeProvider(),
        OnPrepareResponse = ctx =>
        {
            // Vite fingerprints everything under assets/; those never change at a given URL.
            ctx.Context.Response.Headers[HeaderNames.CacheControl] = ctx.Context.Request.Path.StartsWithSegments("/assets")
                ? new StringValues("public, max-age=31536000, immutable")
                : new StringValues("no-cache");
        },
    };

    /// <summary>The web root with index.html hidden, so it is only ever served rewritten.</summary>
    private sealed class WithoutIndex(IFileProvider inner) : IFileProvider
    {
        public IDirectoryContents GetDirectoryContents(string subpath) => inner.GetDirectoryContents(subpath);

        public IFileInfo GetFileInfo(string subpath) =>
            subpath.TrimStart('/').Equals(IndexFile, StringComparison.OrdinalIgnoreCase) ? new NotFoundFileInfo(subpath) : inner.GetFileInfo(subpath);

        public IChangeToken Watch(string filter) => inner.Watch(filter);
    }
}

internal static class SpaEndpoints
{
    internal static void MapSpa(this IEndpointRouteBuilder endpoints, SpaHost spa)
    {
        endpoints.MapMethods("{*path:nonfile}", [HttpMethods.Get, HttpMethods.Head], (HttpContext c) => spa.Page(c))
            .WithOrder(int.MaxValue)
            .ExcludeFromDescription();
        endpoints.MapMethods(SpaHost.IndexFile, [HttpMethods.Get, HttpMethods.Head], (HttpContext c) => spa.Page(c))
            .ExcludeFromDescription();
    }
}
