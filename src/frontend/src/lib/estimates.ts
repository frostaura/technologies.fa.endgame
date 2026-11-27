import type { Estimates } from "@/store/types";
import { formatNumber, plural } from "./format";

/**
 * How far off the estimates usually are, and which way (ARCH-004 `estimates`): the typical gap is the median, across
 * scored pieces, of (cost − estimate) / estimate. "Usually 84% under the estimate" means the work usually cost far less
 * than it was estimated at; "usually within 3%" that it landed close.
 */
export function estimateHeadline(e: Estimates): string {
  if (e.typicalGapPercent === null || e.typically === null) return `${formatNumber(e.withinPercent)}% came within 10%`;
  const gap = Math.round(Math.abs(e.typicalGapPercent));
  return e.typically === "within" ? `Usually within ${formatNumber(Math.max(1, gap))}%` : `Usually ${formatNumber(gap)}% ${e.typically} the estimate`;
}

/** The same, as a figure short enough for a figure tile ("53% under"); the sentence goes in its caption. */
export function estimateFigure(e: Estimates): string {
  if (e.typicalGapPercent === null || e.typically === null) return `${formatNumber(e.withinPercent)}%`;
  const gap = Math.round(Math.abs(e.typicalGapPercent));
  return e.typically === "within" ? `±${formatNumber(Math.max(1, gap))}%` : `${formatNumber(gap)}% ${e.typically}`;
}

/** How many pieces came close, and how many cost less or more than estimated. */
export function estimateSpread(e: Estimates): string {
  const close = Math.max(0, e.pieces - e.under - e.over);
  const landed = close === 0 ? "None came within 10% of its estimate" : `${formatNumber(close)} of ${plural(e.pieces, "piece")} came within 10% of the estimate`;
  return `${landed}; ${formatNumber(e.under)} cost less, ${formatNumber(e.over)} more.`;
}

/**
 * Below this many credits an estimate is too small to measure a run against: a percentage of it says nothing
 * ("217% of 0.05") and must never raise a red alarm (ARCH-011).
 */
export const ESTIMATE_FLOOR = 1;

/**
 * What a run, part or step has spent, set against its estimate — the one rule for every "Spent" figure:
 *
 * - finished work says "Spent", with no bar; work under way says "Spent so far", with a bar;
 * - against an estimate under {@link ESTIMATE_FLOOR}, no percentage and no bar: "Under 1 credit, as estimated",
 *   or, if it went past a credit, "Estimated under 1 credit";
 * - otherwise the true percentage ("130% of the 12 estimated"); the bar turns to the attention colour only above
 *   100% of a real estimate.
 */
export function spentAgainst(spent: number, estimate: number | null, finished: boolean): {
  label: "Spent" | "Spent so far";
  value: string;
  caption: string;
  meter: { value: number; label: string; tone: "primary" | "bad" } | null;
  over: boolean;
} {
  const label = finished ? "Spent" : "Spent so far";
  const value = formatNumber(spent);
  if (estimate === null) return { label, value, caption: "No estimate was made", meter: null, over: false };
  if (estimate < ESTIMATE_FLOOR)
    return { label, value, caption: spent < ESTIMATE_FLOOR ? "Under 1 credit, as estimated" : "Estimated under 1 credit", meter: null, over: false };
  const pct = Math.max(0, Math.round((spent / estimate) * 100));
  const over = pct > 100;
  const caption = `${pct}% of the ${formatNumber(estimate)} estimated`;
  return { label, value, caption, over, meter: finished ? null : { value: Math.min(100, pct), label: caption, tone: over ? "bad" : "primary" } };
}
