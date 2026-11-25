import { formatNumber } from "@/lib/format";
import type { RetryEstimate, TryAgainOffer } from "@/store/types";

export type StopReason = TryAgainOffer["why"];

/** Why the work stopped, said plainly, before the offer to start it again. */
export const STOPPED: Record<StopReason, string> = {
  budget: "The credit budget ran out, so this work stopped. What was finished is kept, and nothing more was charged.",
  cancelled: "This work was cancelled. What was finished is kept.",
  "plan-declined": "The plan was declined, so nothing was built.",
  failed: "This work stopped before it finished. What was finished is kept.",
};

/** What a try keeps, from its estimate: the parts already built and checked are neither built nor charged again. */
export function keptText(estimate: RetryEstimate): string {
  if (estimate.what === "research") return "Research starts again with the same idea, and you see the verdict before anything is built.";
  if (estimate.partsDone === null || estimate.parts === null) return "It is planned afresh, then built part by part.";
  if (estimate.partsDone === 0) return `The plan agreed before is kept, and all ${formatNumber(estimate.parts)} of its parts are built.`;
  return `${formatNumber(estimate.partsDone)} of its ${formatNumber(estimate.parts)} parts are already built and checked; they are kept, not built or charged again.`;
}
