/*
 * The pages Endgame's Edge answers with itself, ported for the demo — markup, CSS and wording
 * copied from the platform's own source, so a visitor in the demo sees exactly what a visitor of a
 * hosted app sees:
 *
 * - `src/backend/Endgame.Edge/Pages/PageChrome.cs`   → {@link PAGE_CHROME_STYLE}, {@link fontFaces}, {@link renderDocument}
 * - `src/backend/Endgame.Edge/Pages/UnavailablePage.cs` → {@link UNAVAILABLE_COPY}, {@link pageActions}, {@link pageNote}, {@link renderUnavailablePage}
 * - `src/backend/Endgame.Edge/Pages/AuthPage.cs`     → {@link renderAuthPage}, {@link renderMessagePage}, {@link applyAuthInfo}
 * - `src/backend/Endgame.Edge/Access/AuthPages.cs`   → {@link HANDOFF_EXPIRED}, {@link HANDOFF_FAILED}
 *
 * TOKEN-RULE EXEMPTION. The CSS below carries sizes and spacing of its own because it is a verbatim
 * copy of the platform's page chrome, not the console's styling; it is rendered inside an isolated
 * document and never reaches the console's DOM. Its colours and shadow are the console's own role
 * values (PageChrome.cs says so itself), so they are read from `@/lib/tokens` rather than written out
 * here, and `hosted.test.tsx` proves the result is byte-for-byte the C# string.
 *
 * The Edge serves the pages' typefaces and mark itself, under the app's address; the demo has no
 * server, so {@link DEMO_ASSETS} hands the same files over as `data:` URLs (the console's own
 * fontsource files, and the mark drawn from the tokens).
 *
 * What is deliberately not ported: the per-response CSP nonce, and the pages' scripts (passkey
 * ceremonies through `navigator.credentials` and `fetch` to the control plane). The demo has no
 * server, so `HostedAppView` drives the same DOM changes the script would make ({@link applyAuthInfo})
 * and answers the forms with the demo's simulated flows. Every visible word stays.
 */
import sansFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import displayFont from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url";
import { roles, shadow } from "@/lib/tokens";

// ---------------------------------------------------------------------------------------------
// Encoding, as the C# does it
// ---------------------------------------------------------------------------------------------

/**
 * `System.Net.WebUtility.HtmlEncode`: `<`, `>`, `&`, `"` and `'` as entities, the Latin-1 range
 * U+00A0–U+00FF and every astral character as numeric references; a lone surrogate becomes U+FFFD.
 */
export function htmlEncode(value: string | null | undefined): string {
  if (!value) return "";
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x3c) out += "&lt;";
    else if (c === 0x3e) out += "&gt;";
    else if (c === 0x22) out += "&quot;";
    else if (c === 0x27) out += "&#39;";
    else if (c === 0x26) out += "&amp;";
    else if (c >= 0xa0 && c < 0x100) out += `&#${c};`;
    else if (c >= 0xd800 && c <= 0xdfff) {
      const next = value.charCodeAt(i + 1);
      if (c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += `&#${(c - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000};`;
        i++;
      } else out += `&#${0xfffd};`;
    } else out += value[i];
  }
  return out;
}

/** `Uri.EscapeDataString`: everything but the RFC 3986 unreserved characters is percent-encoded. */
export function escapeDataString(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// ---------------------------------------------------------------------------------------------
// PageChrome.cs
// ---------------------------------------------------------------------------------------------

const r = roles;

/** `PageChrome.AssetsPath` and its files. */
export const ASSETS_PATH = "/_endgame/assets";
export const MARK_FILE = "endgame-mark.svg";
export const SANS_FILE = "inter-latin-wght-normal.woff2";
export const DISPLAY_FILE = "space-grotesk-latin-wght-normal.woff2";

/** `PageChrome.Style`, exactly. */
export const PAGE_CHROME_STYLE = `  :root {
    --ground: ${r.ground}; --surface: ${r.surface}; --ink: ${r.ink.DEFAULT}; --ink-body: ${r.ink.body}; --ink-muted: ${r.ink.muted}; --border: ${r.border.DEFAULT}; --border-strong: ${r.border.strong}; --border-field: ${r.border.field};
    --primary: ${r.primary.DEFAULT}; --primary-hover: ${r.primary.hover}; --primary-link: ${r.primary.link}; --primary-ink: ${r.primary.ink}; --danger: ${r.attention.text}; --danger-tint: ${r.attention.tint};
    --radius-card: 24px; --radius-button: 14px; --radius-control: 8px; --space: 16px; --measure: 34rem; --touch: 44px;
    --shadow-card: ${shadow.card};
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
  .address { margin-top: calc(var(--space) * 0.75); font-family: var(--font-mono); font-size: 0.875rem; color: var(--ink); overflow-wrap: anywhere; }
  section { margin-top: calc(var(--space) * 1.5); padding-top: calc(var(--space) * 1.5); border-top: 1px solid var(--border); }
  section > p { margin-bottom: var(--space); font-size: 0.9375rem; }
  label { display: block; margin-bottom: var(--space); font-size: 0.875rem; font-weight: 500; color: var(--ink); }
  input { display: block; width: 100%; min-height: var(--touch); margin-top: calc(var(--space) * 0.375); padding: 0 calc(var(--space) * 0.75);
          border: 1px solid var(--border-field); border-radius: var(--radius-control); font: inherit; color: var(--ink); background: var(--surface); }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .actions { display: flex; flex-wrap: wrap; gap: calc(var(--space) * 0.5); margin-top: calc(var(--space) * 1.5); }
  section .actions, form .actions { margin-top: 0; }
  button, .button { display: inline-flex; align-items: center; justify-content: center; min-height: var(--touch); padding: 0 var(--space);
           border-radius: var(--radius-button); border: 1px solid var(--primary); background: var(--primary); color: var(--primary-ink);
           font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; text-decoration: none; }
  button:hover, .button:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
  button.secondary, .button.secondary { border-radius: var(--radius-control); border-color: var(--border-strong); background: var(--surface); color: var(--ink-body); font-weight: 400; }
  button.secondary:hover, .button.secondary:hover { background: var(--ground); border-color: var(--border-strong); }
  button[disabled] { opacity: 0.6; cursor: progress; }
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
    body { place-items: start center; padding: max(var(--space), env(safe-area-inset-top)) max(calc(var(--space) * 0.75), env(safe-area-inset-right))
           max(var(--space), env(safe-area-inset-bottom)) max(calc(var(--space) * 0.75), env(safe-area-inset-left)); }
    main { padding: calc(var(--space) * 1.75) calc(var(--space) * 1.25); }
    h1 { font-size: 1.5rem; }
    .actions { flex-direction: column; }
    .actions > button, .actions > .button { width: 100%; }
    section { margin-top: calc(var(--space) * 1.25); padding-top: calc(var(--space) * 1.25); }
    .note a { display: inline-flex; align-items: center; min-height: var(--touch); }
  }`;

/** Where a page's asset is: the Edge's `{assets}/{file}`, or the demo's `data:` URL. */
export type AssetUrl = (file: string) => string;

/** The Edge's assets under a path (`PageChrome.AssetsAt`). */
export const assetsAt =
  (assets: string): AssetUrl =>
  (file) =>
    `${assets}/${file}`;

/**
 * The Endgame mark (`public/brand/endgame-mark.svg`, which the Edge carries as an asset), as a
 * `data:` URL so the demo loads nothing. Its colours are the token layer's: primary, primary-ink and the lit node.
 */
export const MARK_URL = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Endgame"><rect width="64" height="64" rx="16" fill="${r.primary.DEFAULT}"/><path d="M21 17v30M21 17h24M21 32h18M21 47h12" fill="none" stroke="${r.primary.ink}" stroke-width="5.5" stroke-linecap="round"/><circle cx="45" cy="17" r="5" fill="${r.primary.ink}"/><circle cx="39" cy="32" r="5" fill="${r.primary.ink}"/><circle cx="33" cy="47" r="5" fill="${r.live}"/></svg>`,
)}`;

/** The demo's assets: the console's own typefaces and the mark, inlined. */
export const DEMO_ASSETS: AssetUrl = (file) => (file === SANS_FILE ? sansFont : file === DISPLAY_FILE ? displayFont : MARK_URL);

/** `PageChrome.Fonts`, exactly. */
export function fontFaces(url: AssetUrl): string {
  return `  @font-face { font-family: "Inter Variable"; font-style: normal; font-display: swap; font-weight: 100 900; src: url("${url(SANS_FILE)}") format("woff2"); }
  @font-face { font-family: "Space Grotesk Variable"; font-style: normal; font-display: swap; font-weight: 300 700; src: url("${url(DISPLAY_FILE)}") format("woff2"); }`;
}

/** `PageChrome.Document`. */
export function renderDocument(title: string, url: AssetUrl, body: string, head = "", styleAttributes = "", scripts = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">${head}
<title>${htmlEncode(title)} · Endgame</title>
<style${styleAttributes}>
${fontFaces(url)}
${PAGE_CHROME_STYLE}
</style>
</head>
<body>
<main>
<img class="mark" src="${htmlEncode(url(MARK_FILE))}" alt="Endgame" width="40" height="40">
${body}
</main>${scripts}
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// UnavailablePage.cs
// ---------------------------------------------------------------------------------------------

/** Why the edge is answering instead of the app (`enum Unavailable`). */
export type Unavailable = "Crashed" | "Paused" | "BudgetSpent" | "Busy" | "NotReady" | "Slow" | "Temporary" | "Forbidden" | "NoApp";

/** `UnavailablePage.Copy`: title and message for each reason. */
export const UNAVAILABLE_COPY: Record<Unavailable, { title: string; message: string }> = {
  Crashed: {
    title: "This app has stopped for a moment",
    message: "Something went wrong inside it, and its owner has been told. Please try again in a minute: the next visit starts it again.",
  },
  // "lost — it": a no-break space before the dash keeps it off the start of a line.
  Paused: {
    title: "This app is paused",
    message: "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up.",
  },
  BudgetSpent: {
    title: "This app is paused",
    message: "It has used this month’s budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns.",
  },
  Busy: { title: "This app could not start just now", message: "Endgame is very busy at the moment. Please try again in a minute." },
  NotReady: {
    title: "This app isn’t ready yet",
    message: "It has an address, but its first version has not been published. Please check back soon.",
  },
  Slow: { title: "This app is taking longer than usual", message: "It is still starting. Please try again in a few seconds." },
  Forbidden: {
    title: "You don’t have access to this app",
    message: "You are signed in, but your account has no access to this app. Ask its owner for access.",
  },
  NoApp: {
    title: "There is no app at this address",
    message: "Nothing is published here. Check the address you were given, or ask the person who shared it.",
  },
  Temporary: { title: "This app is temporarily unavailable", message: "Endgame could not reach it just now. Please try again in a moment." },
};

/** `UnavailablePage`'s words for the ways onward. */
export const ONWARD = {
  tryAgain: "Try again",
  goToEndgame: "Go to Endgame",
  signInAsSomeoneElse: "Sign in as someone else",
  yourApp: "Is this your app?",
  retriesItself: "This page tries again by itself in a few seconds.",
  topUp: "Top up the credits in Endgame",
  raiseBudget: "Raise its budget in Endgame",
  openIt: "Open it in Endgame",
} as const;

/** `PageLinks`: where a page may send the visitor next. */
export interface PageLinks {
  /** The address asked for, as a path on this host: "Try again". */
  here: string;
  /** The console's origin with no trailing slash ("" on the platform's own host); null when this host cannot name it. */
  console: string | null;
  /** The visitor carries a member's console session here. */
  member?: boolean;
  /** The app's sign-out, returning to its sign-in. */
  switchAccount?: string | null;
  appId?: string | null;
  /** The no-app page's address (host and path). */
  address?: string | null;
}

/** `UnavailablePage.StatusFor`. */
export function unavailableStatus(reason: Unavailable): number {
  return reason === "Forbidden" ? 403 : reason === "NoApp" ? 404 : 503;
}

/** `UnavailablePage.RetryAfter`. */
export function retryAfter(reason: Unavailable): number | null {
  return reason === "Slow" ? 3 : reason === "Busy" || reason === "Crashed" || reason === "Temporary" ? 15 : null;
}

/** `UnavailablePage.Actions`: the buttons, first one primary. */
export function pageActions(reason: Unavailable, links: PageLinks): { label: string; href: string }[] {
  if (reason === "Forbidden") {
    return [
      ...(links.member && links.console !== null ? [{ label: ONWARD.goToEndgame, href: `${links.console}/` }] : []),
      ...(links.switchAccount ? [{ label: ONWARD.signInAsSomeoneElse, href: links.switchAccount }] : []),
    ];
  }
  if (reason === "NoApp") return links.console !== null ? [{ label: ONWARD.goToEndgame, href: `${links.console}/` }] : [];
  return [{ label: ONWARD.tryAgain, href: links.here }];
}

/** `UnavailablePage.Note`: the quiet line under the buttons. */
export function pageNote(reason: Unavailable, links: PageLinks): { words: string; linkText: string | null; href: string | null } | null {
  const c = links.console;
  if (reason === "Slow") return { words: ONWARD.retriesItself, linkText: null, href: null };
  if (reason === "Paused" && c !== null) return { words: ONWARD.yourApp, linkText: ONWARD.topUp, href: `${c}/credits` };
  if (reason === "BudgetSpent" && c !== null && links.appId) return { words: ONWARD.yourApp, linkText: ONWARD.raiseBudget, href: `${c}/apps/${links.appId}` };
  if (reason === "NotReady" && c !== null && links.appId) return { words: ONWARD.yourApp, linkText: ONWARD.openIt, href: `${c}/apps/${links.appId}` };
  return null;
}

/** `UnavailablePage.Render`. */
export function renderUnavailablePage(reason: Unavailable, links: PageLinks, url: AssetUrl = DEMO_ASSETS): string {
  const { title, message } = UNAVAILABLE_COPY[reason];
  let body = `<h1>${htmlEncode(title)}</h1>\n<p>${htmlEncode(message)}</p>`;
  if (reason === "NoApp" && links.address) body += `\n<p class="address">${htmlEncode(links.address)}</p>`;
  const actions = pageActions(reason, links);
  if (actions.length > 0) {
    body += `\n<nav class="actions" aria-label="What to do next">`;
    actions.forEach((a, i) => {
      body += `<a class="${i === 0 ? "button" : "button secondary"}" href="${htmlEncode(a.href)}">${htmlEncode(a.label)}</a>`;
    });
    body += "</nav>";
  }
  const note = pageNote(reason, links);
  if (note) {
    body +=
      note.linkText === null || note.href === null
        ? `\n<p class="note">${htmlEncode(note.words)}</p>`
        : `\n<p class="note">${htmlEncode(note.words)} <a href="${htmlEncode(note.href)}">${htmlEncode(note.linkText)}</a></p>`;
  }
  const head = reason === "Slow" ? `\n<meta http-equiv="refresh" content="${retryAfter(reason)}">` : "";
  return renderDocument(title, url, body, head);
}

// ---------------------------------------------------------------------------------------------
// AuthPage.cs
// ---------------------------------------------------------------------------------------------

export type AuthPageName = "sign-in" | "sign-up";

/** `AuthPage.Body("sign-up")`, exactly. */
export const SIGN_UP_BODY = `<h1 id="title">Create your sign-in</h1>
<p id="lead">Checking what this app offers…</p>
<p id="via" class="note" hidden></p>
<form id="sign-up" hidden>
  <section>
    <label>E-mail address<input id="email" name="email" type="email" autocomplete="email" required></label>
    <label>Your name<input id="display-name" name="displayName" type="text" autocomplete="name"></label>
    <label id="code-label" hidden>Invitation code<input id="code" name="invitationCode" type="text" autocomplete="one-time-code" spellcheck="false"></label>
    <div class="actions"><button id="create" type="submit">Create a passkey</button></div>
    <p class="note">Already registered? <a id="to-sign-in" href="#">Sign in</a></p>
  </section>
</form>
<section id="dev-up" hidden>
  <h2>Development sign-in</h2>
  <p>This deployment allows signing in without a passkey, for testing only.</p>
  <div class="actions"><button id="dev-visitor-up" type="button" class="secondary">Continue without a passkey</button></div>
</section>
<p id="error" class="error" role="alert" hidden></p>
<p id="back" class="note" hidden><a id="back-link" href="#">Back to the app</a></p>`;

/** `AuthPage.Body("sign-in")`, exactly. */
export const SIGN_IN_BODY = `<h1 id="title">Sign in</h1>
<p id="lead">Checking what this app offers…</p>
<p id="via" class="note" hidden></p>
<section id="members" hidden>
  <h2 id="members-title">Members</h2>
  <p>Sign in with the passkey you use for Endgame.</p>
  <div class="actions"><button id="member-passkey" type="button">Sign in with a passkey</button></div>
</section>
<section id="visitors" hidden>
  <h2>Using this app</h2>
  <p>Sign in with the passkey you created for this app.</p>
  <div class="actions"><button id="visitor-passkey" type="button" class="secondary">Sign in with your passkey</button></div>
  <p class="note">New here? <a id="to-sign-up" href="#">Create your sign-in</a></p>
</section>
<section id="dev" hidden>
  <h2>Development sign-in</h2>
  <p>This deployment allows signing in without a passkey, for testing only.</p>
  <label>E-mail address<input id="dev-email" type="email" autocomplete="email"></label>
  <div class="actions">
    <button id="dev-member" type="button" class="secondary">As a member</button>
    <button id="dev-visitor" type="button" class="secondary" hidden>As a visitor</button>
  </div>
</section>
<p id="error" class="error" role="alert" hidden></p>
<p id="back" class="note" hidden><a id="back-link" href="#">Back to the app</a></p>`;

/** `AuthPage.WriteAsync`: the sign-in or sign-up page, before its script has run (no nonce, no scripts: see the note at the top). */
export function renderAuthPage(page: AuthPageName, url: AssetUrl = DEMO_ASSETS): string {
  const title = page === "sign-up" ? "Create your sign-in" : "Sign in";
  return renderDocument(title, url, page === "sign-up" ? SIGN_UP_BODY : SIGN_IN_BODY);
}

/** `AuthPage.MessageBody`. */
export function messageBody(title: string, message: string, link: string, linkText: string): string {
  return `<h1>${htmlEncode(title)}</h1>\n<p>${htmlEncode(message)}</p>\n<nav class="actions" aria-label="What to do next"><a class="button" href="${htmlEncode(link)}">${htmlEncode(linkText)}</a></nav>`;
}

/** `AuthPage.WriteMessageAsync`: a title, a message and one way onward. */
export function renderMessagePage(title: string, message: string, link: string, linkText: string, url: AssetUrl = DEMO_ASSETS): string {
  return renderDocument(title, url, messageBody(title, message, link, linkText));
}

/** The outage Worker's page (`src/ops/outage-worker/worker.js`, `outagePage`), in the Edge pages' shell. */
export const OUTAGE = {
  status: 503,
  title: "Endgame is temporarily unavailable",
  message: "It can't be reached right now. Nothing you have made has been lost — please try again in a few minutes.",
} as const;

export function renderOutagePage(url: AssetUrl = DEMO_ASSETS): string {
  return renderDocument(OUTAGE.title, url, `<h1>${htmlEncode(OUTAGE.title)}</h1>\n<p>${htmlEncode(OUTAGE.message)}</p>`);
}

/** `AuthPages.RedeemAsync`: an unknown, used or older-than-a-minute hand-off code (410). */
export const HANDOFF_EXPIRED = {
  status: 410,
  title: "This sign-in link has expired",
  message: "Sign-in links work once, for a minute. Sign in again to continue.",
  linkText: "Sign in again",
} as const;

/** `AuthPages.RedeemAsync`: the control plane could not redeem it (503). */
export const HANDOFF_FAILED = {
  status: 503,
  title: "Sign-in is unavailable just now",
  message: "Endgame could not finish signing you in. Please try again in a moment.",
  linkText: "Sign in again",
} as const;

// ---------------------------------------------------------------------------------------------
// The page script's own wording, and what its start() does to the page
// ---------------------------------------------------------------------------------------------

/** What `GET /api/app-auth/{appId}` tells the page (`AppIdentityService.InfoAsync`). */
export interface AppAuthInfo {
  appName: string;
  organisationName: string;
  /** Visitors may register and sign in: the app is shared or public. */
  signUp: boolean;
  /** Shared: registering needs the invited address and its code. */
  invitationRequired: boolean;
  developmentSignIn: boolean;
}

/** The page's `config` (`AuthPages.WritePageAsync`). */
export interface AuthPageConfig {
  page: AuthPageName;
  returnTo: string;
  handoff: boolean;
  signedIn: boolean;
  signInUrl: string;
  signUpUrl: string;
}

/** Every sentence the script writes into the page. */
export const authText = {
  signInTitle: (appName: string) => `Sign in to ${appName}`,
  signUpTitle: (appName: string) => `Create your sign-in for ${appName}`,
  privateLead: (appName: string, organisationName: string) => `${appName} is private: only members of ${organisationName} can open it.`,
  sharedLead: (appName: string) =>
    `${appName} is shared with chosen people. Use the address it was shared with and the invitation code you were given.`,
  publicLead: (appName: string) => `Anyone may use ${appName}. A passkey on this device signs you in — there is no password.`,
  belongsLead: (appName: string, organisationName: string) => `${appName} belongs to ${organisationName}.`,
  membersTitle: (organisationName: string) => `Members of ${organisationName}`,
  via: (host: string) => `Endgame keeps your sign-in at its own address, so you sign in here and go straight back to ${host}.`,
  back: (appName: string) => `Back to ${appName}`,
  unavailableLead: "Sign-in is unavailable just now.",
  passkeyClosed: "The passkey prompt was closed or timed out. Nothing was changed.",
  generic: "That did not work. Please try again.",
} as const;

/**
 * The refusals the control plane answers the page with, as the page shows them (each problem's
 * `detail`): `AppIdentityService` and `AccountService`.
 */
export const authProblems = {
  invalidEmail: "Give a valid e-mail address.",
  displayNameTooLong: "A display name is at most 200 characters.",
  privateApp: "This app is private: only members of the organisation with rights over it can open it.",
  invitation: "This app is shared with chosen people: register with the address it was shared with and the invitation code you were given.",
  alreadyRegistered: "That address is already registered with this app; sign in instead.",
  notShared: "This app is not shared with that address.",
  passkeyNotVerified: "That passkey could not be verified for this app.",
} as const;

/** The script's `passkeyError`. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return authText.passkeyClosed;
  return (error instanceof Error && error.message) || authText.generic;
}

/** `AccountService.NormaliseEmail`; throws the control plane's refusal. */
export function normaliseEmail(email: string | null | undefined): string {
  const trimmed = (email ?? "").trim().toLowerCase();
  const at = trimmed.indexOf("@");
  const valid = trimmed.length > 3 && trimmed.length <= 254 && at > 0 && at < trimmed.length - 1 && trimmed.indexOf("@", at + 1) < 0 && !trimmed.includes(" ");
  if (!valid) throw new Error(authProblems.invalidEmail);
  return trimmed;
}

/** `AccountService.DisplayName`; throws the control plane's refusal. */
export function displayNameFor(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return email.slice(0, email.indexOf("@"));
  if (trimmed.length > 200) throw new Error(authProblems.displayNameTooLong);
  return trimmed;
}

/**
 * The script's `start()`, applied to a parsed page: titles, lead, and which sections show. The
 * hand-off for a visitor already signed in is the gate's to follow before the page is drawn.
 */
export function applyAuthInfo(doc: Document, config: AuthPageConfig, info: AppAuthInfo): void {
  const $ = (id: string) => doc.getElementById(id);
  const show = (id: string, visible = true) => {
    const el = $(id);
    if (el) el.hidden = !visible;
  };
  const setText = (id: string, text: string) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  const setHref = (id: string, href: string) => $(id)?.setAttribute("href", href);

  const visitors = info.signUp === true;
  setText("title", config.page === "sign-up" ? authText.signUpTitle(info.appName) : authText.signInTitle(info.appName));
  // On the organisation subdomain the visitor was sent here, to the platform's host: say where they are, and why.
  if (config.handoff) {
    setText("via", authText.via(new URL(config.returnTo).host));
    show("via");
  }
  // A public app opens signed out too: signing in can wait.
  if (visitors && info.invitationRequired !== true) {
    setText("back-link", authText.back(info.appName));
    setHref("back-link", config.returnTo);
    show("back");
  }
  if (config.page === "sign-up") {
    if (!visitors) {
      setText("lead", authText.privateLead(info.appName, info.organisationName));
      return;
    }
    setText("lead", info.invitationRequired ? authText.sharedLead(info.appName) : authText.publicLead(info.appName));
    show("code-label", info.invitationRequired === true);
    show("sign-up");
    show("dev-up", info.developmentSignIn === true && !info.invitationRequired);
    setHref("to-sign-in", config.signInUrl);
    return;
  }

  setText("lead", authText.belongsLead(info.appName, info.organisationName));
  setText("members-title", authText.membersTitle(info.organisationName));
  show("members");
  show("visitors", visitors);
  setHref("to-sign-up", config.signUpUrl);
  show("dev", info.developmentSignIn === true);
  show("dev-visitor", info.developmentSignIn === true && visitors);
}

/** What the visitor did on an auth page; the demo answers each one. */
export type AuthAction =
  | { kind: "member-passkey" }
  | { kind: "visitor-passkey" }
  | { kind: "sign-up"; email: string; displayName: string; invitationCode: string }
  | { kind: "follow"; href: string }
  /** The development sign-in (ACC-13): as a member (a console account), or as a visitor of this app. */
  | { kind: "dev-member"; email: string }
  | { kind: "dev-visitor"; email: string; displayName: string };

/**
 * The script's event wiring, with each call to the control plane handed to `act`. As in the
 * original, the error line is cleared and the button disabled while it runs; a failure shows its
 * message and frees the button; success leaves the button disabled while the page moves on.
 * Returns a function that removes every listener.
 */
export function wireAuthPage(doc: Document, act: (action: AuthAction) => Promise<void>): () => void {
  const $ = (id: string) => doc.getElementById(id);
  const fail = (message: string) => {
    const el = $("error");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  };
  const run = async (button: HTMLButtonElement | null, action: AuthAction) => {
    const error = $("error");
    if (error) error.hidden = true;
    if (button) button.disabled = true;
    try {
      await act(action);
    } catch (e) {
      fail(passkeyErrorMessage(e));
      if (button) button.disabled = false;
    }
  };
  const value = (id: string) => (($(id) as HTMLInputElement | null)?.value ?? "").trim();

  const offs: (() => void)[] = [];
  const on = (target: EventTarget | null, type: string, listener: (event: Event) => void) => {
    if (!target) return;
    target.addEventListener(type, listener);
    offs.push(() => target.removeEventListener(type, listener));
  };

  on($("member-passkey"), "click", (event) => void run(event.currentTarget as HTMLButtonElement, { kind: "member-passkey" }));
  on($("visitor-passkey"), "click", (event) => void run(event.currentTarget as HTMLButtonElement, { kind: "visitor-passkey" }));
  on($("dev-member"), "click", (event) => void run(event.currentTarget as HTMLButtonElement, { kind: "dev-member", email: value("dev-email") }));
  on($("dev-visitor"), "click", (event) => void run(event.currentTarget as HTMLButtonElement, { kind: "dev-visitor", email: value("dev-email"), displayName: "" }));
  on($("dev-visitor-up"), "click", (event) => void run(event.currentTarget as HTMLButtonElement, { kind: "dev-visitor", email: value("email"), displayName: value("display-name") }));
  on($("sign-up"), "submit", (event) => {
    event.preventDefault();
    void run($("create") as HTMLButtonElement | null, {
      kind: "sign-up",
      email: value("email"),
      displayName: value("display-name"),
      invitationCode: value("code"),
    });
  });
  // Links lead to other pages of the app's address: the demo follows them itself.
  on(doc, "click", (event) => {
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href !== "#") void act({ kind: "follow", href });
  });
  return () => offs.forEach((off) => off());
}
