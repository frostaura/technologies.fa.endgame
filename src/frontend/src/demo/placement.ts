/**
 * Where the academy's marks go (overlay.ts), as plain geometry so it can be tested: what the ring
 * surrounds (the whole card a step's words sit in, not one line of them), how far it stands off
 * it, how a page is scrolled to show it, and where the step's number sits on it. There is no note
 * in the console: the academy sets a step's words in a strip under its frame, and the number on the
 * ring is the same number that strip starts with.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The ring's line, in pixels: two of the accent and one light one outside it, so it shows on any ground (a blue band too). */
export const RING_LINE = 3;
/** How far the ring stands off what it surrounds when nothing is close by: room to breathe, never hugging the words. */
export const RING_PAD = 10;
/** The least it stands off, even between two cards close together. */
export const RING_MIN = 4;
/** The room kept between what a step shows and the edge of the view it is scrolled into. */
export const SNAP_MARGIN = 20;
/** The step's number on the ring: a small round badge on its top-left corner. */
export const MARKER = 24;

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const height = (b: Box) => b.bottom - b.top;
const width = (b: Box) => b.right - b.left;

export function overlap(a: Box, b: Box): number {
  return area(intersect(a, b));
}

export function intersect(a: Box, b: Box): Box {
  return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

/** How much of a box shows inside a view: 1 when all of it, 0 when none. */
export function shownFraction(box: Box, view: Box): number {
  const whole = area(box);
  return whole > 0 ? area(intersect(box, view)) / whole : 0;
}

/**
 * How far the ring stands off each side: `RING_PAD` when there is room, and where a neighbour's
 * words come closer, the ring's line is set in the middle of the gap so it never paints over them —
 * but never closer than `RING_MIN`, which keeps a line of breathing room around what is ringed.
 */
export function ringInsets(target: Box, content: Box[], pad = RING_PAD, line = RING_LINE): Insets {
  const fit = (gap: number) => Math.max(Math.min(RING_MIN, pad), Math.min(pad, Math.floor((gap - line) / 2)));
  let top = Infinity;
  let bottom = Infinity;
  let left = Infinity;
  let right = Infinity;
  const reach = pad + line;
  for (const c of content) {
    if (overlap(c, target) > 0) continue;
    const acrossX = c.right > target.left - reach && c.left < target.right + reach;
    const acrossY = c.bottom > target.top - reach && c.top < target.bottom + reach;
    if (acrossX && c.bottom <= target.top) top = Math.min(top, target.top - c.bottom);
    if (acrossX && c.top >= target.bottom) bottom = Math.min(bottom, c.top - target.bottom);
    if (acrossY && c.right <= target.left) left = Math.min(left, target.left - c.right);
    if (acrossY && c.left >= target.right) right = Math.min(right, c.left - target.right);
  }
  return { top: fit(top), right: fit(right), bottom: fit(bottom), left: fit(left) };
}

/** The ring's outer box: what it surrounds, its insets and the line. Not clipped: `clip` decides what of it shows. */
export function ringBox(target: Box, insets: Insets, line = RING_LINE): Box {
  return {
    left: target.left - insets.left - line,
    top: target.top - insets.top - line,
    right: target.right + insets.right + line,
    bottom: target.bottom + insets.bottom + line,
  };
}

/** A ring that would stand off a subject touching the view's edge is drawn just inside the edge instead, whole. */
export function keepInside(ring: Box, view: Box, line = 1): Box {
  return { left: Math.max(ring.left, view.left + line), top: Math.max(ring.top, view.top + line), right: Math.min(ring.right, view.right - line), bottom: Math.min(ring.bottom, view.bottom - line) };
}

/** One element on the way up from what a step names: its box, and whether it is drawn as a card (a border, a shadow, a ground of its own, or a list item). */
export interface Rung {
  box: Box;
  card: boolean;
}

/**
 * What the ring surrounds. A step's words name a heading, a label or a figure; what it teaches is
 * the tile or card they sit in, so the ring goes round the nearest card above them — while that
 * card stays a part of the view (at most `share` of its height), never the page or a whole column. With no such card, what was named, and a speck (a 6 px dot) grows to the
 * first thing around it big enough to see.
 */
export function chooseSubject(named: Box, chain: Rung[], view: Size, share = 0.62): Box {
  // A card may span the width (a phone's cards do); it may not take most of the height.
  const fits = (b: Box) => height(b) <= view.height * share && width(b) <= view.width + 1;
  for (const rung of chain) {
    if (!fits(rung.box)) break;
    if (rung.card) return rung.box;
  }
  if (width(named) >= 24 && height(named) >= 16) return named;
  for (const rung of chain) {
    if (!fits(rung.box)) break;
    if (width(rung.box) >= 24 && height(rung.box) >= 16) return rung.box;
  }
  return named;
}

/**
 * How far to scroll a view so a subject shows whole: not at all when it already does, with the
 * margin; else its top is set a margin under the view's top, so a card is read from its beginning
 * and nothing above it is sliced; and a subject taller than the view is set so that what was named
 * inside it is in view too.
 */
export function snapScroll(subject: Box, named: Box, view: Box, margin = SNAP_MARGIN): number {
  const roomy = { left: view.left, right: view.right, top: view.top + margin, bottom: view.bottom - margin };
  if (subject.top >= roomy.top && subject.bottom <= roomy.bottom) return 0;
  const by = subject.top - roomy.top;
  if (height(subject) <= height(roomy)) return by;
  // Taller than the view: its top, unless what was named would then be below the fold.
  return named.bottom - by > roomy.bottom ? named.top - roomy.top : by;
}

/** The step's number: on the ring's top-left corner, kept inside the view. */
export function markerAt(ring: Box, view: Box, size = MARKER): { left: number; top: number } {
  const left = Math.min(Math.max(ring.left - size / 2, view.left + 2), view.right - size - 2);
  const top = Math.min(Math.max(ring.top - size / 2, view.top + 2), view.bottom - size - 2);
  return { left, top };
}
