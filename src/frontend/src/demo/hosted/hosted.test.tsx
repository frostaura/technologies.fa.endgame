import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAuthInfo,
  assetsAt,
  authProblems,
  authText,
  DISPLAY_FILE,
  escapeDataString,
  fontFaces,
  htmlEncode,
  MARK_FILE,
  messageBody,
  ONWARD,
  PAGE_CHROME_STYLE,
  renderAuthPage,
  renderDocument,
  renderUnavailablePage,
  SANS_FILE,
  SIGN_IN_BODY,
  SIGN_UP_BODY,
  UNAVAILABLE_COPY,
  type AppAuthInfo,
  type AuthPageConfig,
  type PageLinks,
  type Unavailable,
} from "./edgePages";
import { accessCheck, decide, inside, addressesOf, isInside, pageLinks, resolve, type GateOutcome } from "./gate";
import { HostedAppView, HostedUnknownApp } from "./HostedAppView";
import { CLUB_MEMBERS, newReadingList, readingListFor } from "./readingList";
import { pageKeyFor, type AppPageKey } from "./apps";
import { defaultWorld } from "../world/default";
import { STORIES, storyFor } from "../world/story";
import type { HostedApp, HostedAppState, HostedContext, HostedVisitor } from "./types";

// ---------------------------------------------------------------------------------------------
// The C# the pages are ported from
// ---------------------------------------------------------------------------------------------

const edge = join(import.meta.dirname, "../../../../backend/Endgame.Edge");
const cs = (file: string) => readFileSync(join(edge, file), "utf8");

/** Every C# raw string literal (`"""…"""`) in a file, with its indentation removed as the compiler does. */
function rawStrings(source: string): string[] {
  const out: string[] = [];
  const re = /\$*"""\n([\s\S]*?)\n([ ]*)"""/g;
  for (const m of source.matchAll(re)) {
    const indent = m[2] ?? "";
    out.push((m[1] ?? "").split("\n").map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart())).join("\n"));
  }
  return out;
}

const pageChrome = cs("Pages/PageChrome.cs");
const authPage = cs("Pages/AuthPage.cs");
const unavailablePage = cs("Pages/UnavailablePage.cs");
const authPages = cs("Access/AuthPages.cs");

describe("the Edge's pages are the platform's own", () => {
  it("carries PageChrome.Style byte for byte, colours included", () => {
    expect(rawStrings(pageChrome)[0]).toBe(PAGE_CHROME_STYLE);
    expect(PAGE_CHROME_STYLE).toContain("--ground: #F5F6FB;");
    expect(PAGE_CHROME_STYLE).toContain("--danger: #B42318;");
    // Fields carry the 3:1 field edge, as the console's do (ARCH-011).
    expect(PAGE_CHROME_STYLE).toContain("--border-field: #868DA3;");
    expect(PAGE_CHROME_STYLE).toContain("border: 1px solid var(--border-field);");
    expect(PAGE_CHROME_STYLE).toContain("--shadow-card: 0 1px 2px rgb(11 16 32 / 0.05), 0 10px 28px rgb(11 16 32 / 0.05);");
  });

  it("carries PageChrome.Fonts and PageChrome.Document byte for byte", () => {
    const [, fonts, documentTemplate] = rawStrings(pageChrome);
    const assets = "/acme/apps/notes/web/_endgame/assets";
    const url = assetsAt(assets);
    expect(pageChrome).toContain(`SansFile = "${SANS_FILE}"`);
    expect(pageChrome).toContain(`DisplayFile = "${DISPLAY_FILE}"`);
    expect(pageChrome).toContain(`MarkFile = "${MARK_FILE}"`);
    expect((fonts ?? "").replaceAll("{{assets}}", assets).replace("{{SansFile}}", SANS_FILE).replace("{{DisplayFile}}", DISPLAY_FILE)).toBe(fontFaces(url));
    const expected = (documentTemplate ?? "")
      .replace("{{head}}", "\n<meta x>")
      .replace("{{WebUtility.HtmlEncode(title)}}", htmlEncode("It’s <here>"))
      .replace("{{styleAttributes}}", ' nonce="n"')
      .replace("{{Fonts(assets)}}", fontFaces(url))
      .replace("{{Style}}", PAGE_CHROME_STYLE)
      .replace("{{WebUtility.HtmlEncode(assets)}}", htmlEncode(assets))
      .replace("{{MarkFile}}", MARK_FILE)
      .replace("{{body}}", "<p>body</p>")
      .replace("{{scripts}}", "\n<script></script>");
    expect(renderDocument("It’s <here>", url, "<p>body</p>", "\n<meta x>", ' nonce="n"', "\n<script></script>")).toBe(expected);
  });

  it("carries both AuthPage bodies byte for byte", () => {
    const strings = rawStrings(authPage);
    expect(strings).toContain(SIGN_UP_BODY);
    expect(strings).toContain(SIGN_IN_BODY);
  });

  it("carries every UnavailablePage title and message, and its words for the ways onward", () => {
    const copy = [...unavailablePage.matchAll(/(Unavailable\.(\w+)|_) => \("([^"]+)",\s*"([^"]+)"\)/g)];
    expect(copy).toHaveLength(9);
    for (const m of copy) {
      const reason = (m[2] ?? "Temporary") as Unavailable;
      expect(UNAVAILABLE_COPY[reason]).toEqual({ title: m[3], message: m[4] });
    }
  });

  it("names every way onward with UnavailablePage's own words", () => {
    for (const words of [ONWARD.tryAgain, ONWARD.goToEndgame, ONWARD.signInAsSomeoneElse, ONWARD.yourApp, ONWARD.retriesItself, ONWARD.topUp, ONWARD.raiseBudget, ONWARD.openIt]) {
      expect(unavailablePage).toContain(`"${words}"`);
    }
    // Typographic apostrophes everywhere (real-stack 58).
    for (const { title, message } of Object.values(UNAVAILABLE_COPY)) expect(title + message).not.toContain("'");
  });

  // The same expectations as Endgame.Tests' UnavailablePageTests, so both renderings are held to one result.
  const LINKS: PageLinks = {
    here: "/acme/apps/notes/web/books?page=2",
    console: "",
    member: true,
    switchAccount: "/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=x",
    appId: "6f0b1c2d-0000-4000-8000-000000000001",
  };
  const page = (reason: Unavailable, links: PageLinks = LINKS) => renderUnavailablePage(reason, links, assetsAt("/acme/apps/notes/web/_endgame/assets"));

  it("renders the unavailable pages as UnavailablePage.Render does", () => {
    for (const reason of ["Crashed", "Busy", "Slow", "Temporary", "Paused", "BudgetSpent", "NotReady"] as Unavailable[]) {
      expect(page(reason)).toContain('<nav class="actions" aria-label="What to do next"><a class="button" href="/acme/apps/notes/web/books?page=2">Try again</a></nav>');
    }
    expect(page("Slow")).toContain('<meta http-equiv="refresh" content="3">');
    expect(page("Slow")).toContain('<p class="note">This page tries again by itself in a few seconds.</p>');
    expect(page("Forbidden")).toContain(
      '<a class="button" href="/">Go to Endgame</a><a class="button secondary" href="/acme/apps/notes/web/_endgame/auth/sign-out?returnTo=x">Sign in as someone else</a>',
    );
    expect(page("Paused", { ...LINKS, console: "https://endgame.test" })).toContain(
      '<p class="note">Is this your app? <a href="https://endgame.test/credits">Top up the credits in Endgame</a></p>',
    );
    expect(page("BudgetSpent")).toContain(`<a href="/apps/${LINKS.appId}">Raise its budget in Endgame</a>`);
    expect(page("NotReady", { ...LINKS, console: null })).not.toContain('class="note"');
    expect(page("Crashed")).toContain('<img class="mark" src="/acme/apps/notes/web/_endgame/assets/endgame-mark.svg"');
    const noApp = renderUnavailablePage("NoApp", { here: "/x", console: "https://endgame.test", address: "acme.endgame.test/community/<no-such-app>/web/" }, assetsAt("/_endgame/assets"));
    expect(noApp).toContain("<h1>There is no app at this address</h1>");
    expect(noApp).toContain('<p class="address">acme.endgame.test/community/&lt;no-such-app&gt;/web/</p>');
    expect(noApp).toContain('<a class="button" href="https://endgame.test/">Go to Endgame</a>');
    expect(authPage).toContain('<nav class=\\"actions\\" aria-label=\\"What to do next\\"><a class=\\"button\\" href=\\"');
    expect(messageBody("T", "M", "/l", "Sign in again")).toBe('<h1>T</h1>\n<p>M</p>\n<nav class="actions" aria-label="What to do next"><a class="button" href="/l">Sign in again</a></nav>');
  });

  it("uses the script's and the control plane's exact wording", () => {
    const service = readFileSync(join(edge, "../Endgame.Infrastructure/Platform/AppIdentityService.cs"), "utf8");
    for (const message of [authProblems.invitation, authProblems.privateApp, authProblems.alreadyRegistered, authProblems.notShared, authProblems.passkeyNotVerified]) {
      expect(service).toContain(message);
    }
    for (const fragment of [
      "`Sign in to ${info.appName}`",
      "`Create your sign-in for ${info.appName}`",
      "is shared with chosen people. Use the address it was shared with and the invitation code you were given.",
      "`Anyone may use ${info.appName}. A passkey on this device signs you in — there is no password.`",
      "`${info.appName} belongs to ${info.organisationName}.`",
      "`Members of ${info.organisationName}`",
      "Endgame keeps your sign-in at its own address, so you sign in here and go straight back to ${new URL(config.returnTo).host}.",
      "`Back to ${info.appName}`",
      "The passkey prompt was closed or timed out. Nothing was changed.",
    ]) {
      expect(authPage).toContain(fragment);
    }
    expect(authPages).toContain('"This sign-in link has expired"');
    expect(authPages).toContain('"Sign-in links work once, for a minute. Sign in again to continue."');
  });

  it("encodes as WebUtility.HtmlEncode and Uri.EscapeDataString do", () => {
    expect(htmlEncode(`<b>"Tom's" & café 😀</b>`)).toBe("&lt;b&gt;&quot;Tom&#39;s&quot; &amp; caf&#233; &#128512;&lt;/b&gt;");
    expect(htmlEncode("This app isn't ready yet")).toBe("This app isn&#39;t ready yet");
    expect(htmlEncode("This app isn’t ready yet")).toBe("This app isn’t ready yet");
    expect(escapeDataString("/a b/it's(1)!*")).toBe("%2Fa%20b%2Fit%27s%281%29%21%2A");
  });
});

// ---------------------------------------------------------------------------------------------
// What the page shows once its script has run
// ---------------------------------------------------------------------------------------------

function page(page: "sign-in" | "sign-up", access: HostedApp["access"]): Document {
  const doc = new DOMParser().parseFromString(renderAuthPage(page), "text/html");
  const config: AuthPageConfig = { page, returnTo: "https://x/", handoff: false, signedIn: false, signInUrl: "https://x/in", signUpUrl: "https://x/up" };
  const info: AppAuthInfo = { appName: "Club Reading List", organisationName: "Northfield Readers", signUp: access !== "private", invitationRequired: access === "shared", developmentSignIn: false };
  applyAuthInfo(doc, config, info);
  return doc;
}

const visibleText = (doc: Document) =>
  [...doc.querySelectorAll("main *")]
    .filter((el) => !el.closest("[hidden]") && el.children.length === 0)
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

describe("the sign-in and sign-up pages", () => {
  it("sign-in to a private app offers members only", () => {
    const doc = page("sign-in", "private");
    expect(doc.title).toBe("Sign in · Endgame");
    expect(visibleText(doc)).toEqual([
      "Sign in to Club Reading List",
      "Club Reading List belongs to Northfield Readers.",
      "Members of Northfield Readers",
      "Sign in with the passkey you use for Endgame.",
      "Sign in with a passkey",
    ]);
  });

  it("sign-in to a shared or public app adds the app's own visitors", () => {
    const text = visibleText(page("sign-in", "shared"));
    expect(text).toContain("Using this app");
    expect(text).toContain("Sign in with your passkey");
    expect(text).toContain("Create your sign-in");
    expect(text).not.toContain("Development sign-in");
  });

  it("sign-up to a shared app asks for the invitation code", () => {
    const doc = page("sign-up", "shared");
    expect(doc.title).toBe("Create your sign-in · Endgame");
    expect(visibleText(doc)).toEqual([
      "Create your sign-in for Club Reading List",
      "Club Reading List is shared with chosen people. Use the address it was shared with and the invitation code you were given.",
      "Create a passkey",
      "Sign in",
    ]);
    expect(doc.getElementById("code-label")?.hidden).toBe(false);
    expect(doc.getElementById("to-sign-in")?.getAttribute("href")).toBe("https://x/in");
  });

  it("sign-up to a public app needs no code; to a private one, shows no form", () => {
    const open = page("sign-up", "public");
    expect(open.getElementById("lead")?.textContent).toBe("Anyone may use Club Reading List. A passkey on this device signs you in — there is no password.");
    expect(open.getElementById("code-label")?.hidden).toBe(true);
    const closed = page("sign-up", "private");
    expect(closed.getElementById("lead")?.textContent).toBe("Club Reading List is private: only members of Northfield Readers can open it.");
    expect(closed.getElementById("sign-up")?.hidden).toBe(true);
  });

  it("says where a visitor sent from the subdomain is signing in, and why; a public app's page leads back to it", () => {
    const doc = new DOMParser().parseFromString(renderAuthPage("sign-in"), "text/html");
    const config: AuthPageConfig = { page: "sign-in", returnTo: "https://northfield.apps.example/community/club/reading-list/", handoff: true, signedIn: false, signInUrl: "https://x/in", signUpUrl: "https://x/up" };
    applyAuthInfo(doc, config, { appName: "Club Reading List", organisationName: "Northfield Readers", signUp: true, invitationRequired: false, developmentSignIn: false });
    expect(doc.getElementById("via")?.hidden).toBe(false);
    expect(doc.getElementById("via")?.textContent).toBe(authText.via("northfield.apps.example"));
    expect(doc.getElementById("via")?.textContent).toBe(
      "Endgame keeps your sign-in at its own address, so you sign in here and go straight back to northfield.apps.example.",
    );
    expect(doc.getElementById("back")?.hidden).toBe(false);
    expect(doc.getElementById("back-link")?.textContent).toBe("Back to Club Reading List");
    expect(doc.getElementById("back-link")?.getAttribute("href")).toBe(config.returnTo);
    // On the platform's host, to a private app: neither (the app's address would only lead back here).
    const plain = page("sign-in", "private");
    expect(plain.getElementById("via")?.hidden).toBe(true);
    expect(plain.getElementById("back")?.hidden).toBe(true);
  });

  it("the paused page reads as the platform's", () => {
    const doc = new DOMParser().parseFromString(renderUnavailablePage("Paused", { here: "/", console: "" }), "text/html");
    expect(doc.title).toBe("This app is paused · Endgame");
    expect(doc.querySelector("h1")?.textContent).toBe("This app is paused");
    expect(doc.querySelector("main p")?.textContent).toBe(
      "Its organisation has used up its credits. Nothing has been lost\u00a0— it will be back as soon as they are topped up.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

const APP: HostedApp = {
  id: "app-1",
  name: "Club Reading List",
  organisationName: "Northfield Readers",
  access: "private",
  state: "running",
  addresses: { path: "https://endgame.example/northfield/community/club/reading-list/", subdomain: "https://northfield.apps.example/community/club/reading-list/" },
};

const V: Record<HostedVisitor["kind"], HostedVisitor> = {
  member: { kind: "member", displayName: "Amara Okafor", email: "amara.okafor@bookclub.example" },
  "member-without-access": { kind: "member-without-access", displayName: "Sam Ortiz", email: "sam@northfield.example" },
  invited: { kind: "invited", displayName: null, email: "lee@readers.example" },
  "end-user": { kind: "end-user", displayName: "Lee Chen", email: "lee@readers.example" },
  "signed-out": { kind: "signed-out", displayName: null, email: null },
};

const kindOf = (o: GateOutcome) => (o.kind === "unavailable" ? o.reason : o.kind === "auth" ? `auth:${o.page}` : o.kind === "app" ? `app:${o.session ?? "anonymous"}${o.wake ? ":wake" : ""}` : o.kind);

function shown(access: HostedApp["access"], kind: HostedVisitor["kind"], state: HostedAppState = "running", form: "path" | "subdomain" = "path", rest = "") {
  return resolve({ app: { ...APP, access, state }, form, rest, visitor: V[kind] });
}

describe("the gate", () => {
  const table: [HostedApp["access"], HostedVisitor["kind"], string][] = [
    ["private", "member", "app:member"],
    ["private", "member-without-access", "Forbidden"],
    ["private", "invited", "auth:sign-in"],
    ["private", "end-user", "Forbidden"],
    ["private", "signed-out", "auth:sign-in"],
    ["shared", "member", "app:member"],
    ["shared", "member-without-access", "Forbidden"],
    ["shared", "invited", "auth:sign-in"],
    ["shared", "end-user", "app:end-user"],
    ["shared", "signed-out", "auth:sign-in"],
    ["public", "member", "app:member"],
    ["public", "member-without-access", "app:anonymous"],
    ["public", "invited", "app:anonymous"],
    ["public", "end-user", "app:end-user"],
    ["public", "signed-out", "app:anonymous"],
  ];
  it.each(table)("a running %s app shown to %s: %s", (access, kind, expected) => {
    expect(kindOf(shown(access, kind).outcome)).toBe(expected);
    expect(kindOf(shown(access, kind, "running", "subdomain").outcome)).toBe(expected);
  });

  it("paused and unpublished apps answer before anyone is asked to sign in", () => {
    for (const kind of Object.keys(V) as HostedVisitor["kind"][]) {
      expect(kindOf(shown("private", kind, "paused").outcome)).toBe("Paused");
      expect(kindOf(shown("private", kind, "not-published").outcome)).toBe("NotReady");
    }
    expect(kindOf(resolve({ app: { ...APP, state: "paused", pausedReason: "budget" }, form: "path", rest: "", visitor: V.member }).outcome)).toBe("BudgetSpent");
  });

  it("a crashed app is shown as crashed only to someone admitted", () => {
    expect(kindOf(shown("private", "member", "crashed").outcome)).toBe("Crashed");
    expect(kindOf(shown("private", "signed-out", "crashed").outcome)).toBe("auth:sign-in");
    expect(kindOf(shown("private", "member-without-access", "crashed").outcome)).toBe("Forbidden");
    expect(kindOf(shown("public", "signed-out", "crashed").outcome)).toBe("Crashed");
  });

  it("a sleeping app wakes for someone admitted, and only once", () => {
    expect(kindOf(shown("shared", "end-user", "asleep").outcome)).toBe("app:end-user:wake");
    expect(kindOf(resolve({ app: { ...APP, state: "asleep" }, form: "path", rest: "", visitor: V.member, awake: true }).outcome)).toBe("app:member");
    expect(kindOf(shown("shared", "signed-out", "asleep").outcome)).toBe("auth:sign-in");
  });

  it("an end user no longer shared with is refused; a private app takes no end users", () => {
    expect(accessCheck({ access: "shared" }, { ...V["end-user"], stillShared: false })).toEqual({ decision: "deny" });
    expect(accessCheck({ access: "private" }, V["end-user"])).toEqual({ decision: "deny" });
  });

  it("asks a stranger to sign in on the path host, returning to where they were going", () => {
    const r = shown("private", "signed-out", "running", "path", "books/new");
    expect(r.address).toBe("https://endgame.example/northfield/community/club/reading-list/_endgame/auth/sign-in?returnTo=%2Fnorthfield%2Fcommunity%2Fclub%2Freading-list%2Fbooks%2Fnew");
    expect(r.outcome.kind === "auth" && r.outcome.config.returnTo).toBe("https://endgame.example/northfield/community/club/reading-list/books/new");
    expect(r.outcome.kind === "auth" && r.outcome.config.handoff).toBe(false);
  });

  it("on the organisation subdomain, signs in on the platform's host and hands back", () => {
    const r = shown("private", "signed-out", "running", "subdomain");
    expect(r.form).toBe("path");
    expect(r.address).toBe(
      "https://endgame.example/northfield/community/club/reading-list/_endgame/auth/sign-in?returnTo=https%3A%2F%2Fnorthfield.apps.example%2Fcommunity%2Fclub%2Freading-list%2F",
    );
    expect(r.outcome.kind === "auth" && r.outcome.config.handoff).toBe(true);
    // Already signed in there: straight back to the subdomain.
    const back = resolve({ app: APP, form: "path", rest: r.rest, visitor: V.member });
    expect(back.form).toBe("subdomain");
    expect(kindOf(back.outcome)).toBe("app:member");
  });

  it("serves the Edge's other answers", () => {
    expect(kindOf(shown("public", "signed-out", "running", "path", "_platform/hooks").outcome)).toBe("not-found");
    expect(kindOf(shown("public", "signed-out", "running", "path", "_endgame/auth/nope").outcome)).toBe("not-found");
    expect(kindOf(shown("public", "signed-out", "running", "path", "_endgame/auth/handoff?code=abc").outcome)).toBe("message");
    const out = decide({ app: APP, form: "path", rest: "_endgame/auth/sign-out?returnTo=https%3A%2F%2Fevil.example%2F", visitor: V.member });
    expect(out).toEqual({ kind: "sign-out", location: "https://endgame.example/northfield/community/club/reading-list/" });
  });

  it("gives every page the Edge's ways onward: the same address, the console, sign in as someone else", () => {
    const onPath = pageLinks({ app: APP, form: "path", rest: "books/new?x=1", visitor: V["member-without-access"] });
    expect(onPath).toEqual({
      here: "/northfield/community/club/reading-list/books/new?x=1",
      console: "",
      member: true,
      switchAccount: `/northfield/community/club/reading-list/_endgame/auth/sign-out?returnTo=${escapeDataString(
        `/northfield/community/club/reading-list/_endgame/auth/sign-in?returnTo=${escapeDataString("/northfield/community/club/reading-list/")}`,
      )}`,
      appId: "app-1",
    });
    // On the organisation subdomain the console is the platform's origin, and no console session is carried.
    const onHost = pageLinks({ app: APP, form: "subdomain", rest: "", visitor: V.member });
    expect(onHost.console).toBe("https://endgame.example");
    expect(onHost.member).toBe(false);
    expect(onHost.here).toBe("/community/club/reading-list/");
  });

  it("keeps returnTo inside the app's two addresses", () => {
    const a = addressesOf(APP);
    expect(inside(a, "path", "/northfield/community/club/reading-list/books")).toBe("https://endgame.example/northfield/community/club/reading-list/books");
    expect(inside(a, "path", "/elsewhere")).toBeNull();
    expect(inside(a, "path", "//evil.example/")).toBeNull();
    expect(inside(a, "path", "https://user@northfield.apps.example/community/club/reading-list/")).toBeNull();
    expect(inside(a, "subdomain", "https://northfield.apps.example/community/club/reading-list/x")).toBe("https://northfield.apps.example/community/club/reading-list/x");
    expect(isInside("/a", "/a/../b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The reading list
// ---------------------------------------------------------------------------------------------

describe("the reading list", () => {
  const [amara, jonas] = CLUB_MEMBERS as [(typeof CLUB_MEMBERS)[number], (typeof CLUB_MEMBERS)[number]];

  it("is seeded with books from three club members", () => {
    const books = newReadingList().list();
    expect(books.length).toBeGreaterThanOrEqual(6);
    expect(new Set(books.map((b) => b.addedBy.id)).size).toBe(3);
  });

  it("lets only the person who added a book change its status, and tells anyone else it does not exist", () => {
    const list = newReadingList();
    const book = must(list.list().find((b) => b.addedBy.id === amara.id));
    const refused = list.setStatus(book.id, "reading", jonas);
    const missing = list.setStatus("bk_9999", "reading", jonas);
    expect(refused).toEqual(missing);
    expect(refused.ok === false && refused.problem.status).toBe(404);
    expect(list.list().find((b) => b.id === book.id)?.status).toBe(book.status);
    expect(list.setStatus(book.id, "reading", null)).toMatchObject({ ok: false, problem: { status: 401 } });
    const done = list.setStatus(book.id, "reading", amara);
    expect(done.ok && done.value.status).toBe("reading");
  });

  it("adds a book as Want to read, by whoever is signed in, and refuses an incomplete one", () => {
    const list = newReadingList();
    const bad = list.add({ title: " ", author: "", note: "" }, jonas);
    expect(bad.ok === false && Object.keys(bad.problem.errors ?? {})).toEqual(["Title", "Author"]);
    const added = list.add({ title: "Kindred", author: "Octavia E. Butler", note: "" }, jonas);
    expect(added.ok && added.value).toMatchObject({ status: "want", addedBy: jonas });
    expect(list.add({ title: "Kindred", author: "Octavia E. Butler", note: "" }, null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------

function context(over: Omit<Partial<HostedContext>, "app"> & { app?: Partial<HostedApp> }): HostedContext {
  const { app, ...rest } = over;
  return {
    app: { ...APP, ...app },
    form: "path",
    rest: "",
    visitor: V["signed-out"],
    passkey: vi.fn(async () => true),
    checkInvitation: vi.fn(() => null),
    onVisitorChange: vi.fn(),
    navigate: vi.fn(),
    exit: vi.fn(),
    ...rest,
  };
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const edgeDoc = () => must((screen.getByTestId("edge-page") as HTMLIFrameElement).contentDocument);

describe("HostedAppView", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the app with the person signed in, and the address they used", () => {
    render(<HostedAppView ctx={context({ visitor: V.member, form: "subdomain" })} />);
    expect(screen.getByTestId("hosted-address").textContent).toBe("https://northfield.apps.example/community/club/reading-list/");
    expect(screen.getByTestId("signed-in-as").textContent).toBe("Amara Okafor");
    expect(screen.getAllByTestId("book-item").length).toBeGreaterThanOrEqual(6);
  });

  it("refuses a status change on someone else's book as not found", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-view-refusal" }, visitor: V.member })} />);
    const theirs = must(readingListFor("app-view-refusal").list().find((b) => b.addedBy.id !== V.member.email));
    const card = must(screen.getAllByTestId("book-item").find((el) => el.getAttribute("data-id") === theirs.id));
    fireEvent.change(must(card.querySelector("select")), { target: { value: "finished" } });
    expect(card.textContent).toContain("The status was not changed");
    expect(card.textContent).toContain("There is no such book.");
  });

  it("signs a member in with a passkey and returns them to the app", async () => {
    const ctx = context({});
    render(<HostedAppView ctx={ctx} />);
    expect(edgeDoc().getElementById("title")?.textContent).toBe("Sign in to Club Reading List");
    must(edgeDoc().getElementById("member-passkey")).click();
    await waitFor(() => expect(ctx.onVisitorChange).toHaveBeenCalledWith({ kind: "member", displayName: null, email: null }));
    expect(ctx.passkey).toHaveBeenCalledWith({ action: "sign-in", site: "endgame.example", account: null });
    expect(ctx.navigate).toHaveBeenCalledWith("");
  });

  it("shows the prompt-closed message when the passkey is not approved", async () => {
    const ctx = context({ passkey: vi.fn(async () => false) });
    render(<HostedAppView ctx={ctx} />);
    must(edgeDoc().getElementById("member-passkey")).click();
    await waitFor(() => expect(edgeDoc().getElementById("error")?.hidden).toBe(false));
    expect(edgeDoc().getElementById("error")?.textContent).toBe("The passkey prompt was closed or timed out. Nothing was changed.");
    expect(ctx.onVisitorChange).not.toHaveBeenCalled();
  });

  it("refuses a wrong invitation code with the Edge's words, and registers with the right one", async () => {
    const refusal = authProblems.invitation;
    const ctx = context({
      app: { id: "app-view-invite", access: "shared" },
      visitor: V.invited,
      rest: "_endgame/auth/sign-up",
      checkInvitation: vi.fn((_email: string, code: string) => (code === "good-code" ? null : refusal)),
    });
    render(<HostedAppView ctx={ctx} />);
    const doc = edgeDoc();
    (doc.getElementById("email") as HTMLInputElement).value = "Lee@Readers.example";
    (doc.getElementById("code") as HTMLInputElement).value = "wrong";
    fireEvent.submit(must(doc.getElementById("sign-up")));
    await waitFor(() => expect(doc.getElementById("error")?.textContent).toBe(refusal));
    expect(ctx.passkey).not.toHaveBeenCalled();

    (doc.getElementById("code") as HTMLInputElement).value = "good-code";
    fireEvent.submit(must(doc.getElementById("sign-up")));
    await waitFor(() => expect(ctx.onVisitorChange).toHaveBeenCalledWith({ kind: "end-user", displayName: "lee", email: "lee@readers.example" }));
    expect(ctx.passkey).toHaveBeenCalledWith({ action: "register", site: "endgame.example", account: "lee@readers.example" });
  });

  it("serves the paused page in an isolated document", () => {
    render(<HostedAppView ctx={context({ visitor: V.member, app: { state: "paused" } })} />);
    expect(edgeDoc().querySelector("h1")?.textContent).toBe("This app is paused");
    expect(edgeDoc().querySelector("style")?.textContent).toContain("--measure: 34rem;");
    expect(edgeDoc().querySelector("style")?.textContent).toContain('@font-face { font-family: "Space Grotesk Variable"');
    expect(edgeDoc().querySelector("nav.actions a")?.textContent).toBe("Try again");
  });

  it("opens the console from an Edge page's link to it", async () => {
    const openConsole = vi.fn();
    render(<HostedAppView ctx={context({ visitor: V.member, app: { state: "not-published" }, openConsole })} />);
    must(edgeDoc().querySelector<HTMLAnchorElement>("p.note a")).click();
    await waitFor(() => expect(openConsole).toHaveBeenCalledWith("/apps/app-1"));
  });

  it("asks a slow app again by itself after its Retry-After", () => {
    vi.useFakeTimers();
    render(<HostedAppView ctx={context({ visitor: V.member, app: { state: "slow" } })} />);
    const first = edgeDoc();
    expect(first.querySelector("meta[http-equiv=refresh]")).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(edgeDoc().querySelector("h1")?.textContent).toBe("This app is taking longer than usual");
  });

  it("shows an address with no app as the Edge's no-app page, with the way to Endgame", async () => {
    const openConsole = vi.fn();
    render(<HostedUnknownApp appId="0b0e0000-0000-4000-8000-000000000000" openConsole={openConsole} />);
    expect(edgeDoc().querySelector("h1")?.textContent).toBe("There is no app at this address");
    must(edgeDoc().querySelector<HTMLAnchorElement>("nav.actions a")).click();
    await waitFor(() => expect(openConsole).toHaveBeenCalledWith("/"));
  });

  it("holds a sleeping app's visitor for wakeMs, then opens it", () => {
    vi.useFakeTimers();
    const onWake = vi.fn();
    render(<HostedAppView ctx={context({ app: { id: "app-view-wake", state: "asleep" }, visitor: V.member, wakeMs: 1500, onWake })} />);
    expect(screen.getByTestId("hosted-waiting")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1499));
    expect(screen.queryByTestId("reading-list-app")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("reading-list-app")).toBeTruthy();
    expect(onWake).toHaveBeenCalledOnce();
  });

  it("signs out and comes back to the app's home", () => {
    const ctx = context({ visitor: V["end-user"], app: { access: "shared" }, rest: "_endgame/auth/sign-out" });
    render(<HostedAppView ctx={ctx} />);
    expect(ctx.onVisitorChange).toHaveBeenCalledWith({ kind: "signed-out", displayName: null, email: null });
    expect(ctx.navigate).toHaveBeenCalledWith("");
  });

  it("leaves for the console", () => {
    const ctx = context({ visitor: V.member });
    render(<HostedAppView ctx={ctx} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Endgame" }));
    expect(ctx.exit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Every app has a page of its own
// ---------------------------------------------------------------------------------------------

describe("each hosted app's own page", () => {
  afterEach(cleanup);

  const at = (name: string, path: string): Pick<HostedApp, "name" | "addresses"> => ({ name, addresses: { path: `https://endgame.example/${path}/`, subdomain: `https://x.endgame.example/${path}/` } });

  it("knows every app the default world holds, and the reading list a build publishes", () => {
    const keys = defaultWorld().apps.map((a) => [a.name, pageKeyFor(at(a.name, a.path))] as const);
    expect(Object.fromEntries(keys)).toEqual({
      "Court booking": "court-booking",
      "Course Notes": "course-notes",
      "Tutor Match": "tutor-match",
      "Stock Counter": "stock-counter",
      "Shift Rota": "shift-rota",
      "Pre-orders": "pre-orders",
      "Homework Planner": "homework",
    });
    const story = must(STORIES["reading-list"]);
    expect(pageKeyFor(at(story.name, `northwind/${story.division.slug}/${story.project}/web`))).toBe("reading-list");
  });

  it("keeps a renamed app's page by its project, and gives an app it does not know a page of its own", () => {
    expect(pageKeyFor(at("Courts", "northwind/technologies/court-booking/web"))).toBe("court-booking");
    const typed = storyFor("A members' locker booking app for the club");
    expect(pageKeyFor(at(typed.name, `northwind/${typed.division.slug}/${typed.project}/web`))).toBe("generic");
  });

  const pages: [string, string, AppPageKey, string, string][] = [
    ["Court booking", "northwind/technologies/court-booking/web", "court-booking", "Book a court", "court-row"],
    ["Course Notes", "northwind/learning/course-notes/web", "course-notes", "This term's notes", "course-note"],
    ["Tutor Match", "northwind/learning/tutor-match/web", "tutor-match", "Find a tutor", "tutor-item"],
    ["Stock Counter", "northwind/operations/stock-counter/web", "stock-counter", "Today's count", "stock-item"],
    ["Shift Rota", "northwind/operations/shift-rota/web", "shift-rota", "This week's rota", "shift-row"],
    ["Pre-orders", "quayside/shop/orders/web", "pre-orders", "Orders for collection", "order-item"],
    ["Homework Planner", "northfield/tuition/homework/web", "homework", "Homework this week", "homework-item"],
    ["Harbour Tide Board", "northwind/learning/tide-board/web", "tide-board", "Tides at the harbour", "tide-day"],
  ];
  it.each(pages)("%s shows its own page, not the reading list", (name, path, key, heading, item) => {
    render(<HostedAppView ctx={context({ app: { id: `app-page-${key}`, name, addresses: at(name, path).addresses }, visitor: V.member })} />);
    expect(screen.getByTestId("hosted-app-page").getAttribute("data-page")).toBe(key);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(heading);
    expect(screen.getAllByTestId(item).length).toBeGreaterThan(0);
    expect(screen.getByTestId("signed-in-as").textContent).toBe("Amara Okafor");
    expect(screen.queryByText("The reading list")).toBeNull();
    expect(screen.queryByTestId("book-item")).toBeNull();
  });

  it("Court booking shows the member's own booking, books a free slot and cancels it", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-court", name: "Court booking", addresses: at("Court booking", "northwind/technologies/court-booking/web").addresses }, visitor: V.member })} />);
    expect(screen.getAllByTestId("court-row")).toHaveLength(8);
    expect(screen.getByTestId("own-booking").textContent).toContain("Court 3");
    expect(screen.getByTestId("own-bookings").textContent).toContain("280 playing minutes left");
    fireEvent.click(screen.getByRole("button", { name: "Book court 2 at 17:00" }));
    expect(screen.getAllByTestId("own-booking")).toHaveLength(2);
    expect(screen.getByTestId("own-bookings").textContent).toContain("240 playing minutes left");
    fireEvent.click(must(screen.getAllByRole("button", { name: "Cancel" })[0]));
    expect(screen.getAllByTestId("own-booking")).toHaveLength(1);
  });

  it("Court booking, public and signed out, shows the free slots and no booking", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-court-public", name: "Court booking", access: "public", addresses: at("Court booking", "northwind/technologies/court-booking/web").addresses } })} />);
    expect(screen.queryByTestId("own-bookings")).toBeNull();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Book court/ })).toBeNull();
  });

  it("Tutor Match narrows the tutors by subject", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-tutors", name: "Tutor Match", addresses: at("Tutor Match", "northwind/learning/tutor-match/web").addresses }, visitor: V.member })} />);
    const all = screen.getAllByTestId("tutor-item").length;
    fireEvent.change(screen.getByTestId("tutor-subject"), { target: { value: "Pastry" } });
    const pastry = screen.getAllByTestId("tutor-item");
    expect(pastry.length).toBeLessThan(all);
    for (const t of pastry) expect(t.textContent).toContain("Pastry");
  });

  it("an app it does not know gets a page made from its name", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-generic", name: "Locker Rota", addresses: at("Locker Rota", "northwind/studio/locker-rota/web").addresses }, visitor: V.member })} />);
    expect(screen.getByTestId("hosted-app-page").getAttribute("data-page")).toBe("generic");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Locker Rota");
    expect(screen.getAllByTestId("entry-item")[0]?.textContent).toContain("Locker Rota");
    expect(screen.queryByText("The reading list")).toBeNull();
  });

  it("an address inside an app it has no page for says so, and links home", () => {
    const ctx = context({ app: { id: "app-court-404", name: "Court booking", addresses: at("Court booking", "northwind/technologies/court-booking/web").addresses }, visitor: V.member, rest: "nowhere" });
    render(<HostedAppView ctx={ctx} />);
    fireEvent.click(screen.getByText("Back to the courts"));
    expect(ctx.navigate).toHaveBeenCalledWith("");
  });

  it("the reading list keeps its own page", () => {
    render(<HostedAppView ctx={context({ app: { id: "app-reading-kept" }, visitor: V.member })} />);
    expect(screen.getByTestId("reading-list-app")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The reading list");
    expect(screen.getByTestId("new-book").textContent).toBe("Add a book");
  });
});
