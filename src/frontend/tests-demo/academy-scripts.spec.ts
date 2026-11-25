import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Every academy step script (src/academy/scripts) played against the built demo, as the academy
 * plays it: goto, then per step goto, clock, act, highlight. At run time a highlight that finds
 * nothing goes unlit (`found: false`) so a lesson never breaks in front of a learner; here, at
 * build, it fails — naming the flow and step — unless tests-demo/academy-allowlist.json lists it
 * with a reason. So wording drift between the console and the academy is caught before it ships.
 * A text spotlight that landed on a destructive control the step does not name ("Delete Shift
 * Rota" for "Shift Rota"), or matched only part of a word ("Mon" in "month"), fails too.
 * Each of a script's variations ("What else can happen") is played the same way, from its own start,
 * as its own persona and scenario; its steps are allow-listed as `{ flow, variation, step }`.
 *
 * A step is one moment however it is reached: played after the step before it (as a learner walks
 * the steps), or caught up to instantly (as a link straight to the step, and the picture captured
 * for it, reach it). For the flows in SAME_MOMENT the script is played a second time, caught up
 * step by step, and each step's state (`endgameDemo.state()`: address, who is signed in, the device
 * sheet, the heading) must equal the state the live play left.
 *
 * `ACADEMY_FLOWS=ID,PPL` plays only the scripts whose flow id starts with one of those prefixes.
 */

/** The flows held to "a step is one moment" (the identity flows first: their passkey sheet used to race a timer). */
const SAME_MOMENT = ["ID-"];

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
  variations?: { title: string; persona: string; scenario: string; start: string; steps: Step[] }[];
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
const allow = (JSON.parse(readFileSync(path.join(import.meta.dirname, "academy-allowlist.json"), "utf8")) as { entries: { flow: string; variation?: number; step: number; reason: string }[] }).entries;
const allowed = (flow: string, step: number, variation?: number) => allow.find((a) => a.flow === flow && a.step === step && a.variation === variation);

test("reads the academy's step scripts", () => {
  expect(scripts.length).toBeGreaterThan(only.length ? 0 : 5);
  for (const a of allow) expect(a.reason.length, `${a.flow} step ${a.step} needs a reason`).toBeGreaterThan(10);
});

/** A script, or one of its variations (numbered from 1), as one thing to play. */
const plays = scripts.flatMap((s) => [
  { script: s, variation: undefined as number | undefined, name: `${s.flow} plays against the demo (${s.persona}, ${s.scenario})` },
  ...(s.variations ?? []).map((v, i) => ({ script: { ...s, ...v, variations: undefined }, variation: i + 1, name: `${s.flow} variation ${i + 1} "${v.title}" plays against the demo (${v.persona}, ${v.scenario})` })),
]).filter((p) => p.script.steps.some((st) => st.kind === "demo"));

for (const { script, variation, name } of plays) {
  test(name, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/technologies.fa.endgame/demo/index.html?embed=1`);
    await page.waitForFunction(() => "endgameDemo" in window);
    const call = (op: string, ...args: unknown[]) =>
      page.evaluate(async ([o, a]) => (window as unknown as { endgameDemo: Record<string, (...x: unknown[]) => unknown> }).endgameDemo[o as string]?.(...(a as unknown[])), [op, args] as const);
    await call("goto", { route: script.start, persona: script.persona, scenario: script.scenario });
    /** The demo's state once what the step started has been answered and nothing still changes (two reads 400 ms apart agree; at most 8 s). */
    const steady = async () => {
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
    };
    const live: Record<number, string> = {};
    const failures: string[] = [];
    const passedButAllowed: string[] = [];
    for (const step of script.steps.filter((s) => s.kind === "demo")) {
      const where = `${script.flow}${variation ? ` variation ${variation}` : ""} step ${step.step}`;
      let failed: string | null = null;
      try {
        if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
        if (step.clock) await call("clock", step.clock);
        if (step.act) await call("act", step.act, false);
        if (step.highlight && (await call("highlight", step.highlight)) === false) failed = `the highlight ${JSON.stringify(step.highlight)} found nothing on screen`;
        else if (step.highlight && typeof step.highlight.text === "string") {
          // A text spotlight must ring what its words name: not a control that deletes or ends
          // something the step did not name, and not a match inside a longer word.
          const seen = (await call("inspect", { text: step.highlight.text })) as { found: boolean; tag?: string; text?: string; exact?: boolean; wholeWords?: boolean; destructive?: boolean };
          if (seen.found && seen.destructive && !seen.exact) failed = `the highlight "${step.highlight.text}" rang the ${seen.tag} "${seen.text}", a control that deletes or ends something the step does not name`;
          else if (seen.found && !seen.wholeWords) failed = `the highlight "${step.highlight.text}" matched only part of a word, in the ${seen.tag} "${seen.text}"`;
        }
      } catch (e) {
        failed = `an action failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0] ?? ""}`;
      }
      const ok = allowed(script.flow, step.step, variation);
      if (failed && !ok) failures.push(`${where}: ${failed}`);
      if (!failed && ok) passedButAllowed.push(`${where} is on the allow-list ("${ok.reason}") but now passes: remove it`);
      if (SAME_MOMENT.some((p) => script.flow.startsWith(p))) live[step.step] = await steady();
    }
    if (Object.keys(live).length) {
      // Caught up, as a link to each step and its captured picture reach it.
      await call("reset");
      await call("goto", { route: script.start, persona: script.persona, scenario: script.scenario });
      for (const step of script.steps.filter((s) => s.kind === "demo")) {
        try {
          if (step.goto) await call("goto", { route: step.goto, ...(step.persona ? { persona: step.persona } : {}) });
          if (step.clock) await call("clock", step.clock);
          if (step.act) await call("act", step.act, true);
        } catch {
          // The live play above names an action that fails.
        }
        const caught = await steady();
        if (caught !== live[step.step]) failures.push(`${script.flow}${variation ? ` variation ${variation}` : ""} step ${step.step}: played, it ends at ${live[step.step]}; reached directly (a link, its picture), at ${caught}`);
      }
    }
    expect([...failures, ...passedButAllowed, ...errors.map((e) => `${script.flow}: console error: ${e}`)]).toEqual([]);
  });
}
