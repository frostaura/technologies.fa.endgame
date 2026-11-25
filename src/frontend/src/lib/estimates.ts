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

/** How many pieces came close, and how many cost less or more than estimated. */
export function estimateSpread(e: Estimates): string {
  const close = Math.max(0, e.pieces - e.under - e.over);
  const landed = close === 0 ? "None came within 10% of its estimate" : `${formatNumber(close)} of ${plural(e.pieces, "piece")} came within 10% of the estimate`;
  return `${landed}; ${formatNumber(e.under)} cost less, ${formatNumber(e.over)} more.`;
}
