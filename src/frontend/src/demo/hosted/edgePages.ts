/*
 * The pages Endgame's Edge answers with itself, ported for the demo — markup, CSS and wording
 * copied from the platform's own source, so a visitor in the demo sees exactly what a visitor of a
 * hosted app sees:
 *
 * - `src/backend/Endgame.Edge/Pages/PageChrome.cs`   → {@link PAGE_CHROME_STYLE}
 * - `src/backend/Endgame.Edge/Pages/UnavailablePage.cs` → {@link UNAVAILABLE_COPY}, {@link renderUnavailablePage}
 * - `src/backend/Endgame.Edge/Pages/AuthPage.cs`     → {@link renderAuthPage}, {@link renderMessagePage}, {@link applyAuthInfo}
 * - `src/backend/Endgame.Edge/Access/AuthPages.cs`   → {@link HANDOFF_EXPIRED}, {@link HANDOFF_FAILED}
 *
 * TOKEN-RULE EXEMPTION. The CSS below carries sizes and spacing of its own because it is a verbatim
 * copy of the platform's page chrome, not the console's styling; it is rendered inside an isolated
 * document and never reaches the console's DOM. Its colours are the console's own role values
 * (PageChrome.cs says so itself), so they are read from `@/lib/tokens` rather than written out here,
 * and `hosted.test.ts` proves the result is byte-for-byte the C# string.
 *
 * What is deliberately not ported: the per-response CSP nonce, and the pages' scripts (passkey
 * ceremonies through `navigator.credentials` and `fetch` to the control plane). The demo has no
 * server, so `HostedAppView` drives the same DOM changes the script would make ({@link applyAuthInfo})
 * and answers the forms with the demo's simulated flows. Every visible word stays.
 */
import { roles } from "@/lib/tokens";

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

/** `PageChrome.Style`, exactly. */
export const PAGE_CHROME_STYLE = `  :root {
    --ground: ${r.ground}; --surface: ${r.surface}; --ink: ${r.ink.DEFAULT}; --ink-body: ${r.ink.body}; --ink-muted: ${r.ink.muted}; --border: ${r.border.DEFAULT}; --border-strong: ${r.border.strong};
    --primary: ${r.primary.DEFAULT}; --primary-hover: ${r.primary.hover}; --primary-ink: ${r.primary.ink}; --primary-tint: ${r.primary.tint}; --danger: ${r.attention.text}; --danger-tint: ${r.attention.tint};
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
  [hidden] { display: none !important; }`;

/**
 * The Endgame mark (`public/brand/endgame-mark.svg`), as a `data:` URL so the demo loads nothing.
 * Its colours are the token layer's: primary, primary-ink and the lit node.
 */
export const MARK_URL = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Endgame"><rect width="64" height="64" rx="16" fill="${r.primary.DEFAULT}"/><path d="M21 17v30M21 17h24M21 32h18M21 47h12" fill="none" stroke="${r.primary.ink}" stroke-width="5.5" stroke-linecap="round"/><circle cx="45" cy="17" r="5" fill="${r.primary.ink}"/><circle cx="39" cy="32" r="5" fill="${r.primary.ink}"/><circle cx="33" cy="47" r="5" fill="${r.live}"/></svg>`,
)}`;

// ---------------------------------------------------------------------------------------------
// UnavailablePage.cs
// ---------------------------------------------------------------------------------------------

/** Why the edge is answering instead of the app (`enum Unavailable`). */
export type Unavailable = "Crashed" | "Paused" | "BudgetSpent" | "Busy" | "NotReady" | "Slow" | "Temporary" | "Forbidden";

/** `UnavailablePage.Copy`: title and message for each reason. */
export const UNAVAILABLE_COPY: Record<Unavailable, { title: string; message: string }> = {
  Crashed: {
    title: "This app has stopped for a moment",
    message: "Something went wrong inside it. It will be started again shortly — please try again in a moment.",
  },
  Paused: {
    title: "This app is paused",
    message: "Its organisation has used up its credits. Nothing has been lost — it will be back as soon as they are topped up.",
  },
  BudgetSpent: {
    title: "This app is paused",
    message: "It has used this month's budget. Nothing has been lost — it will be back as soon as the budget is raised or the month turns.",
  },
  Busy: { title: "This app could not start just now", message: "Endgame is very busy at the moment. Please try again in a minute." },
  NotReady: {
    title: "This app isn't ready yet",
    message: "It has an address, but its first version has not been published. Please check back soon.",
  },
  Slow: { title: "This app is taking longer than usual", message: "It is still starting. Please try again in a few seconds." },
  Forbidden: {
    title: "You don't have access to this app",
    message: "You are signed in, but this app has not been shared with you. Ask its owner for access.",
  },
  Temporary: { title: "This app is temporarily unavailable", message: "Endgame could not reach it just now. Please try again in a moment." },
};

/** `UnavailablePage.StatusFor`. */
export function unavailableStatus(reason: Unavailable): number {
  return reason === "Forbidden" ? 403 : 503;
}

/** `UnavailablePage.Render`: the mark from `markUrl`, or the wordmark when none is known. */
export function renderUnavailablePage(reason: Unavailable, markUrl: string | null = MARK_URL): string {
  const { title, message } = UNAVAILABLE_COPY[reason];
  const mark =
    markUrl === null
      ? `<span class="wordmark">Endgame</span>`
      : `<img class="mark" src="${htmlEncode(markUrl)}" alt="Endgame" width="48" height="48">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${htmlEncode(title)} · Endgame</title>
<style>
${PAGE_CHROME_STYLE}
</style>
</head>
<body>
<main>
${mark}
<h1>${htmlEncode(title)}</h1>
<p>${htmlEncode(message)}</p>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// AuthPage.cs
// ---------------------------------------------------------------------------------------------

export type AuthPageName = "sign-in" | "sign-up";

/** `AuthPage.Body("sign-up")`, exactly. */
export const SIGN_UP_BODY = `<h1 id="title">Create your sign-in</h1>
<p id="lead">Checking what this app offers…</p>
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
<p id="error" class="error" role="alert" hidden></p>`;

/** `AuthPage.Body("sign-in")`, exactly. */
export const SIGN_IN_BODY = `<h1 id="title">Sign in</h1>
<p id="lead">Checking what this app offers…</p>
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
<p id="error" class="error" role="alert" hidden></p>`;

/** `AuthPage.Shell`, without the nonce and with the scripts left out (see the note at the top). */
function shell(title: string, markUrl: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${htmlEncode(title)} · Endgame</title>
<style>
${PAGE_CHROME_STYLE}
</style>
</head>
<body>
<main>
<img class="mark" src="${htmlEncode(markUrl)}" alt="Endgame" width="48" height="48">
${body}
</main>

</body>
</html>`;
}

/** `AuthPage.WriteAsync`: the sign-in or sign-up page, before its script has run. */
export function renderAuthPage(page: AuthPageName, markUrl: string = MARK_URL): string {
  const title = page === "sign-up" ? "Create your sign-in" : "Sign in";
  return shell(title, markUrl, page === "sign-up" ? SIGN_UP_BODY : SIGN_IN_BODY);
}

/** `AuthPage.WriteMessageAsync`: a title, a message and one link onward. */
export function renderMessagePage(title: string, message: string, link: string, linkText: string, markUrl: string = MARK_URL): string {
  const body = `<h1>${htmlEncode(title)}</h1>
<p>${htmlEncode(message)}</p>
<p class="note"><a class="button" href="${htmlEncode(link)}">${htmlEncode(linkText)}</a></p>`;
  return shell(title, markUrl, body);
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
  | { kind: "follow"; href: string };

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
