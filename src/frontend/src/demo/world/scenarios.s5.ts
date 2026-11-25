import type { SavedQuestion } from "@/store/types";
import { IDS } from "./default";
import type { Scenario } from "./scenarios";
import { ago, uuidFor, type World } from "../server/world";

/**
 * Scenarios for the academy's area 05 — the app page, asking, versions, sharing, secrets, a hosted
 * app as its visitors meet it — so every refusal and branch "What else can happen" names has a
 * world that shows it. `scenarios.ts` registers them: this module cannot call `defineScenario`
 * itself, because the import that brings it in runs before `scenarios.ts` has made its registry.
 */

export const scenariosS5: Scenario[] = [];
const defineScenario = (s: Scenario) => scenariosS5.push(s);

const COURT = { app: IDS.tableBookings };
const NOTES = { app: IDS.courseNotes };
const court = (w: World) => w.apps.find((a) => a.id === IDS.tableBookings);

defineScenario({ name: "ask-unavailable", title: "No model is configured, so nothing about an app can be asked", apply: (w) => (w.modelsOffline = true), route: "/apps/{app}", featured: COURT });

defineScenario({
  name: "app-private",
  title: "Court booking, private to Northwind",
  apply: (w) => {
    const a = court(w);
    if (a) a.access = "private";
  },
  route: "/apps/{app}",
  featured: COURT,
});

defineScenario({
  name: "app-public",
  title: "Court booking, public: anyone with the address opens it",
  apply: (w) => {
    const a = court(w);
    if (a) a.access = "public";
  },
  route: "/apps/{app}",
  featured: COURT,
});

defineScenario({
  name: "app-shared-empty",
  title: "Court booking, shared, with nobody invited yet",
  apply: (w) => {
    w.shares = w.shares.filter((s) => s.appId !== IDS.tableBookings);
    const a = court(w);
    if (a) a.endUsers = 0;
  },
  route: "/apps/{app}",
  featured: COURT,
});

defineScenario({ name: "app-restore-fails", title: "Court booking, where bringing a version back cannot rebuild it", apply: (w) => (w.rebuildFails = [IDS.tableBookings]), route: "/apps/{app}", featured: COURT });
defineScenario({ name: "app-rebuild-fails", title: "Shift Rota crashed, and rebuilding it fails", apply: (w) => (w.rebuildFails = [IDS.shiftRota]), route: "/apps/{app}", featured: { app: IDS.shiftRota } });

defineScenario({
  name: "app-not-published",
  title: "Tutor Match has an address, but no version is published yet",
  apply: (w) => {
    const a = w.apps.find((x) => x.id === IDS.tutorMatch);
    if (a) Object.assign(a, { status: "draft", version: null, publishedAt: null, telemetry: null, healthSummary: "Not published yet." });
    delete w.versions[IDS.tutorMatch];
  },
  route: "/apps/{app}",
  featured: { app: IDS.tutorMatch },
});

// A sleeping app whose wake does not finish: each of the Edge's answers, and Cloudflare's when the host is down.
defineScenario({ name: "app-wake-slow", title: "Course Notes takes over 30 seconds to wake", apply: (w) => (w.edgeAnswer = { [IDS.courseNotes]: "slow" }), route: "/apps/{app}", featured: NOTES });
defineScenario({ name: "app-wake-busy", title: "Course Notes cannot start: the host has no room", apply: (w) => (w.edgeAnswer = { [IDS.courseNotes]: "busy" }), route: "/apps/{app}", featured: NOTES });
defineScenario({ name: "app-unreachable", title: "Course Notes cannot be reached just now", apply: (w) => (w.edgeAnswer = { [IDS.courseNotes]: "unreachable" }), route: "/apps/{app}", featured: NOTES });
defineScenario({ name: "outage", title: "The host is down: Cloudflare shows the outage page", apply: (w) => (w.edgeAnswer = { [IDS.tableBookings]: "outage" }), route: "/__app/{app}/subdomain/", featured: COURT });

defineScenario({ name: "no-secrets", title: "No secret is set anywhere in Northwind", apply: (w) => (w.secrets = []), route: "/secrets?scope=northwind", featured: COURT });

defineScenario({
  name: "dashboard-full",
  title: "Court booking's dashboard holds its 30 questions",
  apply: (w) => {
    const at = ago(60);
    const kept = w.dashboard.filter((q) => q.appId === IDS.tableBookings).length;
    for (let i = kept; i < 30; i++) {
      const question: SavedQuestion & { appId: string } = {
        appId: IDS.tableBookings,
        id: uuidFor(`question:full:${i}`),
        question: `How many visits on day ${i + 1} of the month?`,
        answer: `${120 + ((i * 37) % 90)} visits.`,
        sql: "select count(*) as visits from visits where extract(day from at) = $1",
        chart: { kind: "number", x: null, y: ["visits"], series: [{ name: "visits", points: [{ x: null, y: 120 + ((i * 37) % 90) }] }] },
        columns: ["visits"],
        rows: [{ visits: 120 + ((i * 37) % 90) }],
        truncated: false,
        askedAt: at,
        ranAt: at,
        error: null,
        technical: null,
      };
      w.dashboard.push(question);
    }
  },
  route: "/apps/{app}",
  featured: COURT,
});
