using System.Net;
using System.Text;

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

    /// <summary>An organisation's app host, at an address where no app is (404).</summary>
    NoApp,
}

/// <summary>
/// Where a page may send the visitor next.
/// </summary>
/// <param name="Assets">The page's typefaces and mark (<see cref="PageChrome.AssetsAt"/>).</param>
/// <param name="Here">The address the visitor asked for, as a path on this host: "Try again".</param>
/// <param name="Console">The console's origin with no trailing slash (empty on the platform's own host), or null when this host cannot name it.</param>
/// <param name="Member">The visitor carries a member's console session here.</param>
/// <param name="SwitchAccount">The app's sign-out, returning to its sign-in: "Sign in as someone else". Null with no app.</param>
/// <param name="AppId">The app, for the owner's link to its page in the console. Null with no app.</param>
/// <param name="Address">The address shown on the no-app page (host and path).</param>
public sealed record PageLinks(string Assets, string Here, string? Console, bool Member = false, string? SwitchAccount = null, Guid? AppId = null, string? Address = null);

/// <summary>
/// The page a visitor sees when an app cannot answer, or when there is no app at an organisation's
/// address: plain language, the Endgame mark, a way onward, and never a word about the machinery
/// (CLAUDE.md rule 12 — no containers, servers or networks). Who sees each, and what helps them:
/// <list type="bullet">
/// <item>Crashed, busy, slow, temporary — anyone admitted. Trying again is what helps; a slow wake tries again by itself after its <c>Retry-After</c>.</item>
/// <item>Paused, budget spent — anyone, before the access check. Trying again (once it is restored); for its owner, the place in Endgame that restores it.</item>
/// <item>Not ready — whoever may open it, and a signed-out visitor too, before any sign-in (signing in cannot help yet); never someone signed in and refused. Trying again; for its owner, the app's page in Endgame.</item>
/// <item>Forbidden — someone signed in as the wrong person: signing in as someone else; a member, also back to Endgame.</item>
/// <item>No app — anyone: the address they asked for, and the way to Endgame.</item>
/// </list>
/// </summary>
public static class UnavailablePage
{
    public const string TryAgain = "Try again";
    public const string GoToEndgame = "Go to Endgame";
    public const string SignInAsSomeoneElse = "Sign in as someone else";
    public const string YourApp = "Is this your app?";
    public const string RetriesItself = "This page tries again by itself in a few seconds.";

    public static int StatusFor(Unavailable reason) => reason switch
    {
        Unavailable.Forbidden => StatusCodes.Status403Forbidden,
        Unavailable.NoApp => StatusCodes.Status404NotFound,
        _ => StatusCodes.Status503ServiceUnavailable,
    };

    /// <summary>Seconds before trying again helps; null when it would not.</summary>
    public static int? RetryAfter(Unavailable reason) => reason switch
    {
        Unavailable.Slow => 3,
        Unavailable.Busy or Unavailable.Crashed or Unavailable.Temporary => 15,
        _ => null,
    };

    public static (string Title, string Message) Copy(Unavailable reason) => reason switch
    {
        Unavailable.Crashed => ("This app has stopped for a moment",
            "Something went wrong inside it, and its owner has been told. Please try again in a minute: the next visit starts it again."),
        // "lost — it": a no-break space before the dash keeps it off the start of a line.
        Unavailable.Paused => ("This app is paused",
            "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up."),
        Unavailable.BudgetSpent => ("This app is paused",
            "It has used this month’s budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns."),
        Unavailable.Busy => ("This app could not start just now",
            "Endgame is very busy at the moment. Please try again in a minute."),
        Unavailable.NotReady => ("This app isn’t ready yet",
            "It has an address, but its first version has not been published. Please check back soon."),
        Unavailable.Slow => ("This app is taking longer than usual",
            "It is still starting. Please try again in a few seconds."),
        Unavailable.Forbidden => ("You don’t have access to this app",
            "You are signed in, but your account has no access to this app. Ask its owner for access."),
        Unavailable.NoApp => ("There is no app at this address",
            "Nothing is published here. Check the address you were given, or ask the person who shared it."),
        _ => ("This app is temporarily unavailable",
            "Endgame could not reach it just now. Please try again in a moment."),
    };

    /// <summary>The buttons, first one primary: (label, address).</summary>
    public static IReadOnlyList<(string Label, string Href)> Actions(Unavailable reason, PageLinks links)
    {
        var actions = new List<(string Label, string Href)>();
        switch (reason)
        {
            case Unavailable.Forbidden:
                if (links.Member && links.Console is { } console)
                {
                    actions.Add((GoToEndgame, console + "/"));
                }

                if (links.SwitchAccount is { } other)
                {
                    actions.Add((SignInAsSomeoneElse, other));
                }

                break;
            case Unavailable.NoApp:
                if (links.Console is { } endgame)
                {
                    actions.Add((GoToEndgame, endgame + "/"));
                }

                break;
            default:
                actions.Add((TryAgain, links.Here));
                break;
        }

        return actions;
    }

    /// <summary>The quiet line under the buttons: (words, link text, address); link text and address null for words alone.</summary>
    public static (string Words, string? LinkText, string? Href)? Note(Unavailable reason, PageLinks links) => reason switch
    {
        Unavailable.Slow => (RetriesItself, null, null),
        Unavailable.Paused when links.Console is { } console => (YourApp, "Top up the credits in Endgame", console + "/credits"),
        Unavailable.BudgetSpent when links.Console is { } console && links.AppId is { } app => (YourApp, "Raise its budget in Endgame", $"{console}/apps/{app:D}"),
        Unavailable.NotReady when links.Console is { } console && links.AppId is { } app => (YourApp, "Open it in Endgame", $"{console}/apps/{app:D}"),
        _ => null,
    };

    /// <summary>The page.</summary>
    public static string Render(Unavailable reason, PageLinks links)
    {
        var (title, message) = Copy(reason);
        var body = new StringBuilder();
        body.Append($"<h1>{WebUtility.HtmlEncode(title)}</h1>\n<p>{WebUtility.HtmlEncode(message)}</p>");
        if (reason == Unavailable.NoApp && links.Address is { Length: > 0 } address)
        {
            body.Append($"\n<p class=\"address\">{Address(address)}</p>");
        }

        var actions = Actions(reason, links);
        if (actions.Count > 0)
        {
            body.Append("\n<nav class=\"actions\" aria-label=\"What to do next\">");
            for (var i = 0; i < actions.Count; i++)
            {
                body.Append($"<a class=\"{(i == 0 ? "button" : "button secondary")}\" href=\"{WebUtility.HtmlEncode(actions[i].Href)}\">{WebUtility.HtmlEncode(actions[i].Label)}</a>");
            }

            body.Append("</nav>");
        }

        if (Note(reason, links) is { } note)
        {
            var (words, linkText, href) = note;
            body.Append(linkText is null || href is null
                ? $"\n<p class=\"note\">{WebUtility.HtmlEncode(words)}</p>"
                : $"\n<p class=\"note\">{WebUtility.HtmlEncode(words)} <a href=\"{WebUtility.HtmlEncode(href)}\">{WebUtility.HtmlEncode(linkText)}</a></p>");
        }

        // A slow wake refreshes itself once trying again can help, and says so.
        var head = reason == Unavailable.Slow ? $"\n<meta http-equiv=\"refresh\" content=\"{RetryAfter(reason)}\">" : "";
        return PageChrome.Document(title, links.Assets, body.ToString(), head);
    }

    /// <summary>
    /// An address that breaks only after a "/": each segment, its slash included, HTML-encoded in a span
    /// that holds together (<see cref="PageChrome.Style"/>, <c>.address</c>), with a <c>&lt;wbr&gt;</c>
    /// between segments. A segment wider than the line alone breaks inside itself, as the last resort.
    /// </summary>
    public static string Address(string address)
    {
        var html = new StringBuilder();
        var start = 0;
        while (start < address.Length)
        {
            var slash = address.IndexOf('/', start);
            var end = slash < 0 ? address.Length : slash + 1;
            if (start > 0)
            {
                html.Append("<wbr>");
            }

            html.Append("<span>").Append(WebUtility.HtmlEncode(address[start..end])).Append("</span>");
            start = end;
        }

        return html.ToString();
    }

    public static async Task WriteAsync(HttpContext context, Unavailable reason, PageLinks links)
    {
        var response = context.Response;
        response.Clear();
        response.StatusCode = StatusFor(reason);
        response.ContentType = "text/html; charset=utf-8";
        response.Headers.CacheControl = "no-store";
        if (RetryAfter(reason) is { } seconds)
        {
            response.Headers.RetryAfter = seconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        if (HttpMethods.IsHead(context.Request.Method))
        {
            return;
        }

        await response.WriteAsync(Render(reason, links), context.RequestAborted);
    }
}
