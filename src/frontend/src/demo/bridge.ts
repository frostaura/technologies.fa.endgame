import { clock } from "./server/engine";
import { answering, getSession, getWorld, goto, reset, seekTo } from "./host";
import { approveWhileWaiting, deviceAsking } from "./device";
import { currentAddress } from "@/lib/router";
import { breakpoints } from "@/lib/tokens";
import { currentViewport } from "@/lib/useViewport";
import { clearSpotlight, clipFor, coveringLayer, forgetSteps, moveCursor, pageRect, ringState, showSpotlight, subjectOf } from "./overlay";
import { snapScroll } from "./placement";

/**
 * The academy bridge (ARCH-009): a small postMessage protocol through which a parent frame drives
 * the demo — go somewhere as someone, spotlight a control, act a step out with visible motion, move
 * the clock, reset — and the same operations as `window.endgameDemo` for tests.
 *
 * Envelope `{ source: "endgame-academy" | "endgame-demo", id, op, args? }`; every reply echoes
 * the request's `id`. An `act` is acknowledged at once and finished by `step-done { id }`; a
 * failure is an `error { message }` echoing the id. The demo also emits `ready` and `route`.
 */

export const ACADEMY = "endgame-academy";
export const DEMO = "endgame-demo";

export interface Target {
  selector?: string;
  testId?: string;
  text?: string;
  label?: string;
}

export type Action =
  | { click: Target | string }
  | { hover: Target | string }
  | { type: { into: Target | string; text: string } }
  | { select: { into: Target | string; value: string } }
  | { press: string | { key: string } }
  | { wait: number | Target }
  | { clock: ClockArgs }
  /** Files added to the conversation's composer, as a person picking them would (ARCH-012): text, or bytes in base64. */
  | { attach: { files: { name: string; text?: string; base64?: string }[] } };

export interface ClockArgs {
  play?: boolean;
  pause?: boolean;
  /** A named moment (`build:published`) or script milliseconds to move forward by. */
  seek?: string | number;
  speed?: number;
}

type Envelope = { source: string; id: string; op: string; args?: Record<string, unknown> };

let instantNow = false;
/** Inside the academy's frame: the learner's keyboard (← → to walk the steps) stays with the academy. */
let embeddedNow = false;

/** A control the demo acts on takes the focus, as a click would — except embedded, where focus inside the frame would take the academy's keys. */
function focusUnlessEmbedded(el: HTMLElement) {
  if (!embeddedNow) el.focus({ preventScroll: true });
}

function post(message: Omit<Envelope, "source">) {
  const target = window.parent !== window ? window.parent : null;
  target?.postMessage({ source: DEMO, ...message }, "*");
  window.dispatchEvent(new CustomEvent("endgame-demo", { detail: { source: DEMO, ...message } }));
}

// ---------------------------------------------------------------------------------------------
// Finding what a step names: a CSS selector, a test id, or the visible text or accessible name
// ---------------------------------------------------------------------------------------------

const CONTROLS = "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=switch], summary, input[type=submit], input[type=button], label";

function visible(el: Element): boolean {
  if (el.closest("[data-demo-chrome]")) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The words as the page lays them out: a card's title and its line beneath are two runs of words, not one ("unusedcheapest"). */
function shown(el: Element): string {
  const known = laidOut?.get(el);
  if (known !== undefined) return known;
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  laidOut?.set(el, text);
  return text;
}

/** Laid-out words cost a layout read each; one search reads each element once. */
let laidOut: WeakMap<Element, string> | null = null;

/** The words with no spaces at all: a cheap first test before the laid-out words are read. */
const compact = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toLowerCase();

function nameOf(el: Element): string {
  const labelled = el.getAttribute("aria-labelledby");
  const byId = labelled ? labelled.split(" ").map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ") : "";
  return norm(el.getAttribute("aria-label") || byId || (el as HTMLInputElement).value || shown(el));
}

function controlFor(label: Element): HTMLElement | null {
  const forId = label.getAttribute("for");
  if (forId) return label.ownerDocument.getElementById(forId);
  return label.querySelector("input, textarea, select");
}

/**
 * The documents a step can point into: the console's page, then each of the Edge's own pages drawn
 * in its frame (a hosted app's sign-in and sign-up), which share this origin.
 */
function documents(): Document[] {
  const docs = [document];
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-testid="edge-page"]')) {
    const doc = frame.contentDocument;
    if (doc?.body) docs.push(doc);
  }
  return docs;
}

/** The element a target names, or null; `field` prefers form controls (for typing and selecting), `show` is a spotlight's search. */
export function find(target: Target | string, field = false, strict = false, show = false, exactOnly = false): HTMLElement | null {
  laidOut = new WeakMap();
  try {
    for (const doc of documents()) {
      const el = findIn(doc, target, field, strict, show, exactOnly);
      if (el) return el;
    }
    return null;
  } finally {
    laidOut = null;
  }
}

/** A control whose words undo or end something: a spotlight lands on one only when a step names it outright. */
const DESTRUCTIVE = /^(delete|remove|release|let .+ go|revoke|discard|erase|stop|cancel|forget|archive|leave|sign out)\b/;

function isDestructive(el: Element): boolean {
  return el.matches(CONTROLS) && DESTRUCTIVE.test(nameOf(el));
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The words appear whole in the text, not as part of a longer word ("Mon" is not in "month"). */
export function holdsWhole(text: string, want: string): boolean {
  if (!want) return false;
  // A boundary is asked for only where the words begin or end in a letter or digit ("last event #" ends in neither).
  const before = /^[\p{L}\p{N}]/u.test(want) ? "(^|[^\\p{L}\\p{N}])" : "";
  const after = /[\p{L}\p{N}]$/u.test(want) ? "($|[^\\p{L}\\p{N}])" : "";
  return new RegExp(`${before}${escapeRegExp(want)}${after}`, "u").test(text);
}

/** Headings and labels: what a page calls a thing, before a button that merely mentions it. */
const TITLES = "h1, h2, h3, h4, h5, h6, legend, label, dt, th, caption, figcaption, summary, [role=heading]";
const TEXTS = "h1, h2, h3, h4, h5, h6, p, span, li, dt, dd, th, td, div, strong, em, code, legend, figcaption, label, summary, caption";

const byLength = (name: (el: HTMLElement) => string) => (a: HTMLElement, b: HTMLElement) => Number(isDestructive(a)) - Number(isDestructive(b)) || name(a).length - name(b).length;

/** `strict`: only a control or field that the words name — never a region or a run of text that merely holds them. */
/** `exactOnly`: only what the words name outright — a control, field, heading or run of words that is exactly them. */
function findIn(document: Document, target: Target | string, field: boolean, strict = false, show = false, exactOnly = false): HTMLElement | null {
  const t: Target = typeof target === "string" ? { text: target } : target;
  if (t.selector) return [...document.querySelectorAll<HTMLElement>(t.selector)].find(visible) ?? null;
  if (t.testId) return [...document.querySelectorAll<HTMLElement>(`[data-testid="${CSS.escape(t.testId)}"]`)].find(visible) ?? null;
  const want = norm(t.text ?? t.label);
  if (!want) return null;
  if (field) {
    const fields = [...document.querySelectorAll<HTMLElement>("input, textarea, select")].filter(visible);
    for (const label of [...document.querySelectorAll("label")].filter(visible)) {
      if (norm(label.textContent) === want || norm(label.textContent).startsWith(want)) {
        const c = controlFor(label);
        if (c) return c;
      }
    }
    const byAttr = fields.find((f) => norm(f.getAttribute("aria-label")) === want || norm(f.getAttribute("placeholder")) === want || norm(f.getAttribute("name")) === want);
    if (byAttr) return byAttr;
    const near = fields.find((f) => norm(f.getAttribute("placeholder")).includes(want) || norm(f.getAttribute("aria-label")).includes(want));
    if (near) return near;
  }
  const controls = [...document.querySelectorAll<HTMLElement>(CONTROLS)].filter(visible);
  const exact = controls.find((c) => nameOf(c) === want);
  if (exact) return exact.tagName === "LABEL" && field ? (controlFor(exact) ?? exact) : exact;
  // A control that shows the words as its own heading or label (a card named by its title).
  const titled = controls.find((c) => [...c.querySelectorAll("h1, h2, h3, h4, strong, span, p")].some((d) => norm(d.textContent) === want));
  if (titled) return titled;
  const bare = compact(want);
  // Only an element whose raw text holds the words is worth reading laid out.
  const textOf = (el: HTMLElement) => (compact(el.textContent).includes(bare) ? norm(shown(el)) : "");
  const smallest = (els: HTMLElement[]) => els.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? null;
  if (show) {
    // A spotlight shows a thing by what the page calls it: its heading or label, then any words that are exactly it.
    const heading = [...document.querySelectorAll<HTMLElement>(TITLES)].find((el) => textOf(el) === want && visible(el));
    if (heading) return heading;
    const words = smallest([...document.body.querySelectorAll<HTMLElement>(TEXTS)].filter((el) => textOf(el) === want && visible(el)));
    if (words) return words;
  }
  if (exactOnly) return null;
  // Controls the words start, or are part of — whole words first, and a control that deletes or ends something last.
  const starts = controls.filter((c) => nameOf(c).startsWith(want) && holdsWhole(nameOf(c), want)).sort(byLength(nameOf))[0];
  if (starts) return starts;
  const contains = controls.filter((c) => holdsWhole(nameOf(c), want)).sort(byLength(nameOf));
  if (contains[0] && !(show && isDestructive(contains[0]))) return contains[0];
  if (!show) {
    const prefix = controls.filter((c) => nameOf(c).startsWith(want)).sort(byLength(nameOf))[0];
    if (prefix) return prefix;
    const inside = controls.filter((c) => nameOf(c).includes(want)).sort(byLength(nameOf))[0];
    if (inside) return inside;
  }
  if (strict) return null;
  // A region or list named for it (aria-label), such as "Parts of the plan".
  const named = [...document.querySelectorAll<HTMLElement>("[aria-label]")].find((el) => norm(el.getAttribute("aria-label")) === want && visible(el));
  if (named) return named;
  // Any visible element whose own text holds it: the smallest such element, whole words first.
  const all = [...document.body.querySelectorAll<HTMLElement>(TEXTS)].filter((el) => !el.closest("[data-demo-chrome]") && textOf(el).includes(want) && visible(el));
  const whole = smallest(all.filter((el) => holdsWhole(textOf(el), want)));
  if (whole) return whole;
  if (contains[0]) return contains[0];
  return smallest(all);
}

/**
 * What a spotlight would land on, and whether that is what its words name: for the build-time check
 * of the academy's scripts, which refuses a spotlight that took a control deleting or ending
 * something the step did not name, or that matched only part of a word.
 */
export function inspect(target: Target | string): { found: boolean; tag?: string; text?: string; exact?: boolean; wholeWords?: boolean; destructive?: boolean } {
  const t: Target = typeof target === "string" ? { text: target } : target;
  const el = find(t, false, false, true);
  if (!el) return { found: false };
  const want = norm(t.text ?? t.label);
  const names = [nameOf(el), norm(shown(el)), norm(el.getAttribute("aria-label"))];
  return {
    found: true,
    tag: el.tagName.toLowerCase(),
    text: names[0]?.slice(0, 120),
    exact: !want || names.includes(want),
    wholeWords: !want || names.some((n) => holdsWhole(n, want)),
    destructive: isDestructive(el),
  };
}

/**
 * On a phone, a section can be folded away (`[data-fold-body]`) or the conversation can sit in its
 * closed sheet (`[data-talk-target]`): what a step names may be in the page but not on screen. Each
 * such place that holds it is asked to show itself (`endgame:reveal`, which the fold and the shell
 * listen for), so a lesson written at desktop size plays the same in a phone-width frame.
 */
export function revealHidden(target: Target | string): boolean {
  const t: Target = typeof target === "string" ? { text: target } : target;
  const want = compact(t.text ?? t.label);
  let asked = false;
  for (const box of document.querySelectorAll<HTMLElement>("[data-fold-body], [data-talk-target]")) {
    // Shown already (a `display: contents` box has no box of its own; its parent says whether it shows).
    if (box.getClientRects().length > 0 || (box.parentElement?.getClientRects().length ?? 0) > 0 && getComputedStyle(box).display !== "none" && !box.closest("[hidden]")) continue;
    // A field is named by its placeholder or label, which are not among its words.
    const named = () => [...box.querySelectorAll("[placeholder], [aria-label]")].some((el) => compact(el.getAttribute("placeholder")).includes(want) || compact(el.getAttribute("aria-label")).includes(want));
    const holds = t.selector ? !!box.querySelector(t.selector) : t.testId ? !!box.querySelector(`[data-testid="${CSS.escape(t.testId)}"]`) : !!want && (compact(box.textContent).includes(want) || named());
    if (!holds) continue;
    box.dispatchEvent(new CustomEvent("endgame:reveal", { bubbles: true }));
    asked = true;
  }
  return asked;
}

/**
 * `sheetsAfter`: from how many milliseconds a phone's sheets are looked in (`lookInSheets`) — never
 * (Infinity) for a step waiting for something to appear, which must not open a sheet over it.
 */
async function waitFor(target: Target | string, field = false, ms = 6000, preferControls = false, show = false, sheetsAfter = Infinity): Promise<HTMLElement> {
  const until = performance.now() + ms;
  // What a step acts on is a control: while one may still be loading, plain text that happens to
  // hold the same words ("…replace it.", "Ask it again…") is not taken for it.
  const patient = preferControls ? performance.now() + Math.min(ms, 4000) : 0;
  // What the words name outright, shown, comes first; then a folded section or a closed sheet that
  // holds it is asked to open (on a phone, "Hiring" is a link inside a folded list whose own row
  // merely mentions it); only then a control or text that holds the words is taken.
  const unfoldUntil = performance.now() + Math.min(ms, 2500);
  // On a phone, what a desktop shows in its header or in full on home (the mode, your account, a
  // page's link, what needs you) is in a sheet: once the screen has had a moment, each is looked in.
  const moreFrom = performance.now() + sheetsAfter;
  let triedMore = false;
  for (;;) {
    const exact = find(target, field, true, show, true);
    if (exact) return exact;
    if (performance.now() < unfoldUntil && revealHidden(target)) {
      await sleep(80);
      continue;
    }
    if (!triedMore && performance.now() > moreFrom) {
      triedMore = true;
      const inMore = await lookInSheets(target, field, show);
      if (inMore) return inMore;
    }
    const el = find(target, field, performance.now() < patient, show);
    if (el) return el;
    const asked = revealHidden(target);
    if (performance.now() > until) throw new Error(`Nothing on the screen matches ${JSON.stringify(target)}.`);
    await sleep(asked ? 60 : 100);
  }
}

/**
 * The sheets a phone keeps a desktop's page in: the bottom bar's More (every page, your account,
 * the mode) and home's "things need you" summary (the list a desktop shows in full).
 */
const SHEETS = ["[data-needs-summary]", "[data-bottom-nav] [aria-label^='More']"];

/** The sheet `lookInSheets` opened to find what a step acts on: closed again once the act is done, as a person would. */
let openedSheet: HTMLElement | null = null;

/** Closes the sheet opened to act in, if what was pressed left it open (the mode switch does). */
async function closeOpenedSheet() {
  const sheet = openedSheet;
  openedSheet = null;
  if (!sheet || !sheet.isConnected || !visible(sheet)) return;
  sheet.querySelector<HTMLElement>("[aria-label^='Close']")?.click();
  await sleep(instantNow ? 60 : 250);
}

/** Opens each sheet in turn and finds what the words name outright in it; closes it again when it holds nothing. */
async function lookInSheets(target: Target | string, field: boolean, show: boolean): Promise<HTMLElement | null> {
  const open = () => [...document.querySelectorAll<HTMLElement>("[role=dialog]")].filter(visible);
  // A prompt that asks something (the device, a confirmation) is never closed to look elsewhere; a
  // sheet (the conversation, More) is, as a person closes it to reach the page.
  for (const sheet of open()) {
    const close = sheet.querySelector<HTMLElement>("[aria-label^='Close: ']");
    if (!close) return null;
    close.click();
    await sleep(instantNow ? 120 : 300);
  }
  for (const selector of SHEETS) {
    const opener = [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
    if (!opener) continue;
    opener.click();
    await sleep(instantNow ? 120 : 350);
    // What the words name outright; else, inside the sheet just opened only, a control they begin or hold.
    const sheet = open().at(-1);
    const near = find(target, field, true, show, false);
    const found = find(target, field, true, show, true) ?? (sheet && near && sheet.contains(near) ? near : null);
    if (found) {
      openedSheet = found.closest<HTMLElement>("[role=dialog]");
      return found;
    }
    // Closed by its own Close, and only it.
    for (const sheet of open()) sheet.querySelector<HTMLElement>("[aria-label^='Close']")?.click();
    await sleep(instantNow ? 60 : 200);
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A sticky bar at the top of a scroll area (a pane's "Talking to …" header): the area's view starts under it. */
function stickyTop(box: Element, el: Element): number {
  let top = box.getBoundingClientRect().top + (box as HTMLElement).clientTop;
  const start = top;
  const near = [...box.children].flatMap((c) => [c, ...c.children]);
  for (const c of near) {
    if (c.contains(el)) continue;
    const s = windowOf(c).getComputedStyle(c);
    if (s.position !== "sticky") continue;
    const r = c.getBoundingClientRect();
    if (r.height > 0 && r.top <= start + 2) top = Math.max(top, r.bottom);
  }
  return top;
}

/** Fixed or sticky bars over the console's page (its header, a phone's bottom bar) that a step's subject must clear. */
function pageBars(el: Element): { top: number; bottom: number } {
  const win = windowOf(el);
  if (win !== window) return { top: 0, bottom: win.innerHeight };
  const clip = clipFor(document.body);
  return { top: clip.top, bottom: clip.bottom };
}

/**
 * Brings what a step shows into view in the demo's own page — and in an Edge page's frame, for a
 * control inside one — and never further out. `scrollIntoView` would also scroll the academy's page
 * around the embedded demo (they share an origin), which moves the learner off the step. A subject
 * already in view, with room around it, stays where it is; otherwise it is snapped so its top sits
 * a margin under the top of the view it scrolls in (under a sticky header), so a card is read from
 * its beginning and its actions at its foot show with it; one taller than the view keeps the
 * element it holds in view (`snapScroll`). `subject` is what is shown (the card around a heading);
 * `el` is what the step named.
 */
function reveal(el: Element, smooth: boolean, subject: Element = el) {
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  const box4 = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  /** How far the scroll areas already asked have moved the element, for the ones outside them. */
  let moved = 0;
  for (let box = el.parentElement; box && box !== el.ownerDocument.documentElement && box !== el.ownerDocument.body; box = box.parentElement) {
    const style = windowOf(box).getComputedStyle(box);
    if (box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(style.overflowY)) {
      const shown = box.contains(subject) ? subject : el;
      const b = box.getBoundingClientRect();
      const view = { left: b.left, right: b.right, top: stickyTop(box, el), bottom: b.top + box.clientTop + box.clientHeight };
      const s = box4(shown.getBoundingClientRect());
      const n = box4(el.getBoundingClientRect());
      const by = Math.max(-box.scrollTop, Math.min(snapScroll(s, n, view, 16), box.scrollHeight - box.clientHeight - box.scrollTop));
      if (by) {
        box.scrollBy({ top: by, behavior });
        moved += by;
      }
    }
    // A drawing wider than its frame (the organisation graph) is moved sideways to it, inside the frame only.
    if (box.scrollWidth > box.clientWidth && /(auto|scroll)/.test(style.overflowX)) {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.left < b.left || r.right > b.right) box.scrollBy({ left: r.left - b.left - Math.max(0, (b.width - r.width) / 2), behavior });
    }
  }
  const win = windowOf(el);
  const bars = pageBars(el);
  const shift = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top - moved, bottom: r.bottom - moved });
  const s = shift(subject.getBoundingClientRect());
  const n = shift(el.getBoundingClientRect());
  const by = snapScroll(s, n, { left: 0, right: win.innerWidth, top: bars.top, bottom: bars.bottom });
  if (by) win.scrollBy({ top: by, behavior });
  const frame = win.frameElement;
  if (frame && win !== window) reveal(frame, smooth);
}

/** Resolves once the page and every scroll area have stopped moving (a smooth scroll ends), at most `ms`. */
async function scrolledToRest(el: Element, ms = 1500) {
  const until = performance.now() + ms;
  let last = "";
  let still = 0;
  while (performance.now() < until) {
    const r = el.getBoundingClientRect();
    const now = `${Math.round(r.top)},${Math.round(r.left)},${window.scrollY}`;
    still = now === last ? still + 1 : 0;
    last = now;
    if (still >= 3) return;
    await new Promise((res) => requestAnimationFrame(res));
  }
}

/** A region still loading: a skeleton's shimmer, or a region marked busy. */
const LOADING = '.animate-shimmer, [aria-busy="true"]';

/** `subject`: what a step shows; a busy region that is it, or holds it (a wake in progress), is the lesson, not loading. */
function loading(subject: Element | null = null): boolean {
  return documents().some((doc) => [...doc.querySelectorAll(LOADING)].some((el) => !el.closest("[data-demo-chrome]") && visible(el) && !(subject && (el === subject || el.contains(subject)))));
}

/** Waits, up to `ms`, until nothing on the screen is still loading, so a step is shown as it settles, never half-drawn. */
export async function settled(ms = 4000, subject: () => Element | null = () => null) {
  const until = performance.now() + ms;
  let quietSince = 0;
  let current: Element | null = null;
  let subjectAt = -Infinity;
  for (;;) {
    const now = performance.now();
    if (now - subjectAt > 500) {
      current = subject();
      subjectAt = now;
    }
    if (loading(current)) quietSince = 0;
    else if (!quietSince) quietSince = now;
    else if (now - quietSince >= 150) return;
    if (now > until) return;
    await sleep(50);
  }
}

/** Waits, up to `ms`, until no device sheet is open and the control plane has answered everything, for a moment. */
async function quiet(ms = 6000) {
  const until = performance.now() + ms;
  let since = 0;
  for (;;) {
    const now = performance.now();
    if (deviceAsking() || answering()) since = 0;
    else if (!since) since = now;
    else if (now - since >= 150) return;
    if (now > until) return;
    await sleep(25);
  }
}

/**
 * Where the demo is, in the terms a lesson teaches: the console's address, who is signed in, whether
 * the device is asking, and the page's heading. The script check compares it between a step played
 * after the one before it and the same step reached by catching up, as a link or a picture reaches it.
 */
export function state() {
  const world = getWorld();
  const sheet = document.querySelector("[data-demo-device] h2")?.textContent ?? null;
  const heading = [...document.querySelectorAll<HTMLElement>("h1")].find((el) => visible(el))?.innerText?.trim() ?? null;
  return { route: currentAddress(), persona: getSession().persona, signedIn: world.sessionUserId, device: sheet, heading, answering: answering() };
}

async function approach(el: HTMLElement) {
  reveal(el, !(instantNow || reduced()));
  if (instantNow) return;
  await sleep(250);
  const r = pageRect(el);
  // The pointer's tip rests just inside the control's lower edge, its body below it: never over the label it presses.
  await moveCursor(r.left + Math.min(r.width / 2, 24), r.bottom - Math.min(6, r.height / 4));
}

/** The window an element lives in: the console's, or an Edge page's frame. */
const windowOf = (el: Element) => (el.ownerDocument.defaultView ?? window) as typeof window;

function setValue(el: HTMLElement, value: string) {
  const win = windowOf(el);
  const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  el.dispatchEvent(new win.Event("change", { bubbles: true }));
}

/** What has the keyboard: inside an Edge page's frame when the frame has it. */
function focused(): HTMLElement {
  let el = (document.activeElement as HTMLElement | null) ?? document.body;
  while (el.tagName === "IFRAME") {
    const inner = (el as HTMLIFrameElement).contentDocument?.activeElement as HTMLElement | null | undefined;
    if (!inner) break;
    el = inner;
  }
  return el;
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Tab, as the browser does it: the next control in the page's order takes the keyboard. */
function tabFrom(from: HTMLElement) {
  const doc = from.ownerDocument;
  const all = [...doc.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[data-demo-chrome]"));
  const at = all.indexOf(from);
  all[at + 1]?.focus();
}

async function perform(action: Action) {
  if ("click" in action) {
    const el = await waitFor(action.click, false, 6000, true, false, 1200);
    await approach(el);
    focusUnlessEmbedded(el);
    el.click();
    await sleep(instantNow ? 30 : 200);
    await closeOpenedSheet();
  } else if ("hover" in action) {
    // The pointer comes to rest on it, as a mouse would: what the page shows on hover (a line's name) appears.
    const el = await waitFor(action.hover, false, 6000, false, false, 1200);
    await approach(el);
    const win = windowOf(el);
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new win.PointerEvent("pointerover", { ...at, pointerType: "mouse" }));
    el.dispatchEvent(new win.PointerEvent("pointerenter", { ...at, bubbles: false, pointerType: "mouse" }));
    el.dispatchEvent(new win.MouseEvent("mouseover", at));
    el.dispatchEvent(new win.MouseEvent("mouseenter", { ...at, bubbles: false }));
  } else if ("type" in action) {
    const el = await waitFor(action.type.into, true, 6000, true, false, 1200);
    await approach(el);
    focusUnlessEmbedded(el);
    if (instantNow || reduced()) setValue(el, action.type.text);
    else {
      let typed = "";
      for (const ch of action.type.text) {
        typed += ch;
        setValue(el, typed);
        await sleep(28);
      }
    }
  } else if ("select" in action) {
    const el = await waitFor(action.select.into, true, 6000, true, false, 1200);
    await approach(el);
    const want = norm(action.select.value);
    if (el.tagName === "SELECT") {
      const list = el as HTMLSelectElement;
      const pick = () => [...list.options].find((o) => norm(o.textContent) === want || norm(o.value) === want) ?? [...list.options].find((o) => norm(o.textContent).startsWith(want));
      // A list filled from the control plane (the levels of the tree) may still be filling in.
      let option = pick();
      for (const until = performance.now() + 3000; !option && performance.now() < until; option = pick()) await sleep(100);
      if (!option) throw new Error(`The list ${JSON.stringify(action.select.into)} has no ${action.select.value}.`);
      setValue(el, option.value);
    } else {
      const choice = await waitFor({ text: action.select.value });
      choice.click();
    }
  } else if ("press" in action) {
    const key = typeof action.press === "string" ? action.press : action.press.key;
    const el = focused();
    const win = windowOf(el);
    el.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
    if (key === "Enter") {
      const form = el.closest("form");
      if (el.tagName === "BUTTON" || el.tagName === "A") el.click();
      else if (form) form.requestSubmit();
    } else if (key === "Tab") tabFrom(el);
    el.dispatchEvent(new win.KeyboardEvent("keyup", { key, bubbles: true }));
  } else if ("attach" in action) {
    const pick = (): HTMLInputElement | null => {
      for (const doc of documents()) {
        const inputs = [...doc.querySelectorAll<HTMLInputElement>("section[aria-label='Conversation'] input[type=file]")];
        const shown = inputs.filter((i) => visible(i.closest("section") as Element));
        const input = shown[shown.length - 1] ?? inputs[inputs.length - 1];
        if (input) return input;
      }
      return null;
    };
    const input = pick();
    if (!input) throw new Error("No conversation is open to attach files to.");
    const win = windowOf(input);
    const files = new win.DataTransfer();
    for (const f of action.attach.files) {
      const bytes = f.base64 !== undefined ? Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)) : new TextEncoder().encode(f.text ?? "");
      files.items.add(new win.File([bytes], f.name, { type: f.base64 !== undefined ? "application/octet-stream" : "text/plain" }));
    }
    input.files = files.files;
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    await sleep(instantNow || reduced() ? 0 : 300);
  } else if ("wait" in action) {
    // A step that waits is the person approving on their device, if it asks. A wait for a time is
    // also whatever the step started (a sign-in, a send) finishing, so played or caught up the step
    // ends at the same moment; a wait for something on screen ends when it shows, even a passing
    // state ("Working on it").
    approveWhileWaiting(true, instantNow || reduced() ? 0 : 400);
    try {
      if (typeof action.wait === "number") {
        await sleep(instantNow ? Math.min(action.wait, 50) : action.wait);
        await quiet();
      } else await waitFor(action.wait);
    } finally {
      approveWhileWaiting(false);
    }
  } else if ("clock" in action) {
    runClock(action.clock);
  }
  if (!instantNow) await sleep(220);
}

export function runClock(args: ClockArgs) {
  if (args.speed !== undefined && args.speed > 0) clock.speed = args.speed;
  if (args.pause) clock.playing = false;
  if (args.play) clock.playing = true;
  if (args.seek !== undefined) seekTo(args.seek);
}

// ---------------------------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------------------------

export const endgameDemo = {
  /** Resolves once the new screen has been drawn, so what a step then acts on is that screen's. */
  async goto(args: { route?: string; persona?: string; scenario?: string }) {
    clearSpotlight();
    forgetSteps();
    openedSheet = null;
    keepFocusOut(performance.now() + 2000);
    goto(args);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  /**
   * Rings what a step is about. `marker` is the step's number, drawn on the ring; `region` rings a
   * region as it is (a step showing a state, not a control); `none` says, with its reason, that the
   * step has nothing to ring, and clears the ring. Any `note` is the academy's to show under its
   * frame: nothing is written over the console.
   */
  async highlight(args: Target & { note?: string; marker?: number; region?: boolean; none?: string }) {
    // The ring of the step before names what that step showed; it goes while this one is found.
    clearSpotlight();
    openedSheet = null;
    if (args.none) return true;
    const target: Target = { selector: args.selector, testId: args.testId, text: args.text, label: args.label };
    if (!target.selector && !target.testId && !target.text && !target.label) return;
    // A spotlight is guidance, not an action: when nothing matches, the step still goes on, unlit.
    await settled(4000, () => find(target, false, false, true));
    // A spotlight looks in a phone's sheets only once what it names has had time to appear on the page.
    const el = await waitFor(target, false, 5000, false, true, 2500).catch(() => null);
    if (!el) {
      clearSpotlight();
      return false;
    }
    // On a phone, a page's conversation or More is a sheet over it: a step about the page closes the
    // sheet first (its own "Close: …"), as the laptop's docked pane never hides the page. A prompt
    // that asks something (the device, a confirmation) is never closed for it.
    const layer = coveringLayer(el);
    const close = layer?.querySelector<HTMLElement>("[aria-label^='Close: ']");
    if (close) {
      close.click();
      await sleep(300);
    }
    const subject = subjectOf(el, !!args.region);
    reveal(el, !reduced(), subject);
    showSpotlight(el, { marker: typeof args.marker === "number" ? args.marker : null, region: !!args.region, keep: () => reveal(el, false, subject) }, () => find(target, false, false, true));
    await scrolledToRest(el);
    return true;
  },
  async act(actions: Action[], instant = false) {
    // A step's actions change the screen: the step before's ring and note never stand over the new state.
    clearSpotlight();
    instantNow = instant;
    keepFocusOut(Infinity);
    try {
      for (const a of actions) await perform(a);
    } finally {
      instantNow = false;
      // A screen that focuses a field as it opens (a form shown by the click) does so just after.
      keepFocusOut(performance.now() + 1500);
    }
  },
  clock: runClock,
  /**
   * The console's layout in this frame: which one it draws (`phone`, `tablet`, `desktop` — decided by
   * the frame's own width, never by a parameter), the widths it changes at, and the room its own
   * bars take at the top and the foot, which an overlay outside the frame can keep clear of.
   */
  layout() {
    const bar = document.querySelector<HTMLElement>("[data-bottom-nav]");
    const header = document.querySelector<HTMLElement>("header");
    return {
      viewport: currentViewport(),
      width: window.innerWidth,
      height: window.innerHeight,
      breakpoints: { ...breakpoints },
      top: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
      bottom: bar ? Math.round(window.innerHeight - bar.getBoundingClientRect().top) : 0,
    };
  },
  inspect,
  state,
  /** What the ring shows now (drawn, its box, the part in view, the area it is cut to): for the academy's checks. */
  ring: ringState,
  /** Resolves once nothing on the screen is still loading (at most `ms`). */
  settled,
  reset() {
    clearSpotlight();
    forgetSteps();
    reset();
  },
};

declare global {
  interface Window {
    endgameDemo?: typeof endgameDemo;
  }
}

/**
 * Embedded, while the demo plays a step (and just after), the console does not take focus by
 * itself: focus inside the frame would take the academy's arrow keys, and scroll its page.
 */
let focusQuietUntil = 0;
function keepFocusOut(until: number) {
  focusQuietUntil = until;
}

export function installBridge(embedded: boolean) {
  embeddedNow = embedded;
  if (embedded) {
    // In the academy's rounded frame, the corner where two scrollbars meet takes the page's own
    // ground rather than the browser's black square.
    const corner = document.createElement("style");
    corner.textContent = "::-webkit-scrollbar-corner { background: transparent; }";
    document.head.append(corner);
    // A screen that focuses a field by itself (a form or a confirmation the step opened) would pull
    // focus — and the browser's scroll — out of the academy page and into the frame. While a step
    // plays, and just after, that focus is not taken.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      if (performance.now() < focusQuietUntil) return;
      focus.call(this, options);
    };
  }
  window.endgameDemo = endgameDemo;
  window.addEventListener("message", (e: MessageEvent) => {
    const m = e.data as Envelope | null;
    if (!m || typeof m !== "object" || m.source !== ACADEMY || typeof m.id !== "string" || typeof m.op !== "string") return;
    if (embedded && e.source !== window.parent) return;
    void handle(m);
  });
}

async function handle(m: Envelope) {
  const args = m.args ?? {};
  try {
    switch (m.op) {
      case "goto":
        await endgameDemo.goto(args as { route?: string; persona?: string; scenario?: string });
        await sleep(50);
        post({ id: m.id, op: "goto" });
        break;
      case "highlight":
        post({ id: m.id, op: "highlight", args: { found: (await endgameDemo.highlight(args as Target & { note?: string; marker?: number; region?: boolean; none?: string })) !== false } });
        break;
      case "act": {
        post({ id: m.id, op: "act" });
        const actions = Array.isArray(args.actions) ? (args.actions as Action[]) : [];
        await endgameDemo.act(actions, args.instant === true);
        post({ id: `done-${m.id}`, op: "step-done", args: { id: m.id } });
        break;
      }
      case "clock":
        runClock(args as ClockArgs);
        post({ id: m.id, op: "clock" });
        break;
      case "layout":
        post({ id: m.id, op: "layout", args: { ...endgameDemo.layout() } });
        break;
      case "reset":
        endgameDemo.reset();
        await sleep(50);
        post({ id: m.id, op: "reset" });
        break;
      default:
        post({ id: m.id, op: "error", args: { message: `Unknown op ${m.op}.` } });
    }
  } catch (e) {
    post({ id: m.id, op: "error", args: { message: e instanceof Error ? e.message : String(e) } });
  }
}

export function announceReady(embedded: boolean) {
  post({ id: "ready", op: "ready", args: { embed: embedded, viewport: currentViewport() } });
}

export function announceRoute(route: string) {
  post({ id: `route-${route}`, op: "route", args: { route } });
}
