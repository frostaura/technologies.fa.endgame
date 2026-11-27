import { formatNumber } from "@/lib/format";
import type { RetryEstimate, TryAgainOffer } from "@/store/types";

/** Why the work stopped: the idea's offer, or the run's own stop reason (`answer_cut_off`, R2-6). */
export type StopReason = TryAgainOffer["why"] | "cut-off";

/** The runner's stop reason for a model answer cut off at its limit twice. */
export const ANSWER_CUT_OFF = "answer_cut_off";

/** Why the work stopped, said plainly, before the offer to start it again. */
export const STOPPED: Record<StopReason, string> = {
  budget: "The credit budget ran out, so this work stopped. What was finished is kept, and nothing more was charged.",
  cancelled: "This work was cancelled. What was finished is kept.",
  "plan-declined": "The plan was declined, so nothing was built.",
  "start-declined": "You declined to start this at its estimate, so nothing was done and nothing was charged.",
  failed: "This work stopped before it finished. What was finished is kept.",
  "cut-off": "An answer the work needed was too long to finish, even when asked again with twice the room, so the work stopped. What was finished is kept.",
};

/** What a try keeps, from its estimate: the parts already built and checked are neither built nor charged again. */
export function keptText(estimate: RetryEstimate): string {
  if (estimate.what === "research") return "Research starts again with the same idea, and you see the verdict before anything is built.";
  if (estimate.partsDone === null || estimate.parts === null) return "It is planned afresh, then built part by part.";
  if (estimate.partsDone >= estimate.parts && estimate.parts > 0)
    return `Every part is built and checked. What is left is the security review and ${estimate.what === "change" ? "the new version" : "publishing"}.`;
  if (estimate.partsDone === 0) return `The plan agreed before is kept, and all ${formatNumber(estimate.parts)} of its parts are built.`;
  const kept = estimate.partsDone === 1 ? "is already built and checked; it is" : "are already built and checked; they are";
  return `${formatNumber(estimate.partsDone)} of its ${formatNumber(estimate.parts)} parts ${kept} kept, not built or charged again.`;
}
