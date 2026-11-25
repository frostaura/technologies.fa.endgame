import { IDS, ORG } from "./default";
import { defineScenario } from "./scenarios";
import { startChange } from "../server/tryAgain";
import { spentBelow, uuidFor, type World } from "../server/world";

/**
 * Scenarios for the factory and the conversation (docs/flows/03-the-factory.md and the TALK flows
 * of 02): research that did not finish, a run waiting for budget or for its start, a budget that
 * runs out mid-way, a change of a built app playing live, stage rules that ask and refuse, ideas
 * suggested from the portfolio, and a paused employee. Each edits the default world; `host.ts`
 * imports this file after `scenarios.ts` has made its registry.
 */

export const S3 = {
  /** The change of Court booking that `s3-change-running` plays. */
  runChange: uuidFor("run:s3:change-court-booking"),
};

const LEARNING = `${ORG}/learning`;
const COURT = { ...{ idea: IDS.ideaAllergen, employee: uuidFor(`employee:${ORG}/technologies/court-booking:engineer`), hire: uuidFor("hire:analyst") }, app: IDS.tableBookings };
const TIDES = { idea: IDS.ideaTides, run: IDS.runResearchTides, app: IDS.tableBookings };
const READING = { idea: IDS.ideaReadingList, run: IDS.runBuildReadingList, app: IDS.readingList };

const run = (w: World, id: string) => w.runs.find((r) => r.run.id === id);
const set = (w: World, path: string, key: string, value: string) => {
  w.settings = w.settings.filter((s) => !(s.path === path && s.key === key));
  w.settings.push({ path, key, value });
};
/** Only this run plays: the rest of Northwind is quiet. */
const only = (w: World, id: string) => (w.runs = w.runs.filter((r) => !r.playback || r.run.id === id));
/** A monthly cap on Learning that leaves `left` credits. */
const capLearning = (w: World, left: number) => {
  const spent = spentBelow(w, LEARNING);
  const b = w.budgets.find((x) => x.path === LEARNING);
  const cap = Math.round((spent.ai + spent.hosting + left) * 100) / 100;
  if (b) b.cap = cap;
  else w.budgets.push({ path: LEARNING, cap });
};

/** A change to Court booking, asked for in the console, playing from its estimate. */
function changeCourtBooking(w: World, params: Record<string, boolean> = {}) {
  const app = w.apps.find((a) => a.id === IDS.tableBookings);
  if (!app) return;
  const r = startChange(w, app, "Let members cancel a booking up to an hour before it starts.", { id: w.sessionUserId ?? "" }, "console", params);
  r.run.id = S3.runChange;
}

defineScenario({
  name: "s3-research-failed",
  title: "Research that did not reach a verdict",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    const r = run(w, IDS.runResearchTides);
    if (r?.playback) r.playback.params = { ...r.playback.params, fail: true };
  },
  route: "/ideas/{idea}",
  seek: "research:failed",
  featured: TIDES,
});

defineScenario({
  name: "s3-research-cancelled",
  title: "Research that was cancelled before its verdict",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    const r = run(w, IDS.runResearchTides);
    if (!r) return;
    const at = new Date().toISOString();
    r.playback = null;
    Object.assign(r.run, { status: "cancelled", outcome: "cancelled", summary: "Cancelled.", finishedAt: at });
    r.events.push({ seq: r.events.length + 1, type: "run.started", at, payload: { holder: "runner-demo-1" } }, { seq: r.events.length + 2, type: "run.finished", at, payload: { outcome: "cancelled", by: "Mara Ellison", reason: "Cancelled by a person.", summary: "Cancelled." } });
    r.run.lastSeq = r.events.length;
  },
  route: "/ideas/{idea}",
  featured: TIDES,
});

defineScenario({
  name: "s3-checkpoints",
  title: "Northwind in checkpoints mode: nothing is built until you decide",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    set(w, ORG, "autonomy", "checkpoints");
  },
  route: "/runs/{run}",
  featured: TIDES,
});

defineScenario({
  name: "s3-start-checkpoint",
  title: "Learning stops for your word before any work starts",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    set(w, LEARNING, "autonomy", "checkpoints");
    set(w, LEARNING, "checkpoint.start", "true");
  },
  route: "/runs/{run}",
  featured: TIDES,
});

defineScenario({
  name: "s3-waiting-for-budget",
  title: "Research waiting for budget: Learning has 5 credits left this month",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    capLearning(w, 5);
  },
  route: "/runs/{run}",
  featured: TIDES,
});

defineScenario({
  name: "s3-checkpoints-waiting-for-budget",
  title: "Learning in checkpoints mode, with 5 credits left: research still waits for budget",
  apply: (w) => {
    only(w, IDS.runResearchTides);
    set(w, LEARNING, "autonomy", "checkpoints");
    capLearning(w, 5);
  },
  route: "/runs/{run}",
  featured: TIDES,
});

defineScenario({
  name: "s3-budget-runs-out",
  title: "A build whose budget runs out part-way",
  apply: (w) => {
    only(w, IDS.runBuildReadingList);
    // The estimates fit what is left, so the work starts; it costs more than they said, and the gateway stops it when the credits run out.
    const r = run(w, IDS.runBuildReadingList);
    if (r?.playback) {
      r.playback.params = { ...r.playback.params, startEstimate: 1.2, planEstimate: 1.1 };
      r.run.estimateCredits = 1.2;
    }
    capLearning(w, 1.4);
  },
  route: "/runs/{run}",
  featured: READING,
});

defineScenario({
  name: "s3-change-running",
  title: "A change to Court booking, playing live",
  apply: (w) => {
    w.runs = w.runs.filter((r) => !r.playback);
    changeCourtBooking(w);
  },
  route: "/runs/{run}",
  featured: { ...COURT, run: S3.runChange },
});

defineScenario({
  name: "s3-change-failed",
  title: "A change that broke what worked before and could not be repaired",
  apply: (w) => {
    w.runs = w.runs.filter((r) => !r.playback);
    changeCourtBooking(w, { fail: true });
  },
  route: "/runs/{run}",
  seek: "change:failed",
  featured: { ...COURT, run: S3.runChange },
});

defineScenario({
  name: "s3-stage-rules",
  title: "Learning's build stage asks before the app's description changes, and refuses its decisions file",
  apply: (w) => {
    only(w, IDS.runBuildReadingList);
    w.ruleSets.push({ path: LEARNING, stage: "build", deny: ["edit_file(docs/decisions.md)"], ask: ["edit_file(docs/app.md)"], allow: [], checkpoints: [] });
  },
  route: "/runs/{run}",
  featured: READING,
});

defineScenario({
  name: "s3-suggestions",
  title: "Ideas suggested from the portfolio, one already taken and one set aside",
  apply: (w) => {
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const suggestion = (key: string, status: "open" | "taken" | "dismissed", m: number, s: { title: string; idea: string; gap: string; whyUs: string; reuses: string[] }) =>
      w.suggestions.push({ id: uuidFor(`suggestion:s3:${key}`), scope: ORG, runId: uuidFor("run:s3:suggest"), status, ideaId: status === "taken" ? IDS.ideaAllergen : null, createdAt: at(m), ...s });
    suggestion("waiting", "open", 40, { title: "A course waiting list", idea: "When a course is full, take names and offer the next place automatically.", gap: "Full courses turn people away with no way back in.", whyUs: "Course Notes already knows every course and who is on it.", reuses: ["Course Notes' enrolments", "the organisation's sign-in"] });
    suggestion("reorder", "open", 40, { title: "Weekly stock reorder email", idea: "Every Friday, email the supplier the items below their usual level.", gap: "Reorders are written by hand from the count sheet.", whyUs: "Stock Counter already counts every item weekly.", reuses: ["Stock Counter's counts", "the platform's email service"] });
    suggestion("allergen", "taken", 3 * 24 * 60, { title: "Allergen labels for the kitchen", idea: "Pick a dish, print its allergen label with today's date and use-by.", gap: "Labels are handwritten and allergens are missed.", whyUs: "Court booking's café menu already lists every dish.", reuses: ["the café menu"] });
    suggestion("lockers", "dismissed", 2 * 24 * 60, { title: "Locker hire by the session", idea: "Members book a locker with their court and get its code on their phone.", gap: "Lockers are handed out at the desk with paper keys.", whyUs: "Court booking already knows every session.", reuses: ["Court booking's sessions"] });
  },
  route: "/suggestions?scope=northwind",
  featured: COURT,
});

defineScenario({
  name: "s3-employee-paused",
  title: "Kasper, Court booking's engineer, is paused",
  apply: (w) => {
    const kasper = w.employees.find((e) => e.id === COURT.employee);
    if (kasper) Object.assign(kasper, { status: "paused", currentRun: null });
  },
  route: "/apps/{app}",
  featured: COURT,
});
