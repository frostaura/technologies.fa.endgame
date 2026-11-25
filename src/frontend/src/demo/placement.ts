/**
 * Where the academy's marks go (overlay.ts), as plain geometry so it can be tested: how far the
 * ring stands off the control it surrounds, and where the note beside it is set so it covers
 * neither the control nor the words around it.
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

/** The ring's line, in pixels. */
export const RING_LINE = 2;
/** How far the ring stands off its control when nothing is close by. */
export const RING_PAD = 6;
/** The space between the ring and the note. */
export const NOTE_GAP = 10;
/** The space kept between a mark and the edge of the page. */
export const EDGE = 8;

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

export function overlap(a: Box, b: Box): number {
  return area({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
}

/**
 * How far the ring stands off each side of the control: `RING_PAD` when there is room, and where a
 * neighbour's words come closer (the line above, a label beside it), the ring's line is set in the
 * middle of the gap so it never paints over them.
 */
export function ringInsets(target: Box, content: Box[], pad = RING_PAD, line = RING_LINE): Insets {
  const fit = (gap: number) => Math.max(0, Math.min(pad, Math.floor((gap - line) / 2)));
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

/** The ring's outer box: the control, its insets and the line, kept inside the page. */
export function ringBox(target: Box, insets: Insets, view: Size, line = RING_LINE): Box {
  return {
    left: Math.max(2, target.left - insets.left - line),
    top: Math.max(2, target.top - insets.top - line),
    right: Math.min(view.width - 2, target.right + insets.right + line),
    bottom: Math.min(view.height - 2, target.bottom + insets.bottom + line),
  };
}

interface Candidate {
  left: number;
  top: number;
  rank: number;
}

/**
 * Where the note goes. Below the ring, else above it, else beside it — whichever covers least of
 * the page's words and controls, and never the ring itself while there is anywhere else to go. Only
 * a control taller than the page leaves no room outside it; then the note sits where it hides least.
 */
export function placeNote(ring: Box, note: Size, view: Size, content: Box[], gap = NOTE_GAP): { left: number; top: number; score: number } {
  const { width: w, height: h } = note;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, view.width - EDGE - w));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, view.height - EDGE - h));
  const xs = [ring.left, ring.right - w, (ring.left + ring.right - w) / 2];
  const ys = [ring.top, (ring.top + ring.bottom - h) / 2, ring.bottom - h];
  const candidates: Candidate[] = [];
  const add = (left: number, top: number, rank: number) => candidates.push({ left, top, rank });
  xs.forEach((x, i) => add(clampX(x), ring.bottom + gap, i));
  xs.forEach((x, i) => add(clampX(x), ring.top - gap - h, 10 + i));
  ys.forEach((y, i) => add(ring.right + gap, clampY(y), 20 + i));
  ys.forEach((y, i) => add(ring.left - gap - w, clampY(y), 30 + i));
  // Anywhere on the page: only for a control that leaves no room around it.
  for (let y = EDGE; y + h <= view.height - EDGE; y += 24) for (let x = EDGE; x + w <= view.width - EDGE; x += 40) add(x, y, 100);

  let best = { left: clampX(ring.left), top: clampY(ring.bottom + gap), score: Infinity };
  for (const c of candidates) {
    if (c.left < EDGE - 0.5 || c.top < EDGE - 0.5 || c.left + w > view.width - EDGE + 0.5 || c.top + h > view.height - EDGE + 0.5) continue;
    const score = noteCost(ring, note, content, c.left, c.top, c.rank, gap);
    if (score < best.score) best = { left: c.left, top: c.top, score };
  }
  return best;
}

/**
 * What setting the note at (left, top) costs: beside the ring is preferred a little; a free spot
 * elsewhere wins over hiding a line of words, and the nearer the better. Covering words costs their
 * area; covering the ring costs more than anything else.
 */
export function noteCost(ring: Box, note: Size, content: Box[], left: number, top: number, rank = 100, gap = NOTE_GAP): number {
  const box = { left, top, right: left + note.width, bottom: top + note.height };
  const away = Math.hypot(Math.max(0, ring.left - box.right, box.left - ring.right), Math.max(0, ring.top - box.bottom, box.top - ring.bottom));
  let score = rank < 100 ? rank * 2 : 200 + 2 * away;
  const onRing = overlap(box, { left: ring.left - gap / 2, top: ring.top - gap / 2, right: ring.right + gap / 2, bottom: ring.bottom + gap / 2 });
  if (onRing > 0) score += 1_000_000 + onRing;
  for (const b of content) score += overlap(box, b);
  return score;
}
