import { IDS, ORG, PEOPLE } from "./default";
import { defineScenario } from "./scenarios";
import { advance, append, seek } from "../server/engine";
import { answerApproval, startTurn } from "../server/routes/work";
import { runRecord, spentBelow, type DemoRun, type World } from "../server/world";

/**
 * Scenarios for the conversation pane (docs/flows/02, TALK; ARCH-012): every state a reviewer must be able to reach, each
 * built by playing the real scripts — a message sent, its approval answered, the work it started moved to its moment — so
 * what the pane shows is what the fake control plane's own logs say, never a picture painted for it. Registered by one
 * import in `host.ts`, after `scenarios.ts` has made its registry.
 */

const COURT_BOOKING = `${ORG}/technologies/court-booking/web`;
const KASPER = { scope: `${ORG}/technologies/court-booking` };
const OWNER = PEOPLE.owner;

/** Northwind with nothing playing, so nothing on screen moves except what the scenario starts. */
function quiet(w: World) {
  w.runs = w.runs.filter((r) => !r.playback);
}

function kasper(w: World) {
  return w.employees.find((e) => e.name === "Kasper" && e.scope === KASPER.scope);
}

type Answer = "approve" | "reject";

/** The run a conversation's approval started, once answered. */
export function startedBy(w: World, turn: DemoRun): DemoRun | undefined {
  const a = w.approvals.filter((x) => x.runId === turn.run.id).pop();
  return a?.outcome && "started" in a.outcome ? runRecord(w, a.outcome.started) : undefined;
}

/** Moves a run on until `until` holds, it waits for an answer, or it ends. */
export function playUntil(w: World, r: DemoRun, until: (r: DemoRun) => boolean = () => false) {
  for (let guard = 0; guard < 4000 && r.playback && !until(r); guard += 1) {
    if (w.approvals.some((a) => a.runId === r.run.id && a.answer === null)) return;
    advance(w, r, 250);
  }
}

/** Plays a run to a named moment, answering yes to whatever it asks on the way. */
function playTo(w: World, r: DemoRun, mark: string) {
  const only = w.runs.filter((x) => x.playback && x.run.id !== r.run.id);
  // `seek` takes the last live run with the moment: keep the others out of its way for the jump.
  const held = only.map((x) => ({ x, pb: x.playback }));
  for (const h of held) h.x.playback = null;
  seek(w, mark, (world, id) => answerApproval(world, id, "approve", OWNER.displayName));
  for (const h of held) h.x.playback = h.pb;
}

/**
 * One turn of the conversation, as the console sends it: the owner's message, the reply played through, and its approval
 * answered (`answer`) or left waiting (`null`). The work it started comes back with it.
 */
export function talk(w: World, message: string, o: { scope?: string; employeeId?: string | null; answer?: Answer | null; note?: string } = {}): { turn: DemoRun; started: DemoRun | undefined } {
  const turn = startTurn(w, { scope: o.scope ?? ORG, message, employeeId: o.employeeId ?? null, userId: OWNER.id });
  for (let guard = 0; guard < 400 && turn.playback; guard += 1) {
    const pending = w.approvals.find((a) => a.runId === turn.run.id && a.answer === null);
    if (pending) {
      if (o.answer === null || o.answer === undefined) break;
      answerApproval(w, pending.id, o.answer, OWNER.displayName, o.note ?? null);
      continue;
    }
    advance(w, turn, 500);
  }
  return { turn, started: startedBy(w, turn) };
}

/** A change asked for in the conversation and approved: its run, set to play with `params`. */
function changeFromTalk(w: World, message: string, params: Record<string, string | number | boolean | null> = {}, o: { scope?: string; employeeId?: string | null } = {}): DemoRun {
  const { started } = talk(w, message, { ...o, answer: "approve" });
  if (!started?.playback) throw new Error(`The conversation did not start a change for “${message}”.`);
  started.playback.params = { ...started.playback.params, ...params };
  return started;
}

const WAITLIST = "Please change the Court booking app: let members join a waitlist when a court is full.";

// ---------------------------------------------------------------------------------------------
// Rich replies: headings, lists, a table, code with its language, bold and chips, and a long path that wraps
// ---------------------------------------------------------------------------------------------

/** The questions that bring each rich reply (`scripts.ts` `richAnswer`); they work in the free-play demo too. */
export const RICH_QUESTIONS = [
  "Compare what each app cost this month.",
  "Give me the full picture of Northwind.",
  "What is waiting for me?",
  "Show me Court booking's config.",
  "Where does Court booking keep its bookings?",
  "Who works on Court booking?",
];

defineScenario({
  name: "talk-rich-replies",
  title: "The conversation's rich replies: a table, headings and lists, code, chips to apps, people, work and ideas",
  apply: (w) => {
    quiet(w);
    for (const q of RICH_QUESTIONS) talk(w, q);
  },
  route: "/",
});

defineScenario({
  name: "talk-rich-replies-app",
  title: "Rich replies in Court booking's own conversation",
  apply: (w) => {
    quiet(w);
    for (const q of ["Give me the full picture of Court booking.", "What is its config, as yaml?", "Where does Court booking keep its bookings?", "Who works on Court booking?"]) talk(w, q, { scope: COURT_BOOKING });
  },
  route: "/apps/{app}",
  featured: { app: IDS.tableBookings },
});

defineScenario({
  name: "talk-rich-replies-employee",
  title: "Rich replies from Kasper, on his own page",
  apply: (w) => {
    quiet(w);
    const k = kasper(w);
    for (const q of ["What did you change last week?", "Who works on Court booking?", "Show me Court booking's config.", "Where does Court booking keep its bookings?"]) talk(w, q, { scope: k?.scope ?? KASPER.scope, employeeId: k?.id ?? null });
  },
  route: "/employees/{employee}",
});

// ---------------------------------------------------------------------------------------------
// Approvals inside a work card
// ---------------------------------------------------------------------------------------------

defineScenario({
  name: "talk-web-search-approval",
  title: "Research the conversation started, asking before each web search (“asks you first”)",
  apply: (w) => {
    quiet(w);
    w.ruleSets.push({ path: ORG, stage: "research", deny: [], ask: ["web_search"], allow: [], checkpoints: [] });
    const { started } = talk(w, "Start researching a booking app for dive centres.", { answer: "approve" });
    if (started) playUntil(w, started);
  },
  route: "/",
});

/** Northwind in checkpoints mode with the plan checkpoint on: a change waits at its plan. */
function planCheckpoint(w: World) {
  quiet(w);
  w.settings = w.settings.filter((s) => !(s.path === ORG && (s.key === "autonomy" || s.key === "checkpoint.plan")));
  w.settings.push({ path: ORG, key: "autonomy", value: "checkpoints" }, { path: ORG, key: "checkpoint.plan", value: "true" });
}

defineScenario({
  name: "talk-plan-approval",
  title: "A change the conversation started, stopped at its plan for your sign-off",
  apply: (w) => {
    planCheckpoint(w);
    playUntil(w, changeFromTalk(w, WAITLIST));
  },
  route: "/",
});

defineScenario({
  name: "talk-plan-approval-app",
  title: "The same, from Court booking's own conversation",
  apply: (w) => {
    planCheckpoint(w);
    playUntil(w, changeFromTalk(w, "Let members join a waitlist when a court is full.", {}, { scope: COURT_BOOKING }));
  },
  route: "/apps/{app}",
  featured: { app: IDS.tableBookings },
});

defineScenario({
  name: "talk-plan-approval-employee",
  title: "The same, asked of Kasper on his own page",
  apply: (w) => {
    planCheckpoint(w);
    const k = kasper(w);
    playUntil(w, changeFromTalk(w, WAITLIST, {}, { scope: k?.scope ?? KASPER.scope, employeeId: k?.id ?? null }));
  },
  route: "/employees/{employee}",
});

// ---------------------------------------------------------------------------------------------
// How a card ends, and what its parts show
// ---------------------------------------------------------------------------------------------

defineScenario({
  name: "talk-card-failed",
  title: "A change the conversation started that failed, with “Try again” on its card",
  apply: (w) => {
    quiet(w);
    playUntil(w, changeFromTalk(w, WAITLIST, { fail: true }));
  },
  route: "/",
});

defineScenario({
  name: "talk-card-cancelled",
  title: "A change the conversation started that was cancelled part-way",
  apply: (w) => {
    quiet(w);
    const change = changeFromTalk(w, WAITLIST);
    playTo(w, change, "change:part-2");
    append(w, change, "run.finished", { outcome: "cancelled", by: OWNER.displayName, reason: "Cancelled by a person.", summary: "Cancelled." });
  },
  route: "/",
});

defineScenario({
  name: "talk-part-states",
  title: "Parts that did not pass, and a part whose check needs a look",
  apply: (w) => {
    quiet(w);
    // A change whose last part still fails after its repair: "Did not pass".
    playUntil(w, changeFromTalk(w, WAITLIST, { fail: true }));
    // A change whose part the checker found working while code's own reading disagreed twice: "Needs a look".
    playUntil(w, changeFromTalk(w, "Please change the Course Notes app: let students mark a note as revised.", { needsLook: "c1" }));
  },
  route: "/",
});

defineScenario({
  name: "talk-over-estimate",
  title: "A change re-estimated after planning (about 10, then about 15) that cost more than its estimate",
  apply: (w) => {
    quiet(w);
    playUntil(w, changeFromTalk(w, WAITLIST, { planEstimate: 15, costScale: 25 }));
  },
  route: "/",
});

defineScenario({
  name: "talk-many-parts",
  title: "A change planned in six parts, under way",
  apply: (w) => {
    quiet(w);
    const change = changeFromTalk(w, "Please change the Court booking app: let members join a waiting list when a court is full, see their place in the queue, leave the queue at any time, get an email when a court frees up, and choose which courts they will take.");
    playTo(w, change, "change:part-3");
  },
  route: "/",
});

defineScenario({
  name: "talk-retry-carried",
  title: "A build tried again from the conversation, its parts built before carried over, finished",
  apply: (w) => {
    const build = w.runs.find((x) => x.run.id === IDS.runBuildReadingList);
    if (!build?.playback) return;
    build.playback.params = { ...build.playback.params, fail: true };
    playTo(w, build, "build:failed");
    quiet(w);
    const { started } = talk(w, "Try the failed build again.", { answer: "approve" });
    if (started) playUntil(w, started);
  },
  route: "/",
});

// ---------------------------------------------------------------------------------------------
// The thread itself: a send that fails, a budget, a long history, a reply cut off, a reply still being written
// ---------------------------------------------------------------------------------------------

defineScenario({
  name: "talk-not-sent",
  title: "The first message cannot be sent (“Not sent · Send again”), then can",
  apply: (w) => {
    quiet(w);
    w.outages = [...(w.outages ?? []), { method: "POST", pattern: "conversations", times: 1, status: 503, detail: "The control plane could not answer just now." }];
  },
  route: "/",
});

defineScenario({
  name: "talk-budget-stopped",
  title: "Northwind's budget is spent: the conversation says so instead of replying",
  apply: (w) => {
    quiet(w);
    const sp = spentBelow(w, ORG);
    w.budgets = [...w.budgets.filter((b) => b.path !== ORG), { path: ORG, cap: Math.floor(sp.ai + sp.hosting) }];
    talk(w, "What is over budget?");
  },
  route: "/",
});

/** A long, real-looking history: questions over several days, two pieces of work finished, a no and a yes, a table. */
const HISTORY: { text: string; answer?: Answer; note?: string; work?: "finish" }[] = [
  { text: "Good morning. What is going on today?" },
  { text: "Who is working on what?" },
  { text: "Is anything down?" },
  { text: "What has Northwind spent this month?" },
  { text: "Compare what each app cost this month." },
  { text: "Which app costs the most to keep running?" },
  { text: "What is waiting for me?" },
  { text: "Keep apps always on.", answer: "reject", note: "Not while Learning is over budget." },
  { text: "Fine. What would always-on cost us?" },
  { text: WAITLIST, answer: "approve", work: "finish" },
  { text: "How is the waitlist change going?" },
  { text: "Who checked it?" },
  { text: "Who works on Court booking?" },
  { text: "Where does Court booking keep its bookings?" },
  { text: "Show me Court booking's config." },
  { text: "Is Court booking healthy after the change?" },
  { text: "What did we spend on Court booking last month?" },
  { text: "Give me the full picture of Northwind." },
  { text: "Please change the Course Notes app: let students mark a note as revised.", answer: "approve", work: "finish" },
  { text: "Did the Course Notes change go out?" },
  { text: "How many apps do we run now?" },
  { text: "Who is busy this afternoon?" },
  { text: "What did research cost us this month?" },
  { text: "Is Shift Rota still down?" },
  { text: "What is over budget?" },
  { text: "Who looks after Learning?" },
  { text: "Make Court booking public." },
  { text: "Understood. Who can do that?" },
  { text: "What is waiting for me now?" },
  { text: "Compare what each app cost this month." },
  { text: "Thanks. Anything else I should know before the weekend?" },
  { text: "Who is working on what?" },
];

/** Moves a run's whole story to `at`, keeping its events' spacing (a history read back days later). */
function redate(r: DemoRun, at: number) {
  const first = Date.parse(r.events[0]?.at ?? new Date(at).toISOString());
  const shift = (iso: string | null) => (iso ? new Date(Date.parse(iso) - first + at).toISOString() : iso);
  for (const e of r.events) e.at = shift(e.at) ?? e.at;
  r.run.startedAt = shift(r.run.startedAt) ?? r.run.startedAt;
  r.run.finishedAt = shift(r.run.finishedAt);
  r.run.createdAt = shift(r.run.createdAt) ?? r.run.createdAt;
}

defineScenario({
  name: "talk-long-history",
  title: "A long conversation: 32 turns over five days, two finished pieces of work, a declined approval and an approved one",
  apply: (w) => {
    quiet(w);
    // Five working days before today, six or seven turns a day between nine and five, oldest first.
    const day = 24 * 60 * 60 * 1000;
    const midnight = new Date(new Date().toISOString().slice(0, 10)).getTime();
    const perDay = Math.ceil(HISTORY.length / 5);
    // What was said before these five days stays first.
    for (const id of w.conversations.find((c) => c.scope === ORG && c.employeeId === null)?.runIds ?? []) {
      const r = runRecord(w, id);
      if (r) redate(r, midnight - 6 * day + 10 * 60 * 60 * 1000);
    }
    HISTORY.forEach((h, i) => {
      const { turn, started } = talk(w, h.text, { answer: h.answer ?? null, note: h.note });
      if (started && h.work === "finish") playUntil(w, started);
      const at = midnight - (5 - Math.floor(i / perDay)) * day + (9 * 60 + (i % perDay) * 70 + ((i * 17) % 23)) * 60 * 1000;
      redate(turn, at);
      if (started) redate(started, at + 30 * 1000);
    });
  },
  route: "/",
});

defineScenario({
  name: "talk-reply-interrupted",
  title: "The last message's reply was interrupted: the turn ended with no reply (“Try again”)",
  apply: (w) => {
    quiet(w);
    talk(w, "Who is working on what?");
    // Cut off before it is answered: the turn ends failed, with no reply and no notice saying why.
    startTurnCut(w, "Compare what each app cost this month.");
  },
  route: "/",
});

/** A turn that ends failed after its first model call, before any reply is written. */
function startTurnCut(w: World, message: string): DemoRun {
  const turn = startTurn(w, { scope: ORG, message, employeeId: null, userId: OWNER.id });
  playUntil(w, turn, (r) => r.events.some((e) => e.type === "model.replied"));
  append(w, turn, "run.finished", { outcome: "failed", summary: "The Runner stopped before the reply was written.", totals: { credits: 0.012, modelCalls: 1, nonBillableCredits: 0 } });
  return turn;
}

defineScenario({
  name: "talk-midreply",
  title: "A long reply still being written: reload part-way and it carries on",
  apply: (w) => {
    quiet(w);
    talk(w, "What is waiting for me?");
    const turn = startTurn(w, { scope: ORG, message: "Give me the full picture of Northwind.", employeeId: null, userId: OWNER.id });
    // Its steps taken and the reply about to stream: the clock plays the rest, about twenty seconds of it.
    playUntil(w, turn, (r) => r.events.filter((e) => e.type === "model.replied").length >= 2);
  },
  route: "/",
});
