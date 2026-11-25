import { clock } from "./server/engine";
import { goto, reset, seekTo } from "./host";
import { clearSpotlight, moveCursor, pageRect, showSpotlight } from "./overlay";

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
  | { type: { into: Target | string; text: string } }
  | { select: { into: Target | string; value: string } }
  | { press: string | { key: string } }
  | { wait: number | Target }
  | { clock: ClockArgs };

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

function nameOf(el: Element): string {
  const labelled = el.getAttribute("aria-labelledby");
  const byId = labelled ? labelled.split(" ").map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ") : "";
  return norm(el.getAttribute("aria-label") || byId || (el as HTMLInputElement).value || el.textContent);
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

/** The element a target names, or null; `field` prefers form controls (for typing and selecting). */
export function find(target: Target | string, field = false): HTMLElement | null {
  for (const doc of documents()) {
    const el = findIn(doc, target, field);
    if (el) return el;
  }
  return null;
}

function findIn(document: Document, target: Target | string, field: boolean): HTMLElement | null {
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
  const starts = controls.find((c) => nameOf(c).startsWith(want));
  if (starts) return starts;
  const contains = controls.filter((c) => nameOf(c).includes(want)).sort((a, b) => nameOf(a).length - nameOf(b).length)[0];
  if (contains) return contains;
  // A region or list named for it (aria-label), such as "Parts of the plan".
  const named = [...document.querySelectorAll<HTMLElement>("[aria-label]")].find((el) => norm(el.getAttribute("aria-label")) === want && visible(el));
  if (named) return named;
  // Any visible element whose own text holds it: the smallest such element.
  const all = [...document.body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, p, span, li, dt, dd, th, td, div, strong, em, code, legend, figcaption")].filter((el) => norm(el.textContent).includes(want) && visible(el));
  all.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
  return all[0] ?? null;
}

async function waitFor(target: Target | string, field = false, ms = 6000): Promise<HTMLElement> {
  const until = performance.now() + ms;
  for (;;) {
    const el = find(target, field);
    if (el) return el;
    if (performance.now() > until) throw new Error(`Nothing on the screen matches ${JSON.stringify(target)}.`);
    await sleep(100);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Brings an element to the middle of the demo's own page — and of an Edge page's frame, for a
 * control inside one — and never further out. `scrollIntoView` would also scroll the academy's
 * page around the embedded demo (they share an origin), which moves the learner off the step.
 */
function reveal(el: Element, smooth: boolean) {
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  for (let box = el.parentElement; box && box !== el.ownerDocument.documentElement && box !== el.ownerDocument.body; box = box.parentElement) {
    const style = windowOf(box).getComputedStyle(box);
    if (box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(style.overflowY)) {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollBy({ top: r.top - b.top - (b.height - r.height) / 2, behavior });
    }
  }
  const win = windowOf(el);
  const r = el.getBoundingClientRect();
  win.scrollBy({ top: r.top - (win.innerHeight - r.height) / 2, behavior });
  const frame = win.frameElement;
  if (frame && win !== window) reveal(frame, smooth);
}

async function approach(el: HTMLElement) {
  reveal(el, !(instantNow || reduced()));
  if (instantNow) return;
  await sleep(250);
  const r = pageRect(el);
  await moveCursor(r.left + r.width / 2, r.top + r.height / 2);
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
    const el = await waitFor(action.click);
    await approach(el);
    focusUnlessEmbedded(el);
    el.click();
  } else if ("type" in action) {
    const el = await waitFor(action.type.into, true);
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
    const el = await waitFor(action.select.into, true);
    await approach(el);
    const want = norm(action.select.value);
    if (el.tagName === "SELECT") {
      const list = el as HTMLSelectElement;
      const option = [...list.options].find((o) => norm(o.textContent) === want || norm(o.value) === want) ?? [...list.options].find((o) => norm(o.textContent).startsWith(want));
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
  } else if ("wait" in action) {
    if (typeof action.wait === "number") await sleep(instantNow ? Math.min(action.wait, 50) : action.wait);
    else await waitFor(action.wait);
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
  goto(args: { route?: string; persona?: string; scenario?: string }) {
    clearSpotlight();
    goto(args);
  },
  async highlight(args: Target & { note?: string }) {
    if (!args.selector && !args.testId && !args.text && !args.label) {
      clearSpotlight();
      return;
    }
    // A spotlight is guidance, not an action: when nothing matches, the step still goes on, unlit.
    const el = await waitFor(args, false, 5000).catch(() => null);
    if (!el) {
      clearSpotlight();
      return false;
    }
    reveal(el, !reduced());
    showSpotlight(el, args.note ?? null);
    return true;
  },
  async act(actions: Action[], instant = false) {
    instantNow = instant;
    try {
      for (const a of actions) await perform(a);
    } finally {
      instantNow = false;
    }
  },
  clock: runClock,
  reset() {
    clearSpotlight();
    reset();
  },
};

declare global {
  interface Window {
    endgameDemo?: typeof endgameDemo;
  }
}

export function installBridge(embedded: boolean) {
  embeddedNow = embedded;
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
        endgameDemo.goto(args as { route?: string; persona?: string; scenario?: string });
        await sleep(50);
        post({ id: m.id, op: "goto" });
        break;
      case "highlight":
        post({ id: m.id, op: "highlight", args: { found: (await endgameDemo.highlight(args as Target & { note?: string })) !== false } });
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
  post({ id: "ready", op: "ready", args: { embed: embedded } });
}

export function announceRoute(route: string) {
  post({ id: `route-${route}`, op: "route", args: { route } });
}
