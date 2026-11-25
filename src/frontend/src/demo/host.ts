import { api, installTransport } from "@/store/api";
import { makeStore, type AppStore } from "@/store";
import { navigate } from "@/lib/router";
import { createControlPlane } from "./server";
import { clock, seek, tick } from "./server/engine";
import { answerApproval } from "./server/routes/work";
import { WORLD_VERSION, type World } from "./server/world";
import { PERSONAS, buildWorld, resolveRoute, type Persona, type Scenario } from "./world/scenarios";
import "./world/scenarios.s2";
// Scenarios kept per flow file. Imported here, after scenarios.ts has run: they call its defineScenario.
import "./world/scenarios.s1";
import "./world/scenarios.s4";
import "./world/scenarios.s5";
import { installDevice } from "./device";

/**
 * The demo's host: it owns the world, plugs the fake control plane into the console's transport
 * seam, moves the clock, saves the world to sessionStorage while the page is open, and tells the
 * console's cache what changed so open screens refresh as they would on the live stack.
 */

const KEY = "endgame-demo:world";
export const DEMO_BASE = "https://endgame.demo.invalid/api";

interface Saved {
  version: number;
  scenario: string;
  persona: string;
  world: World;
}

export interface Session {
  scenario: string;
  persona: string;
  scenarios: Scenario[];
  personaInfo: Persona;
}

let world: World;
let session: Session;
let store: AppStore;
const listeners = new Set<() => void>();

export function getWorld(): World {
  return world;
}

export function getSession(): Session {
  return session;
}

export function getStore(): AppStore {
  return store;
}

export function onHostChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function save() {
  try {
    const saved: Saved = { version: WORLD_VERSION, scenario: session.scenario, persona: session.persona, world: { ...world, changed: [] } };
    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // A private window or blocked storage: the demo still works, it just forgets on reload.
  }
}

function load(scenario: string, persona: string): World | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    if (saved.version !== WORLD_VERSION || saved.scenario !== scenario || saved.persona !== persona) return null;
    return { ...saved.world, changed: [] };
  } catch {
    return null;
  }
}

let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Invalidate the console's cache for what changed, a little later and once, as polling would. */
function changed(tags: string[]) {
  for (const t of tags) pending.add(t);
  if (tags.length) save();
  if (flushTimer || pending.size === 0) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const list = [...pending];
    pending = new Set();
    store.dispatch(api.util.invalidateTags(list as never));
    for (const l of listeners) l();
  }, 120);
}

/** Start a world for a scenario and persona; `fresh` ignores a saved one. */
function begin(scenario: string, persona: string, fresh: boolean) {
  const built = buildWorld(scenario, persona);
  const restored = fresh ? null : load(scenario, built.persona.name);
  world = restored ?? built.world;
  session = { scenario, persona: built.persona.name, scenarios: built.scenarios, personaInfo: built.persona };
  if (!restored) {
    const target = [...built.scenarios].reverse().find((s) => s.seek !== undefined)?.seek;
    if (target !== undefined) seekTo(target);
  }
  save();
}

export function seekTo(target: string | number) {
  if (typeof target === "number") {
    // Script milliseconds: every live run moves forward by that much, in steps so approvals stop them.
    const was = { ...clock };
    clock.playing = true;
    clock.speed = 1;
    for (let left = target; left > 0; left -= 250) tick(world, Math.min(250, left));
    Object.assign(clock, was);
  } else {
    seek(world, target, (w, id) => answerApproval(w, id, "approve", "demo"));
  }
  changed(["Tree", "Run", "Idea", "App", "Credits", "Notifications", "Employee", "Tasks", "Versions"]);
}

/** The route a scenario opens on, unless the address already names one. */
export function startRoute(): string {
  const route = [...session.scenarios].reverse().find((s) => s.route)?.route ?? "/";
  return resolveRoute(route, session.scenarios);
}

export function resolve(route: string): string {
  return resolveRoute(route, session.scenarios);
}

export function startHost(params: URLSearchParams): AppStore {
  const scenario = params.get("scenario") ?? "default";
  const persona = params.get("persona") ?? "";
  begin(scenario, persona, false);
  const cp = createControlPlane({ base: DEMO_BASE, world: () => world, afterChange: changed, latency: (method) => (method === "GET" ? 90 + Math.floor(Math.random() * 120) : 650 + Math.floor(Math.random() * 350)) });
  installTransport({ base: cp.base, fetch: cp.fetch });
  Object.defineProperty(window, "EventSource", { value: cp.EventSource, configurable: true, writable: true });
  installDevice(() => world.users.filter((u) => u.passkeys > 0 && world.device.includes(u.id)).map((u) => ({ id: u.id, label: `${u.displayName} · ${u.email}` })));
  store = makeStore();
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1000, now - last);
    last = now;
    tick(world, dt);
    const tags = world.changed.splice(0);
    if (tags.length) changed(tags);
  }, 100);
  return store;
}

/** Switch persona and/or scenario. A new scenario is a new world; a persona alone keeps it. */
export function goto(next: { route?: string; persona?: string; scenario?: string }) {
  const scenario = next.scenario ?? session.scenario;
  // With no persona named, whoever is signed in now (they may have signed in since) stays signed in.
  const current = [...PERSONAS.values()].find((p) => p.userId !== null && p.userId === world.sessionUserId)?.name;
  const persona = next.persona ?? current ?? session.persona;
  if (scenario !== session.scenario || persona !== session.persona) {
    if (scenario !== session.scenario) begin(scenario, persona, true);
    else {
      const built = buildWorld(scenario, persona);
      // The persona's own edits first: a persona may bring the person it signs in as (first-run, no-role).
      built.persona.apply?.(world);
      world.sessionUserId = built.persona.userId && world.users.some((u) => u.id === built.persona.userId) ? built.persona.userId : null;
      world.entered = [];
      session = { ...session, persona: built.persona.name, personaInfo: built.persona };
      save();
    }
    store = makeStore();
  }
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", session.scenario);
  url.searchParams.set("persona", session.persona);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  navigate(resolve(next.route ?? startRoute()), { replace: true });
  for (const l of listeners) l();
}

export function reset() {
  begin(session.scenario, session.persona, true);
  store = makeStore();
  clock.playing = true;
  clock.speed = 1;
  navigate(startRoute(), { replace: true });
  for (const l of listeners) l();
}

/** A sleeping app woke on a visit: it is awake and the visit is counted. */
export function markWoken(appId: string) {
  const app = world.apps.find((a) => a.id === appId);
  if (!app) return;
  Object.assign(app, { running: "awake", status: "running", healthSummary: "Awake; it sleeps again after its idle time." });
  if (app.telemetry) app.telemetry.visitsToday += 1;
  changed(["App", "Tree"]);
}

/** Someone the app was shared with registered at it. */
export function registerShare(appId: string, email: string) {
  const share = world.shares.find((s) => s.appId === appId && s.email === email);
  const app = world.apps.find((a) => a.id === appId);
  if (!share || share.registered || !app) return;
  share.registered = true;
  app.endUsers += 1;
  changed(["Shares", "App"]);
}

/** The console session ends (a member signed out at an app on the platform's host): the console asks again who is signed in. */
export function endConsoleSession() {
  world.sessionUserId = null;
  world.entered = [];
  changed(["Me", "Tree", "Credits"]);
}
