import type { DecisionChoice, Verdict } from "@/store/types";

export interface Option {
  choice: DecisionChoice;
  label: string;
  variant: "primary" | "outline" | "ghost";
}

/** The three decisions the verdict allows. Building against a "change" or "do not build" is an overrule, and is recorded as one. */
export function decisionOptions(verdict: Verdict): Option[] {
  const change = verdict.wouldChange?.changeLabel ? `Change it: ${verdict.wouldChange.changeLabel}` : "Change it as suggested";
  if (verdict.outcome === "build") {
    return [
      { choice: "build", label: "Build it", variant: "primary" },
      ...(verdict.wouldChange ? [{ choice: "change" as const, label: change, variant: "outline" as const }] : []),
      { choice: "drop", label: "Drop the idea", variant: "ghost" },
    ];
  }
  return [
    ...(verdict.wouldChange ? [{ choice: "change" as const, label: change, variant: "primary" as const }] : []),
    { choice: "overrule", label: verdict.outcome === "change" ? "Overrule and build it as described" : "Overrule and build anyway", variant: verdict.wouldChange ? "outline" : "primary" },
    { choice: "drop", label: "Drop the idea", variant: "ghost" },
  ];
}
