using System.Net;

namespace Endgame.Edge.Pages;

/// <summary>Why the edge is answering instead of the app.</summary>
public enum Unavailable
{
    /// <summary>The app stopped working and is being kept down for a moment.</summary>
    Crashed,

    /// <summary>The organisation's credits reached the overdraft limit.</summary>
    Paused,

    /// <summary>The machine has no room to start it right now.</summary>
    Busy,

    /// <summary>It has an address, but nothing has been published there yet.</summary>
    NotReady,

    /// <summary>It took too long to start.</summary>
    Slow,

    /// <summary>Something the edge needed did not answer.</summary>
    Temporary,

    /// <summary>Signed in, without access to this app.</summary>
    Forbidden,
}

/// <summary>
/// The page a visitor sees when an app cannot answer: plain language, the Endgame mark, and never
/// a word about the machinery (CLAUDE.md rule 12 — no containers, servers or networks).
/// </summary>
public static class UnavailablePage
{
    public const string MarkPath = "/brand/endgame-mark.svg";

    public static int StatusFor(Unavailable reason) => reason switch
    {
        Unavailable.Forbidden => StatusCodes.Status403Forbidden,
        _ => StatusCodes.Status503ServiceUnavailable,
    };

    public static (string Title, string Message) Copy(Unavailable reason) => reason switch
    {
        Unavailable.Crashed => ("This app has stopped for a moment",
            "Something went wrong inside it. It will be started again shortly — please try again in a moment."),
        Unavailable.Paused => ("This app is paused",
            "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up."),
        Unavailable.Busy => ("This app could not start just now",
            "Endgame is very busy at the moment. Please try again in a minute."),
        Unavailable.NotReady => ("This app isn't ready yet",
            "It has an address, but its first version has not been published. Please check back soon."),
        Unavailable.Slow => ("This app is taking longer than usual",
            "It is still starting. Please try again in a few seconds."),
        Unavailable.Forbidden => ("You don't have access to this app",
            "You are signed in, but this app has not been shared with you. Ask its owner for access."),
        _ => ("This app is temporarily unavailable",
            "Endgame could not reach it just now. Please try again in a moment."),
    };

    /// <summary>The page, with the mark loaded from <paramref name="markUrl"/> when one is known.</summary>
    public static string Render(Unavailable reason, string? markUrl)
    {
        var (title, message) = Copy(reason);
        var mark = markUrl is null
            ? "<span class=\"wordmark\">Endgame</span>"
            : $"<img class=\"mark\" src=\"{WebUtility.HtmlEncode(markUrl)}\" alt=\"Endgame\" width=\"48\" height=\"48\">";
        // The token layer for this page: the console's own role values (src/frontend/src/lib/tokens.ts).
        return $$"""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <title>{{WebUtility.HtmlEncode(title)}} · Endgame</title>
            <style>
              :root {
                --ground: #F5F6FB; --surface: #FFFFFF; --ink: #0B1020; --ink-muted: #535B70; --border: #E4E7F2;
                --primary: #2F5BFF; --radius-lg: 24px; --space: 16px; --measure: 32rem;
                --shadow-card: 0 1px 2px rgb(11 16 32 / 0.04), 0 8px 24px -12px rgb(11 16 32 / 0.10);
                --font-sans: "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif;
                --font-display: "Space Grotesk Variable", "Space Grotesk", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
              }
              * { box-sizing: border-box; }
              body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: calc(var(--space) * 1.5);
                     background: var(--ground); color: var(--ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
              main { width: 100%; max-width: var(--measure); background: var(--surface); border: 1px solid var(--border);
                     border-radius: var(--radius-lg); box-shadow: var(--shadow-card); padding: calc(var(--space) * 2.5); }
              .mark { display: block; margin-bottom: calc(var(--space) * 1.5); }
              .wordmark { display: inline-block; margin-bottom: calc(var(--space) * 1.5); font-family: var(--font-display); font-weight: 600; color: var(--primary); }
              h1 { margin: 0 0 calc(var(--space) * 0.75); font-family: var(--font-display); font-size: 1.5rem; letter-spacing: -0.01em; line-height: 1.2; }
              p { margin: 0; color: var(--ink-muted); line-height: 1.6; }
            </style>
            </head>
            <body>
            <main>
            {{mark}}
            <h1>{{WebUtility.HtmlEncode(title)}}</h1>
            <p>{{WebUtility.HtmlEncode(message)}}</p>
            </main>
            </body>
            </html>
            """;
    }

    public static async Task WriteAsync(HttpContext context, Unavailable reason, string? markUrl)
    {
        var response = context.Response;
        response.Clear();
        response.StatusCode = StatusFor(reason);
        response.ContentType = "text/html; charset=utf-8";
        response.Headers.CacheControl = "no-store";
        if (reason is Unavailable.Busy or Unavailable.Slow or Unavailable.Crashed or Unavailable.Temporary)
        {
            response.Headers.RetryAfter = reason == Unavailable.Slow ? "3" : "15";
        }

        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        await response.WriteAsync(Render(reason, markUrl), context.RequestAborted);
    }
}
