import type { Autonomy } from "@/store/types";

/** A checkpoint is in force only in checkpoints mode, and only when it is on. */
function stops(autonomy: Autonomy | null, checkpoint: "start" | "plan" | "hire"): boolean {
  return autonomy?.autonomy === "checkpoints" && autonomy.checkpoints[checkpoint]?.on === true;
}

/**
 * The steps after "Research this idea", said as the autonomy at the chosen place will do them: in
 * auto-mode a build or change verdict builds on its own and a hire within budget is made at once; in
 * checkpoints mode the verdict waits for the person, and each checkpoint that is on stops there.
 * With no organisation yet (first run) nothing is set, and auto-mode is the default.
 */
export function nextSteps(autonomy: Autonomy | null, division: string | null): [string, string][] {
  const auto = autonomy?.autonomy !== "checkpoints";
  return [
    [
      "Research",
      `Who already does this, what gap is left, who would want it.${stops(autonomy, "start") ? " It waits for your word once its estimate is known." : ""}`,
    ],
    [
      "Verdict",
      auto
        ? "Build, change, or do not build. A build or change verdict goes ahead on its own; a do-not-build waits for you, and you can overrule it."
        : "Build, change, or do not build. Nothing is built until you decide; you can overrule it.",
    ],
    ["A home for it", division ? `It goes in ${division}, as a project with its own name.` : "Endgame suggests a division and a name."],
    [
      "Hiring",
      stops(autonomy, "hire")
        ? "Each person this needs is proposed with a cost, and waits for you."
        : "The people this needs are hired as they are needed, inside the budget; one that does not fit waits for you.",
    ],
    [
      "Design, build, test, review",
      `On its own, inside your budget.${stops(autonomy, "plan") ? " The plan waits for you to agree it first." : ""} You can pause or stop it at any time.`,
    ],
    ["Running, privately", "Live at its own address, visible only to you until you share it."],
  ];
}

/** The line under the estimate: what is charged now, and whether a build follows without asking. */
export function researchPromise(autonomy: Autonomy | null): string {
  if (autonomy?.autonomy === "checkpoints") return "You are charged for research only. Nothing is built until you have seen the verdict and decided.";
  return "You are charged for research only now. If the verdict is to build, it is built on its own, inside the budget, with its own estimate first.";
}
