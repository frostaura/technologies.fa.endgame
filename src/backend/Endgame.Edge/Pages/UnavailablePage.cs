using System.Net;

namespace Endgame.Edge.Pages;

/// <summary>Why the edge is answering instead of the app.</summary>
public enum Unavailable
{
    /// <summary>The app stopped working: kept down for a short pause, then started again by the next visit; its owner is told.</summary>
    Crashed,

    /// <summary>The organisation's credits reached the overdraft limit.</summary>
    Paused,

    /// <summary>A monthly budget above the app is spent.</summary>
    BudgetSpent,

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
            "Something went wrong inside it, and its owner has been told. Please try again in a minute: the next visit starts it again."),
        Unavailable.Paused => ("This app is paused",
            "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up."),
        Unavailable.BudgetSpent => ("This app is paused",
            "It has used this month's budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns."),
        Unavailable.Busy => ("This app could not start just now",
            "Endgame is very busy at the moment. Please try again in a minute."),
        Unavailable.NotReady => ("This app isn't ready yet",
            "It has an address, but its first version has not been published. Please check back soon."),
        Unavailable.Slow => ("This app is taking longer than usual",
            "It is still starting. Please try again in a few seconds."),
        Unavailable.Forbidden => ("You don't have access to this app",
            "You are signed in, but your account has no access to this app. Ask its owner for access."),
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
        return $$"""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <title>{{WebUtility.HtmlEncode(title)}} · Endgame</title>
            <style>
            {{PageChrome.Style}}
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
