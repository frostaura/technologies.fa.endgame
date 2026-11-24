namespace Endgame.Edge.Pages;

/// <summary>
/// The token layer for every page the edge serves itself (unavailable, sign-in, sign-up,
/// hand-off): the console's own role values (<c>src/frontend/src/lib/tokens.ts</c>), written once.
/// No page here carries a colour, size or typeface of its own.
/// </summary>
public static class PageChrome
{
    public const string Style = """
          :root {
            --ground: #F5F6FB; --surface: #FFFFFF; --ink: #0B1020; --ink-body: #3B4350; --ink-muted: #535B70; --border: #E4E7F2; --border-strong: #C9CEDF;
            --primary: #2F5BFF; --primary-hover: #1E3FCC; --primary-ink: #FFFFFF; --primary-tint: #EEF2FF; --danger: #B42318; --danger-tint: #FFF1EC;
            --radius-lg: 24px; --radius: 12px; --space: 16px; --measure: 32rem;
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
          h2 { margin: 0 0 calc(var(--space) * 0.5); font-size: 0.95rem; font-weight: 600; }
          p { margin: 0; color: var(--ink-muted); line-height: 1.6; }
          section { margin-top: calc(var(--space) * 1.75); padding-top: calc(var(--space) * 1.5); border-top: 1px solid var(--border); }
          section > p { margin-bottom: var(--space); font-size: 0.9rem; }
          label { display: block; margin-bottom: calc(var(--space) * 0.75); font-size: 0.875rem; font-weight: 500; color: var(--ink-body); }
          input { display: block; width: 100%; margin-top: calc(var(--space) * 0.35); padding: calc(var(--space) * 0.6) calc(var(--space) * 0.75);
                  border: 1px solid var(--border-strong); border-radius: var(--radius); font: inherit; color: var(--ink); background: var(--surface); }
          input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
          .actions { display: flex; flex-wrap: wrap; gap: calc(var(--space) * 0.75); }
          button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 calc(var(--space) * 1.25);
                   border-radius: var(--radius); border: 1px solid var(--primary); background: var(--primary); color: var(--primary-ink);
                   font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
          button:hover, .button:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
          button.secondary { background: var(--surface); color: var(--primary); border-color: var(--border-strong); }
          button.secondary:hover { background: var(--primary-tint); }
          button[disabled] { opacity: 0.6; cursor: progress; }
          a { color: var(--primary); }
          .note { margin-top: var(--space); font-size: 0.875rem; }
          .error { margin-top: var(--space); padding: calc(var(--space) * 0.75); border-radius: var(--radius); background: var(--danger-tint); color: var(--danger); font-size: 0.9rem; }
          [hidden] { display: none !important; }
        """;
}
