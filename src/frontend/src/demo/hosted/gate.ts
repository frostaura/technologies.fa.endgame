/**
 * Which page Endgame's Edge serves for a request, ported from the platform:
 *
 * 1. `Routing/AppGate.InvokeAsync` — paused and unpublished apps get their page and are never woken;
 *    `_platform` is never public; `_endgame/auth/*` is the Edge's own identity pages.
 * 2. `Access/AuthPages.HandleAsync` — sign-in and sign-up (on an organisation subdomain, sent to the
 *    platform's host first), hand-off, sign-out; anything else is a 404.
 * 3. `Access/AccessGate.CheckAsync` + `AppIdentityService.CheckAsync` — allow, ask to sign in, or deny.
 * 4. Back in `AppGate` — an admitted visitor to a crashed app gets the crashed page; to a sleeping
 *    one, a wait while it wakes (the Edge has no "waking" page: the request simply takes longer).
 */
import { escapeDataString, HANDOFF_EXPIRED, unavailableStatus, type AuthPageConfig, type AuthPageName, type PageLinks, type Unavailable } from "./edgePages";
import type { HostedApp, HostedVisitor } from "./types";

export const AUTH_PATH = "_endgame/auth";
const PLATFORM_PATH = "_platform";

// ---------------------------------------------------------------------------------------------
// The two addresses (AuthPages.AppAddresses)
// ---------------------------------------------------------------------------------------------

export type Form = "path" | "subdomain";

export interface Addresses {
  /** The path form's home, on the platform's host, with its trailing slash. */
  pathHome: string;
  /** The organisation subdomain's home, with its trailing slash. */
  subdomainHome: string;
}

function normaliseHome(address: string): string {
  let home = address.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(home)) home = `https://${home}`;
  const url = new URL(home);
  return `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
}

export function addressesOf(app: Pick<HostedApp, "addresses">): Addresses {
  return { pathHome: normaliseHome(app.addresses.path), subdomainHome: normaliseHome(app.addresses.subdomain) };
}

export function homeOf(addresses: Addresses, form: Form): string {
  return form === "subdomain" ? addresses.subdomainHome : addresses.pathHome;
}

/** The full address for a path inside the app. */
export function addressFor(addresses: Addresses, form: Form, rest: string): string {
  return homeOf(addresses, form) + rest.replace(/^\/+/, "");
}

/** Which of the app's addresses an absolute URL is under, and the path inside it; null when it is neither. */
export function restOf(addresses: Addresses, url: string): { form: Form; rest: string } | null {
  const homes: [Form, string][] = [
    ["path", addresses.pathHome],
    ["subdomain", addresses.subdomainHome],
  ];
  homes.sort((a, b) => b[1].length - a[1].length);
  for (const [form, home] of homes) {
    if (url.toLowerCase().startsWith(home.toLowerCase())) return { form, rest: url.slice(home.length) };
    if (url === home.slice(0, -1)) return { form, rest: "" };
  }
  return null;
}

/** The app's address on its host with no trailing slash (`app.PathPrefix` / `app.HostPrefix`). */
function prefixOf(home: string): string {
  return new URL(home).pathname.replace(/\/$/, "");
}

const hasControl = (value: string) => [...value].some((c) => {
  const code = c.charCodeAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
});

/** `AuthPages.IsInside`: a path at or beneath the app's address on this host. */
export function isInside(appAddress: string, returnTo: string | null | undefined): boolean {
  if (
    !returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    returnTo.includes("/../") ||
    returnTo.endsWith("/..") ||
    returnTo.includes("/./") ||
    hasControl(returnTo)
  ) {
    return false;
  }
  const path = returnTo.split(/[?#]/)[0] ?? "";
  return path === appAddress || path.startsWith(`${appAddress}/`) || (appAddress.length === 0 && path.startsWith("/"));
}

/** `AppAddresses.Inside`: `returnTo` as an absolute URL inside the app, or null when it is not. */
export function inside(addresses: Addresses, form: Form, returnTo: string | null | undefined): string | null {
  if (!returnTo || returnTo.length > 2000) return null;
  const current = homeOf(addresses, form);
  if (returnTo.startsWith("/")) {
    return isInside(prefixOf(current), returnTo) ? `${new URL(current).origin}${returnTo}` : null;
  }
  let uri: URL;
  try {
    uri = new URL(returnTo);
  } catch {
    return null;
  }
  if (uri.username || uri.password || hasControl(returnTo) || returnTo.includes("\\")) return null;
  for (const home of [addresses.pathHome, addresses.subdomainHome]) {
    const root = new URL(home);
    if (
      uri.protocol === root.protocol &&
      uri.port === root.port &&
      uri.hostname.toLowerCase() === root.hostname.toLowerCase() &&
      isInside(root.pathname.replace(/\/$/, ""), uri.pathname + uri.search)
    ) {
      return uri.href;
    }
  }
  return null;
}

/** The query of a path inside the app, e.g. `returnTo`. */
export function queryParam(rest: string, name: string): string | null {
  const q = rest.indexOf("?");
  return q < 0 ? null : new URLSearchParams(rest.slice(q + 1)).get(name);
}

/** The platform's sign-in or sign-up page for the app, returning to `returnTo` (a path or absolute URL). */
export function authRest(page: AuthPageName | "sign-out", returnTo?: string): string {
  return returnTo === undefined ? `${AUTH_PATH}/${page}` : `${AUTH_PATH}/${page}?returnTo=${escapeDataString(returnTo)}`;
}

// ---------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------

export type GateOutcome =
  /** Forwarded to the app. `session` is who the app is told is signed in; `wake` when it must be woken first. */
  | { kind: "app"; session: "member" | "end-user" | null; wake: boolean }
  /** One of `UnavailablePage`'s pages, with where it may send the visitor next. */
  | { kind: "unavailable"; reason: Unavailable; status: number; links: PageLinks }
  /** `AuthPage`'s sign-in or sign-up page, with its config. */
  | { kind: "auth"; page: AuthPageName; config: AuthPageConfig }
  /** `AuthPage.WriteMessageAsync` for a hand-off that cannot be redeemed. */
  | { kind: "message"; status: number; title: string; message: string; link: string; linkText: string }
  /** 302 to an absolute address. */
  | { kind: "redirect"; location: string }
  /** End the visitor's session, then 302 to `location`. */
  | { kind: "sign-out"; location: string }
  /** The host cannot be reached: Cloudflare's outage Worker answers 503 with its own page. */
  | { kind: "outage" }
  /** A bare 404 with no body. */
  | { kind: "not-found" };

export interface GateRequest {
  app: HostedApp;
  form: Form;
  rest: string;
  visitor: HostedVisitor;
  /** The app has already been woken during this page's life. */
  awake?: boolean;
}

const startsWithSegment = (path: string, segment: string) => {
  const p = path.toLowerCase();
  const s = segment.toLowerCase();
  return p.startsWith(s) && (p.length === s.length || p[s.length] === "/");
};

/** A session cookie on this host: a member's console session, or this app's own visitor's. */
export function isSignedIn(visitor: HostedVisitor): boolean {
  return visitor.kind === "member" || visitor.kind === "member-without-access" || visitor.kind === "end-user";
}

/** `AppIdentityService.CheckAsync`: allow (with who the app is told about), ask to sign in, or deny. */
export function accessCheck(
  app: Pick<HostedApp, "access">,
  visitor: HostedVisitor,
): { decision: "allow"; session: "member" | "end-user" | null } | { decision: "sign-in" } | { decision: "deny" } {
  const mode = app.access;
  // AccessGate: a public app with no cookie opens without asking.
  if (mode === "public" && !isSignedIn(visitor)) return { decision: "allow", session: null };
  if (visitor.kind === "member") return { decision: "allow", session: "member" };
  if (visitor.kind === "end-user" && mode !== "private" && (mode === "public" || visitor.stillShared !== false)) {
    return { decision: "allow", session: "end-user" };
  }
  // Anyone may open a public app; a session only tells the app who they are.
  if (mode === "public") return { decision: "allow", session: null };
  // Someone signed in who may not open it is refused; someone not signed in is asked to.
  return isSignedIn(visitor) ? { decision: "deny" } : { decision: "sign-in" };
}

/**
 * `AppGate.Links`: the same address again; the console — on the path form it shares the host, on the
 * subdomain it is the platform's origin; a member's console session (only ever on the platform's
 * host); and the app's sign-out, returning to its sign-in.
 */
export function pageLinks(request: GateRequest): PageLinks {
  const addresses = addressesOf(request.app);
  const home = homeOf(addresses, request.form);
  const here = new URL(addressFor(addresses, request.form, request.rest.replace(/^\/+/, "")));
  const appAddress = prefixOf(home);
  const signIn = `${appAddress}/${AUTH_PATH}/sign-in?returnTo=${escapeDataString(`${appAddress}/`)}`;
  const member = request.visitor.kind === "member" || request.visitor.kind === "member-without-access";
  return {
    here: here.pathname + here.search,
    console: request.form === "path" ? "" : new URL(addresses.pathHome).origin,
    member: member && request.form === "path",
    switchAccount: `${appAddress}/${AUTH_PATH}/sign-out?returnTo=${escapeDataString(signIn)}`,
    appId: request.app.id,
  };
}

function unavailable(reason: Unavailable, links: PageLinks): Extract<GateOutcome, { kind: "unavailable" }> {
  return { kind: "unavailable", reason, status: unavailableStatus(reason), links };
}

/** One request through the Edge. */
export function decide(request: GateRequest): GateOutcome {
  const { app, form, visitor } = request;
  // Cloudflare's outage Worker answers before the request ever reaches the Edge (src/ops/outage-worker).
  if (app.state === "outage") return { kind: "outage" };
  const addresses = addressesOf(app);
  const home = homeOf(addresses, form);
  const links = pageLinks(request);

  if (app.state === "paused") return unavailable(app.pausedReason === "budget" ? "BudgetSpent" : "Paused", links);
  if (app.state === "not-published") return unavailable("NotReady", links);

  const rest = request.rest.replace(/^\/+/, "");
  const q = rest.indexOf("?");
  const inApp = `/${q < 0 ? rest : rest.slice(0, q)}`;
  const query = q < 0 ? "" : rest.slice(q);

  if (startsWithSegment(inApp, `/${PLATFORM_PATH}`)) return { kind: "not-found" };

  if (startsWithSegment(inApp, `/${AUTH_PATH}`)) {
    const page = inApp.slice(AUTH_PATH.length + 1).replace(/^\/+|\/+$/g, "");
    const returnTo = inside(addresses, form, queryParam(rest, "returnTo")) ?? home;
    switch (page) {
      case "sign-in":
      case "sign-up": {
        if (form === "subdomain") {
          // A member's console session lives on the platform's host: sign in there, then hand off back here.
          return { kind: "redirect", location: `${addresses.pathHome}${AUTH_PATH}/${page}?returnTo=${escapeDataString(returnTo)}` };
        }
        const config: AuthPageConfig = {
          page,
          returnTo,
          // A return to the organisation subdomain cannot carry this host's cookie: hand the session off.
          handoff: new URL(returnTo).hostname.toLowerCase() === new URL(addresses.subdomainHome).hostname.toLowerCase(),
          signedIn: isSignedIn(visitor),
          signInUrl: `${home}${AUTH_PATH}/sign-in?returnTo=${escapeDataString(returnTo)}`,
          signUpUrl: `${home}${AUTH_PATH}/sign-up?returnTo=${escapeDataString(returnTo)}`,
        };
        // The page's script: already signed in here, the session is carried straight on.
        if (page === "sign-in" && config.handoff && config.signedIn) return { kind: "redirect", location: returnTo };
        return { kind: "auth", page, config };
      }
      case "handoff":
        // The demo never issues a one-time code, so any hand-off link reached by hand has expired.
        return {
          kind: "message",
          status: HANDOFF_EXPIRED.status,
          title: HANDOFF_EXPIRED.title,
          message: HANDOFF_EXPIRED.message,
          link: `${home}${AUTH_PATH}/sign-in?returnTo=${escapeDataString(home)}`,
          linkText: HANDOFF_EXPIRED.linkText,
        };
      case "sign-out":
        return { kind: "sign-out", location: returnTo };
      default:
        return { kind: "not-found" };
    }
  }

  const check = accessCheck(app, visitor);
  if (check.decision === "sign-in") {
    const appAddress = prefixOf(home);
    const original = appAddress + inApp + query;
    return { kind: "redirect", location: `${new URL(home).origin}${appAddress}/${AUTH_PATH}/sign-in?returnTo=${escapeDataString(original)}` };
  }
  if (check.decision === "deny") return unavailable("Forbidden", links);

  if (app.state === "crashed") return unavailable("Crashed", links);
  // `AppGate.ReasonFor`: a wake that did not finish — over 30 seconds, no room on the host, or anything else.
  if (app.state === "slow") return unavailable("Slow", links);
  if (app.state === "busy") return unavailable("Busy", links);
  if (app.state === "unreachable") return unavailable("Temporary", links);
  return { kind: "app", session: check.session, wake: app.state === "asleep" && request.awake !== true };
}

/**
 * `AppGate` on an organisation's app host, at an address no app has: the no-app page (404). The
 * demo only knows the platform's origin, not which address was asked for.
 */
export function noAppLinks(platformOrigin: string): PageLinks {
  return { here: "/", console: platformOrigin, address: null };
}

export interface Resolved {
  outcome: Exclude<GateOutcome, { kind: "redirect" }>;
  /** What the address bar shows once every redirect has been followed. */
  address: string;
  form: Form;
  rest: string;
}

/** Follows the Edge's redirects the way a browser would, to the page that is finally shown. */
export function resolve(request: GateRequest): Resolved {
  const addresses = addressesOf(request.app);
  let form = request.form;
  let rest = request.rest.replace(/^\/+/, "");
  for (let hop = 0; hop < 6; hop++) {
    const outcome = decide({ ...request, form, rest });
    if (outcome.kind !== "redirect") return { outcome, address: addressFor(addresses, form, rest), form, rest };
    const next = restOf(addresses, outcome.location);
    if (!next) return { outcome: { kind: "not-found" }, address: outcome.location, form, rest };
    form = next.form;
    rest = next.rest;
  }
  return { outcome: unavailable("Temporary", pageLinks({ ...request, form, rest })), address: addressFor(addresses, form, rest), form, rest };
}
