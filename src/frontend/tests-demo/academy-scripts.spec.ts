import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Every academy step script (src/academy/scripts) played against the built demo, as the academy
 * plays it — goto, then per step goto, clock, act, highlight — on BOTH of the consoles the academy
 * frames: a laptop's (1280 × 800, every desktop and tablet window) and a phone's (390 × 640, a
 * phone held either way). Every step of every script, and of every variation ("What else can
 * happen"), is held, at both sizes, to:
 *
 * - it plays: no action errors, a highlight finds what it names (unless allow-listed, below), and a
 *   text spotlight rings what its words name — not a control that deletes or ends something the
 *   step does not name, not a match inside a longer word;
 * - (a) the phone reaches the step's screen exactly as the laptop does: the same address;
 * - (b) a ring is drawn, whole and inside the console, unless the step says it has nothing to ring
 *   (`highlight.none`, with its reason);
 * - (c) nothing is written over the console: no caption bubble (the academy sets a step's words in
 *   a strip under its frame);
 * - (d) it is not the step before again: a step may ring the same thing as the one before only to
 *   say something new about it (its caption differs); the same ring with the same caption fails.
 *
 * At run time a highlight that finds nothing goes unlit so a lesson never breaks in front of a
 * learner; here it fails, naming flow, step and size, unless tests-demo/academy-allowlist.json lists
 * it with a reason (`{ flow, step, reason, variation?, size? }`); an allow-listed step that passes
 * fails too, so the list stays true.
 *
 * A step is one moment however it is reached: for the flows in SAME_MOMENT the script is played a
 * second time (on the laptop's console), caught up step by step, and each step's state
 * (`endgameDemo.state()`) must equal the state the live play left.
 *
 * `ACADEMY_FLOWS=ID,PPL` plays only the scripts whose flow id starts with one of those prefixes.
 */

/** The flows held to "a step is one moment" (the identity flows first: their passkey sheet used to race a timer). */
const SAME_MOMENT = ["ID-"];

/** The two consoles the academy's frame draws, at their fixed sizes (src/academy/src/theme/tokens.ts `CONSOLE`). */
const SIZES = [
  { name: "laptop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 640 },
] as const;

interface Highlight {
  selector?: string;
  testId?: string;
  text?: string;
  note?: string;
  region?: true;
  none?: string;
}
interface Step {
  step: number;
  kind: string;
  goto?: string;
  /** From this step on, someone else is signed in to the same world. */
  persona?: string;
  clock?: Record<string, unknown>;
  act?: unknown[];
  highlight?: Highlight;
  note?: string;
}
interface StepScript {
  flow: string;
  persona: string;
  scenario: string;
  start: string;
  device?: "phone";
  steps: Step[];
  variations?: { title: string; persona: string; scenario: string; start: string; steps: Step[] }[];
}
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface RingState {
  shown: boolean;
  ring: Box | null;
  visible: Box | null;
}

const only = (process.env.ACADEMY_FLOWS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const wanted = (flow: string) => only.length === 0 || only.some((p) => flow === p || flow.startsWith(p.endsWith("-") ? p : `${p}-`));

const dir = path.join(import.meta.dirname, "..", "..", "academy", "scripts");
const scripts: StepScript[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as StepScript)
  .filter((s) => wanted(s.flow))
  .filter((s) => [s, ...(s.variations ?? [])].some((v) => v.steps.some((st) => st.kind === "demo")));
const allow = (JSON.parse(readFileSync(path.join(import.meta.dirname, "academy-allowlist.json"), "utf8")) as { entries: { flow: string; variation?: number; step: number; size?: string; reason: string }[] }).entries;
const allowed = (flow: string, step: number, size: string, variation?: number) => allow.find((a) => a.flow === flow && a.step === step && a.variation === variation && (a.size === undefined || a.size === size));


test("reads the academy's step scripts", () => {
  expect(scripts.length).toBeGreaterThan(only.length ? 0 : 5);
  for (const a of allow) expect(a.reason.length, `${a.flow} step ${a.step} needs a reason`).toBeGreaterThan(10);
  // Every step a demo script plays says what it is about: a target, or `none` with its reason.
  const unmarked = scripts.flatMap((s) => [s, ...(s.variations ?? [])].flatMap((v, i) => v.steps.filter((st) => st.kind === "demo" && !st.highlight).map((st) => `${s.flow}${i ? ` variation ${i}` : ""} step ${st.step}`)));
  expect(unmarked, "demo steps with no highlight and no `none` marker").toEqual([]);
});

/** A script, or one of its variations (numbered from 1), as one thing to play. */
const plays = scripts.flatMap((s) => [
  { script: s, variation: undefined as number | undefined, name: `${s.flow} plays on both consoles (${s.persona}, ${s.scenario})` },
  ...(s.variations ?? []).map((v, i) => ({ script: { ...s, ...v, variations: undefined }, variation: i + 1, name: `${s.flow} variation ${i + 1} "${v.title}" plays on both consoles (${v.persona}, ${v.scenario})` })),
]).filter((p) => p.script.steps.some((st) => st.kind === "demo"));

const near = (a: Box | null, b: Box | null, px = 4) => !!a && !!b && Math.abs(a.left - b.left) <= px && Math.abs(a.top - b.top) <= px && Math.abs(a.right - b.right) <= px && Math.abs(a.bottom - b.bottom) <= px;
const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

function caller(page: Page) {
  return (op: string, ...args: unknown[]) =>
    page.evaluate(async ([o, a]) => (window as unknown as { endgameDemo: Record<string, (...x: unknown[]) => unknown> }).endgameDemo[o as string]?.(...(a as unknown[])), [op, args] as const);
}

for (const { script, variation, name } of plays) {
  test(name, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    const call = caller(page);
    /** What this play's checks counted: kept on the test (its "steps" annotation), so a run's totals add up across workers and shards. */
    const counted = { steps: 0, rings: 0, marked: 0, routes: 0 };
    const failures: string[] = [];
    const passedButAllowed: string[] = [];
    /** Per size, per step: the address the step ended on. */
    const routes: Record<string, Record<number, string>> = {};
    /** Per size, per step: what failed there (null when it passed); the allow-list is applied once both sizes have played. */
    const results: Record<string, Record<number, string | null>> = {};
    const live: Record<number, string> = {};
    const demoSteps = script.steps.filter((s) => s.kind === "demo");
    const sizes = SIZES.filter((s) => script.device !== "phone" || s.name === "phone");

    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/technologies.fa.endgame/demo/index.html?embed=1`);
      await page.waitForFunction(() => "endgameDemo" in window);
      // A fresh world for each console: the world is kept in the tab's storage, and the laptop's play
      // has already changed it (an app deleted, a run started again).
      await call("reset");
      await call("goto", { route: script.start, persona: script.persona, scenario: script.scenario });
      const here: Record<number, string> = {};
      routes[size.name] = here;
      const outcome: Record<number, string | null> = {};
      results[size.name] = outcome;
      let previous: { ring: Box | null; note: string | undefined } | null = null;
      for (const step of demoSteps) {
        let failed: string | null = null;
        const marker = step.step;
        try {
          if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
          if (step.clock) await call("clock", step.clock);
          // The laptop plays each step as the learner watches it; the phone catches up to it, as a
          // link straight to a step does — a step is one moment however it is reached.
          if (step.act) await call("act", step.act, size.name === "phone");
          if (step.highlight && (await call("highlight", { ...step.highlight, marker })) === false) failed = `the highlight ${JSON.stringify(step.highlight)} found nothing on screen`;
          else if (step.highlight?.text) {
            const seen = (await call("inspect", { text: step.highlight.text })) as { found: boolean; tag?: string; text?: string; exact?: boolean; wholeWords?: boolean; destructive?: boolean };
            if (seen.found && seen.destructive && !seen.exact) failed = `the highlight "${step.highlight.text}" rang the ${seen.tag} "${seen.text}", a control that deletes or ends something the step does not name`;
            else if (seen.found && !seen.wholeWords) failed = `the highlight "${step.highlight.text}" matched only part of a word, in the ${seen.tag} "${seen.text}"`;
          }
        } catch (e) {
          failed = `an action failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? ""}`;
        }
        counted.steps += 1;
        const state = (await call("state")) as { route: string };
        here[step.step] = state.route;
        // The ring as the learner sees it a moment later: drawn and still (two reads 150 ms apart agree; at most 2 s).
        let ring = (await call("ring")) as RingState;
        for (let i = 0; i < 13 && !step.highlight?.none; i++) {
          await page.waitForTimeout(150);
          const again = (await call("ring")) as RingState;
          const still = again.shown && ring.shown && near(again.visible, ring.visible, 1);
          ring = again;
          if (still) break;
        }
        const note = step.highlight?.note ?? step.note;
        if (!failed && !step.highlight?.none) {
          const view: Box = { left: 0, top: 0, right: size.width, bottom: size.height };
          // (b) a ring, drawn, whole, and inside the console.
          if (!ring.shown || !ring.ring || !ring.visible) failed = `no ring is drawn (what it names is out of view or covered)`;
          else if (ring.visible.left < view.left - 1 || ring.visible.top < view.top - 1 || ring.visible.right > view.right + 1 || ring.visible.bottom > view.bottom + 1) failed = `the ring runs outside the console (${JSON.stringify(ring.visible)})`;
          else if (area(ring.visible) < 0.85 * area(ring.ring)) failed = `only part of the ring shows (${Math.round((100 * area(ring.visible)) / area(ring.ring))}%): what it rings is cut by the edge of its scroll area`;
          // (d) not the step before again.
          else if (previous && near(previous.ring, ring.visible) && previous.note === note) failed = `the same ring and caption as the step before`;
          else counted.rings += 1;
        }
        if (step.highlight?.none) counted.marked += 1;
        // (c) nothing over the console.
        if (!failed && (await page.locator("[data-demo-note]").count()) > 0) failed = "a caption bubble is drawn over the console";
        previous = { ring: step.highlight?.none ? null : ring.visible, note };
        outcome[step.step] = failed;
        if (size.name === "laptop" && SAME_MOMENT.some((p) => script.flow.startsWith(p))) live[step.step] = await steady(page);
      }
    }

    // (a) the phone reaches each step's screen as the laptop does.
    if (routes.laptop && routes.phone) {
      for (const step of demoSteps) {
        counted.routes += 1;
        // A record made during the lesson (a run started again) has a new id on each play: the screen is what is compared.
        const screen = (r: string | undefined) => (r ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "{id}");
        const [a, b] = [screen(routes.laptop[step.step]), screen(routes.phone[step.step])];
        const phone = results.phone ?? {};
        if (a !== b) phone[step.step] = [phone[step.step], `the laptop ends at ${a}, the phone at ${b}`].filter(Boolean).join("; ");
      }
    }
    // The allow-list, once, per step and size: an excused step must still fail, or it leaves the list.
    for (const [size, outcome] of Object.entries(results)) {
      for (const [n, failed] of Object.entries(outcome)) {
        const where = `${script.flow}${variation ? ` variation ${variation}` : ""} step ${n} (${size})`;
        const ok = allowed(script.flow, Number(n), size, variation);
        if (failed && !ok) failures.push(`${where}: ${failed}`);
        if (!failed && ok) passedButAllowed.push(`${where} is on the allow-list ("${ok.reason}") but now passes: remove it`);
      }
    }

    if (Object.keys(live).length) {
      // Caught up, as a link to each step and its captured picture reach it.
      await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
      await call("reset");
      await call("goto", { route: script.start, persona: script.persona, scenario: script.scenario });
      for (const step of demoSteps) {
        try {
          if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
          if (step.clock) await call("clock", step.clock);
          if (step.act) await call("act", step.act, true);
        } catch {
          // The live play above names an action that fails.
        }
        const caught = await steady(page);
        if (caught !== live[step.step]) failures.push(`${script.flow}${variation ? ` variation ${variation}` : ""} step ${step.step}: played, it ends at ${live[step.step]}; reached directly (a link, its picture), at ${caught}`);
      }
    }
    test.info().annotations.push({ type: "steps", description: JSON.stringify(counted) });
    expect([...failures, ...passedButAllowed, ...errors.map((e) => `${script.flow}: console error: ${e}`)]).toEqual([]);
  });
}

/** The demo's state once what the step started has been answered and nothing still changes (two reads 400 ms apart agree; at most 8 s). */
async function steady(page: Page) {
  const call = caller(page);
  const read = async () => {
    const { answering, ...rest } = (await call("state")) as { answering: boolean };
    return answering ? null : JSON.stringify(rest);
  };
  let last = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    const now = await read();
    if (now !== null && now === last) return now;
    last = now;
  }
  return last ?? "still answering";
}
