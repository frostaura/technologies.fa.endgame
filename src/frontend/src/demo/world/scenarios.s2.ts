import { uuidFor, type World } from "../server/world";
import { definePersona, defineScenario } from "./scenarios";

/**
 * Scenarios and a persona for the academy's organisation, tree, notification and system flows
 * (docs/flows/02): reads that fail the way a real one does, system status in each of its states,
 * and someone signed in who holds no role anywhere. Registered by one import in `host.ts`, after
 * `scenarios.ts` has run: an import from inside `scenarios.ts` would run this file first, before
 * its registries exist.
 */

type Outage = NonNullable<World["outages"]>[number];

/** Northwind with nothing playing, so no live run refreshes a screen behind the lesson's back. */
function quiet(w: World) {
  w.runs = w.runs.filter((r) => !r.playback);
}

function failing(w: World, ...outages: Outage[]) {
  w.outages = [...(w.outages ?? []), ...outages];
}

// Home: the tree cannot be read (SYS-10), or a refresh after a good load fails (ORG-13).
defineScenario({ name: "tree-unreachable", title: "Home cannot reach the control plane once, then can", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "tree", times: 1 })), route: "/" });
defineScenario({ name: "tree-refresh-fails", title: "Home loads, then every refresh fails", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "tree", skip: 1 })), route: "/" });

// The two graphs cannot be read (ONT-06), once; "Try again" then draws them.
defineScenario({ name: "ontology-unreachable", title: "The organisation graph cannot be read once, then can", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "ontology", times: 1 })), route: "/" });

// Notifications cannot be read (NOTE-08): on the first load (once), or on every refresh after a good one.
defineScenario({ name: "notifications-unreachable", title: "The notifications cannot be read once, then can", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "notifications", times: 1 })), route: "/notifications" });
defineScenario({ name: "notifications-refresh-fails", title: "The notifications load, then a refresh fails", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "notifications", skip: 1 })), route: "/notifications" });

// System status in each of its states (SYS-03, SYS-04).
defineScenario({ name: "status-unhealthy", title: "System status: the Runner does not answer", apply: (w) => (w.systemStatus = { unhealthy: { runner: "No answer within 2000 ms." } }), route: "/system" });
defineScenario({ name: "status-no-services", title: "System status: the control plane reports no services", apply: (w) => (w.systemStatus = { none: true }), route: "/system" });
defineScenario({ name: "status-unreachable", title: "System status cannot be read once, then can", apply: (w) => failing(w, { method: "GET", pattern: "system/status", times: 1 }), route: "/system" });
defineScenario({ name: "status-refresh-fails", title: "System status reads once, then a check fails", apply: (w) => failing(w, { method: "GET", pattern: "system/status", skip: 1 }), route: "/system" });

// The session check cannot reach the control plane once (SYS-09); "Try again" then opens the console.
defineScenario({ name: "session-unreachable", title: "The console cannot check who you are, once", apply: (w) => (quiet(w), failing(w, { method: "GET", pattern: "me", times: 1 })), route: "/" });

// A FrostAura operator who holds no role in any organisation of their own lands in God mode (ORG-17).
defineScenario({ name: "operator-no-organisation", title: "A FrostAura operator with no organisation of their own", apply: (w) => (w.memberships = w.memberships.filter((m) => !w.users.some((u) => u.id === m.userId && u.isOperator))), route: "/", persona: "operator" });

// Someone signed in with a passkey who holds no role anywhere, after organisations exist (ORG-03).
const NO_ROLE = uuidFor("user:sol");
definePersona({
  name: "no-role",
  title: "Sol Hart · signed in, no role in any organisation",
  userId: NO_ROLE,
  apply: (w) => {
    if (!w.users.some((u) => u.id === NO_ROLE)) w.users.push({ id: NO_ROLE, displayName: "Sol Hart", email: "sol@harbourside.example", passkeys: 1, isOperator: false, invitation: null });
    if (!w.device.includes(NO_ROLE)) w.device.push(NO_ROLE);
    w.memberships = w.memberships.filter((m) => m.userId !== NO_ROLE);
  },
});
