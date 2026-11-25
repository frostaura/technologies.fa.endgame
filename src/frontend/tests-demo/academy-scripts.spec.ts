import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Every academy step script (src/academy/scripts) played against the built demo, as the academy
 * plays it: goto, then per step goto, clock, act, highlight. At run time a highlight that finds
 * nothing goes unlit (`found: false`) so a lesson never breaks in front of a learner; here, at
 * build, it fails — naming the flow and step — unless tests-demo/academy-allowlist.json lists it
 * with a reason. So wording drift between the console and the academy is caught before it ships.
 */

interface Step {
  step: number;
  kind: string;
  goto?: string;
  /** From this step on, someone else is signed in to the same world. */
  persona?: string;
  clock?: Record<string, unknown>;
  act?: unknown[];
  highlight?: Record<string, unknown>;
}
interface StepScript {
  flow: string;
  persona: string;
  scenario: string;
  start: string;
  steps: Step[];
  /** "What else can happen", each branch played in a console of its own; numbered 1, 2, 3. */
  variations?: { title: string; persona: string; scenario: string; start: string; steps: Step[] }[];
}

const dir = path.join(import.meta.dirname, "..", "..", "academy", "scripts");
/** `ACADEMY_FLOWS=HIRE,EMP-02` plays only the flows whose id is, or starts with, one of these. */
const only = (process.env.ACADEMY_FLOWS ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
const scripts: StepScript[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as StepScript)
  .filter((s) => !only.length || only.some((o) => s.flow === o || s.flow.startsWith(`${o}-`)))
  .filter((s) => [...s.steps, ...(s.variations ?? []).flatMap((v) => v.steps)].some((st) => st.kind === "demo"));
const allow = (JSON.parse(readFileSync(path.join(import.meta.dirname, "academy-allowlist.json"), "utf8")) as { entries: { flow: string; step: number; reason: string }[] }).entries;
/** A variation's step is listed as `{ "flow": "HIRE-03", "variation": 1, "step": 2 }`. */
const allowed = (flow: string, step: number, variation?: number) => allow.find((a) => a.flow === flow && a.step === step && (a as { variation?: number }).variation === variation);

test("reads the academy's step scripts", () => {
  expect(scripts.length).toBeGreaterThan(only.length ? 0 : 5);
  for (const a of allow) expect(a.reason.length, `${a.flow} step ${a.step} needs a reason`).toBeGreaterThan(10);
});

for (const script of scripts) {
  test(`${script.flow} plays against the demo (${script.persona}, ${script.scenario})`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/technologies.fa.endgame/demo/index.html?embed=1`);
    await page.waitForFunction(() => "endgameDemo" in window);
    const call = (op: string, ...args: unknown[]) =>
      page.evaluate(async ([o, a]) => (window as unknown as { endgameDemo: Record<string, (...x: unknown[]) => unknown> }).endgameDemo[o as string]?.(...(a as unknown[])), [op, args] as const);
    const failures: string[] = [];
    const passedButAllowed: string[] = [];
    // The flow's own steps, then each variation from its own start, as the academy plays them.
    const plays = [{ label: "", variation: undefined as number | undefined, ...script }, ...(script.variations ?? []).map((v, i) => ({ ...v, label: ` variation ${i + 1} ("${v.title}")`, variation: i + 1 }))];
    for (const play of plays) {
      await call("reset");
      await call("goto", { route: play.start, persona: play.persona, scenario: play.scenario });
      for (const step of play.steps.filter((s) => s.kind === "demo")) {
        const where = `${script.flow}${play.label} step ${step.step}`;
        let failed: string | null = null;
        try {
          if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
          if (step.clock) await call("clock", step.clock);
          if (step.act) await call("act", step.act, false);
          if (step.highlight && (await call("highlight", step.highlight)) === false) failed = `the highlight ${JSON.stringify(step.highlight)} found nothing on screen`;
        } catch (e) {
          failed = `an action failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? ""}`;
        }
        const ok = allowed(script.flow, step.step, play.variation);
        if (failed && !ok) failures.push(`${where}: ${failed}`);
        if (!failed && ok) passedButAllowed.push(`${where} is on the allow-list ("${ok.reason}") but now passes: remove it`);
      }
    }
    expect([...failures, ...passedButAllowed, ...errors.map((e) => `${script.flow}: console error: ${e}`)]).toEqual([]);
  });
}
