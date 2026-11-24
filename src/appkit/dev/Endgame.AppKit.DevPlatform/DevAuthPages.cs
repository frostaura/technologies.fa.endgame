using System.Net;
using Microsoft.AspNetCore.Http;

namespace Endgame.AppKit.DevPlatform;

/// <summary>
/// TEST DOUBLE. The sign-in, sign-up and sign-out pages Edge serves under every app address
/// (<c>&lt;app base&gt;/_endgame/auth/*</c>), faked: no password, no passkey — type an email and you
/// are that person. Sets a browser cookie that the dev edge turns into an app-scoped session.
/// </summary>
public static class DevAuthPages
{
    /// <summary>The browser cookie the dev edge reads. The real Edge's cookie is its own business.</summary>
    public const string Cookie = "endgame_dev_session";

    /// <summary>Handles a request whose path (below the app base) starts with <c>/_endgame/auth/</c>.</summary>
    public static async Task HandleAsync(HttpContext context, string appBase, DevPlatformState state)
    {
        var page = context.Request.Path.Value!["/_endgame/auth/".Length..];
        var returnTo = context.Request.Query["returnTo"].ToString();
        if (!IsInside(appBase, returnTo))
        {
            returnTo = appBase + "/";
        }

        switch (page, context.Request.Method)
        {
            case ("sign-in" or "sign-up", "GET"):
                await Html(context, Form(page, returnTo));
                return;
            case ("sign-in" or "sign-up", "POST"):
                var form = await context.Request.ReadFormAsync();
                var email = form["email"].ToString().Trim();
                if (!email.Contains('@', StringComparison.Ordinal))
                {
                    context.Response.StatusCode = 400;
                    await Html(context, Form(page, returnTo, "Enter an email address."));
                    return;
                }

                var kind = page == "sign-up" ? EndgameUserKind.EndUser : EndgameUserKind.Member;
                var token = state.CreateSession(email, kind, form["name"].ToString() is { Length: > 0 } n ? n : null);
                context.Response.Cookies.Append(Cookie, token, new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Lax, Path = appBase + "/" });
                context.Response.Redirect(returnTo);
                return;
            case ("sign-out", _):
                if (context.Request.Cookies.TryGetValue(Cookie, out var old))
                {
                    state.Sessions.TryRemove(old, out _);
                }

                context.Response.Cookies.Delete(Cookie, new CookieOptions { Path = appBase + "/" });
                context.Response.Redirect(appBase + "/");
                return;
            default:
                context.Response.StatusCode = 404;
                return;
        }
    }

    private static bool IsInside(string appBase, string url) =>
        url.StartsWith(appBase + "/", StringComparison.Ordinal) && !url.StartsWith("//", StringComparison.Ordinal);

    private static Task Html(HttpContext context, string body)
    {
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsync(body);
    }

    private static string Form(string page, string returnTo, string? error = null)
    {
        var title = page == "sign-up" ? "Create an account" : "Sign in";
        var action = $"{page}?returnTo={Uri.EscapeDataString(returnTo)}";
        return $$"""
            <!doctype html>
            <html lang="en"><head><meta charset="utf-8"><title>{{title}} — dev platform</title>
            <meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem">
            <p><strong>Endgame development platform</strong> — a test double. No password: you are whoever you say.</p>
            <h1>{{title}}</h1>
            {{(error is null ? "" : $"<p role=\"alert\">{WebUtility.HtmlEncode(error)}</p>")}}
            <form method="post" action="{{WebUtility.HtmlEncode(action)}}">
              <label>Email <input name="email" type="email" autocomplete="email" required></label>
              <label>Name <input name="name" autocomplete="name"></label>
              <button type="submit">{{title}}</button>
            </form>
            </body></html>
            """;
    }
}
