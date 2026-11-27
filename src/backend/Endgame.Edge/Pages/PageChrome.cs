using System.Net;
using System.Reflection;

namespace Endgame.Edge.Pages;

/// <summary>
/// The one design every page the edge serves itself is drawn in (unavailable, no app, sign-in,
/// sign-up, hand-off): the console's design system (ARCH-011) — a white card on the ground, the
/// mark, the display face for the title, ink for the words, one accent, 44 px targets, fields with
/// the 3:1 field edge, ONE corner radius for every button and field (the console's <c>rounded-xs</c>),
/// one card width that holds an app's usual name on one line — and always a way onward. Colours,
/// radii and shadow are the console's own role values (<c>src/frontend/src/lib/tokens.ts</c>),
/// written once here; no page carries one of its own. The console's demo carries this style byte
/// for byte (<c>src/frontend/src/demo/hosted/edgePages.ts</c>, held by <c>hosted.test.tsx</c>).
/// <para>
/// The console's two typefaces and the mark are served by the edge itself (<see cref="AssetsPath"/>),
/// at a path under the app's address that apps never own (the app kit reserves <c>/_endgame</c>), and
/// at the host's root for the no-app page — so a page on an organisation subdomain loads nothing from
/// another origin, and its auth pages' content security policy stays <c>'self'</c>.
/// </para>
/// </summary>
public static class PageChrome
{
    /// <summary>Under an app's address, or at a host's root: the pages' typefaces and the mark.</summary>
    public const string AssetsPath = "/_endgame/assets";

    public const string MarkFile = "endgame-mark.svg";
    public const string SansFile = "inter-latin-wght-normal.woff2";
    public const string DisplayFile = "space-grotesk-latin-wght-normal.woff2";

    private static readonly Dictionary<string, (string Resource, string ContentType)> Assets = new(StringComparer.Ordinal)
    {
        [MarkFile] = ("Endgame.Edge.Pages.Assets.endgame-mark.svg", "image/svg+xml"),
        [SansFile] = ("Endgame.Edge.Pages.Assets.inter-latin-wght-normal.woff2", "font/woff2"),
        [DisplayFile] = ("Endgame.Edge.Pages.Assets.space-grotesk-latin-wght-normal.woff2", "font/woff2"),
    };

    public const string Style = """
          :root {
            --ground: #F5F6FB; --surface: #FFFFFF; --ink: #0B1020; --ink-body: #3B4350; --ink-muted: #535B70; --border: #E4E7F2; --border-field: #868DA3;
            --primary: #2F5BFF; --primary-hover: #1E3FCC; --primary-link: #2447D6; --primary-ink: #FFFFFF; --danger: #B42318; --danger-tint: #FFF1EC;
            --quiet: #EEF0F7; --radius-card: 24px; --radius-control: 8px; --space: 16px; --measure: 40rem; --touch: 44px;
            --shadow-card: 0 1px 2px rgb(11 16 32 / 0.05), 0 10px 28px rgb(11 16 32 / 0.05);
            --font-sans: "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif;
            --font-display: "Space Grotesk Variable", "Space Grotesk", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
            --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
          }
          * { box-sizing: border-box; }
          body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center;
                 padding: max(calc(var(--space) * 1.5), env(safe-area-inset-top)) max(calc(var(--space) * 1.5), env(safe-area-inset-right))
                          max(calc(var(--space) * 1.5), env(safe-area-inset-bottom)) max(calc(var(--space) * 1.5), env(safe-area-inset-left));
                 -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
                 background: var(--ground); color: var(--ink); font-family: var(--font-sans); font-size: 1rem; line-height: 1.5; -webkit-font-smoothing: antialiased; }
          main { width: 100%; max-width: var(--measure); background: var(--surface); border: 1px solid var(--border);
                 border-radius: var(--radius-card); box-shadow: var(--shadow-card); padding: calc(var(--space) * 2.5); }
          .mark { display: block; width: 40px; height: 40px; margin-bottom: calc(var(--space) * 1.25); }
          h1 { margin: 0 0 calc(var(--space) * 0.75); font-family: var(--font-display); font-size: 1.875rem; font-weight: 600; letter-spacing: -0.025em; line-height: 1.2; text-wrap: pretty; }
          h2 { margin: 0 0 calc(var(--space) * 0.25); font-size: 1rem; font-weight: 600; line-height: 1.4; }
          p { margin: 0; color: var(--ink-body); line-height: 1.6; text-wrap: pretty; }
          .address { margin-top: calc(var(--space) * 0.75); font-family: var(--font-mono); font-size: 0.875rem; color: var(--ink); }
          /* An address breaks only after a "/": each segment holds together, and breaks inside itself only when it alone is wider than the line. */
          .address > span { display: inline-block; max-width: 100%; overflow-wrap: break-word; }
          section { margin-top: calc(var(--space) * 1.5); padding-top: calc(var(--space) * 1.5); border-top: 1px solid var(--border); }
          section > p { margin-bottom: var(--space); font-size: 0.9375rem; }
          label { display: block; margin-bottom: var(--space); font-size: 0.875rem; font-weight: 500; color: var(--ink); }
          input { display: block; width: 100%; min-height: var(--touch); margin-top: calc(var(--space) * 0.375); padding: 0 calc(var(--space) * 0.75);
                  border: 1px solid var(--border-field); border-radius: var(--radius-control); font: inherit; color: var(--ink); background: var(--surface); }
          input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
          .actions { display: flex; flex-wrap: wrap; gap: calc(var(--space) * 0.5); margin-top: calc(var(--space) * 1.5); }
          section .actions, form .actions { margin-top: 0; }
          button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: var(--touch); padding: 0 var(--space);
                   border-radius: var(--radius-control); border: 1px solid var(--primary); background: var(--primary); color: var(--primary-ink);
                   font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; text-decoration: none; }
          button:hover, .button:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
          button.secondary, .button.secondary { border-color: var(--border-field); background: var(--surface); color: var(--ink); }
          button.secondary:hover, .button.secondary:hover { background: var(--ground); border-color: var(--border-field); }
          /* One disabled look (ARCH-011): a grey fill and muted words, never a faded colour. */
          button[disabled], button[disabled]:hover { border-color: transparent; background: var(--quiet); color: var(--ink-muted); cursor: progress; }
          a { color: var(--primary-link); text-underline-offset: 2px; }
          .note { margin-top: var(--space); font-size: 0.875rem; color: var(--ink-muted); }
          .note a { font-weight: 500; }
          .error { margin-top: var(--space); padding: calc(var(--space) * 0.75); border-radius: var(--radius-control); background: var(--danger-tint); color: var(--danger); font-size: 0.9rem; }
          [hidden] { display: none !important; }
          /* Worked by touch: a link inside a sentence is a thumb's height too. */
          @media (pointer: coarse) {
            .note a { display: inline-flex; align-items: center; min-height: var(--touch); }
          }
          /* A phone: the card keeps its edge but gives its room to the words; every action is a full-width tap target. */
          @media (max-width: 30rem) {
            body { place-items: start center; padding: max(var(--space), env(safe-area-inset-top)) max(var(--space), env(safe-area-inset-right))
                   max(var(--space), env(safe-area-inset-bottom)) max(var(--space), env(safe-area-inset-left)); }
            main { padding: calc(var(--space) * 1.75) calc(var(--space) * 1.25); }
            h1 { font-size: 1.5rem; }
            .actions { flex-direction: column; }
            .actions > button, .actions > .button { width: 100%; }
            section { margin-top: calc(var(--space) * 1.25); padding-top: calc(var(--space) * 1.25); }
            .note a { display: inline-flex; align-items: center; min-height: var(--touch); }
          }
        """;

    /// <summary>The console's two typefaces, latin, from <paramref name="assets"/> (a path ending in <see cref="AssetsPath"/>).</summary>
    public static string Fonts(string assets) => $$"""
          @font-face { font-family: "Inter Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url("{{assets}}/{{SansFile}}") format("woff2"); }
          @font-face { font-family: "Space Grotesk Variable"; font-style: normal; font-display: swap; font-weight: 300 700; src: url("{{assets}}/{{DisplayFile}}") format("woff2"); }
        """;

    /// <summary>
    /// The whole page: <paramref name="body"/> in the card under the mark. <paramref name="head"/> is
    /// anything more for <c>&lt;head&gt;</c> (a refresh), <paramref name="styleAttributes"/> the style
    /// element's attributes (a nonce), <paramref name="scripts"/> what follows the card.
    /// </summary>
    public static string Document(string title, string assets, string body, string head = "", string styleAttributes = "", string scripts = "") => $$"""
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <meta name="robots" content="noindex">{{head}}
        <title>{{WebUtility.HtmlEncode(title)}} · Endgame</title>
        <style{{styleAttributes}}>
        {{Fonts(assets)}}
        {{Style}}
        </style>
        </head>
        <body>
        <main>
        <img class="mark" src="{{WebUtility.HtmlEncode(assets)}}/{{MarkFile}}" alt="Endgame" width="40" height="40">
        {{body}}
        </main>{{scripts}}
        </body>
        </html>
        """;

    /// <summary>The assets' path for a page shown at <paramref name="appAddress"/> (empty at a host's root).</summary>
    public static string AssetsAt(string appAddress) => appAddress.TrimEnd('/') + AssetsPath;

    /// <summary>
    /// Serves <c>&lt;file&gt;</c> of <see cref="AssetsPath"/>; false (and nothing written) when it is not one of ours.
    /// </summary>
    public static async Task<bool> TryServeAsync(HttpContext context, string file)
    {
        if (!Assets.TryGetValue(file, out var asset) || !(HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method)))
        {
            return false;
        }

        await using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(asset.Resource)
            ?? throw new InvalidOperationException($"The edge was built without its page asset {asset.Resource}.");
        var response = context.Response;
        response.Clear();
        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = asset.ContentType;
        response.ContentLength = stream.Length;
        response.Headers.CacheControl = "public, max-age=86400";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        if (!HttpMethods.IsHead(context.Request.Method))
        {
            await stream.CopyToAsync(response.Body, context.RequestAborted);
        }

        return true;
    }
}
