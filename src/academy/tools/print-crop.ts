import { PRINT_SHOT, printMmPerPx } from "../src/theme/tokens.ts";

/**
 * Where a step's print picture is cut from the screen (`make academy-shots`): the whole component
 * the step points at, never a slice of it. `capture-shots.ts` reads the screen in the browser (the
 * ringed control, its ancestors, every line of text); this decides the rectangle, so the rules can
 * be tested without one.
 *
 * - The subject is what the step rings: the ringed control and the ring drawn around it.
 * - The crop is the nearest enclosing card of a reasonable size (a bordered, shadowed or filled box,
 *   a list item, a section, a dialog), plus padding, grown to a minimum so a small card keeps its
 *   surroundings, kept inside the screen.
 * - A card wider or taller than a page can print legibly is not taken whole: the crop is then the
 *   control with its surroundings.
 * - No line of text and no box is cut: an edge that crosses one moves in to leave it out, or, where
 *   that would cut the subject, out to take it in.
 * - With no ring, or a dialog open over the ringed control: the open dialog, else the page's main region from its top left, as much of it as
 *   prints legibly.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line of text on the screen, and its font size in CSS pixels. */
export interface Line extends Box {
  font: number;
}

export interface Scene {
  viewport: { width: number; height: number };
  /** The control the step rings (`[data-demo-ringed]`). */
  target: Box | null;
  /** The ring itself (`[data-demo-spotlight]`), which may be drawn around more than the control. */
  ring: Box | null;
  /** The target's ancestors, innermost first, and whether each reads as a card. */
  ancestors: { box: Box; card: boolean }[];
  /** An open dialog or sheet, topmost. */
  dialog: Box | null;
  /** The page's main region. */
  main: Box | null;
  lines: Line[];
  /** Every bordered or shadowed box on the screen (cards, fields, buttons): an edge never runs through one. */
  boxes?: Box[];
}

export interface Crop {
  box: Box;
  /** The smallest font, in CSS pixels, of the text wholly inside the crop (0 with none). */
  font: number;
}

export const CROP = {
  /** Breathing room around the card. */
  pad: 24,
  /** Never smaller than this: a small card keeps enough of its screen to be found again. */
  minWidth: 360,
  minHeight: 160,
  /** A card smaller than this is a control, not a component: the next card out is taken. */
  cardWidth: 160,
  cardHeight: 56,
  /** An edge takes in a line or box it crosses when that moves it no further than this; further, it leaves it out. */
  near: 96,
} as const;

/** The widest and tallest crop, in CSS pixels, whose smallest console text still prints at the minimum size across the page. */
export const MAX = { width: PRINT_SHOT.maxWidthPx, height: PRINT_SHOT.maxHeightPx } as const;

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const box = (x: number, y: number, r: number, b: number): Box => ({ x, y, width: r - x, height: b - y });

export function union(a: Box, b: Box): Box {
  return box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(right(a), right(b)), Math.max(bottom(a), bottom(b)));
}

export function contains(outer: Box, inner: Box, slack = 1): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack && right(inner) <= right(outer) + slack && bottom(inner) <= bottom(outer) + slack;
}

const intersects = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

function clampToScreen(b: Box, vw: number, vh: number): Box {
  const width = Math.min(b.width, vw);
  const height = Math.min(b.height, vh);
  return { x: Math.max(0, Math.min(vw - width, b.x)), y: Math.max(0, Math.min(vh - height, b.y)), width, height };
}

/** A span of `size` around `[from, to]`, centred on it unless `focus` must stay inside: then shifted just enough to hold it. */
function span(from: number, to: number, size: number, focus: [number, number]): [number, number] {
  let start = (from + to) / 2 - size / 2;
  if (focus[0] < start) start = focus[0] - CROP.pad;
  if (focus[1] > start + size) start = focus[1] + CROP.pad - size;
  return [start, start + size];
}

/**
 * Moves each edge that crosses a line of text or a box (a card, a field, a button) so nothing is cut:
 * in, to leave it out, when that does not cut into `keep`; else out, to take it in whole. A box that
 * runs past both opposite edges is the ground the crop sits on, and is not moved for.
 */
export function snap(crop: Box, lines: Line[], keep: Box, vw: number, vh: number, boxes: Box[] = []): Box {
  // Boxes first, then text: where the two disagree, a line of text is never the one cut.
  // Text last, and only ever left out (unless that cuts the subject): what the boxes took in stays, nothing more creeps in.
  const words = joinLines(lines);
  return snapText(boxes.length ? snapTo(crop, boxes, keep, vw, vh, true) : crop, words, keep, vw, vh);
}

/**
 * The last word on the edges: a line of text the crop cuts is left out, past whichever edge loses
 * the least picture — a line beside the subject by moving a side, one above or below it by moving
 * the top or the foot — or, where every way out would cut the subject, taken in whole.
 */
function snapText(crop: Box, lines: Line[], keep: Box, vw: number, vh: number): Box {
  let c = crop;
  const given = new Set<Line>();
  for (let round = 0; round < 24; round++) {
    const cut = lines.find((l) => !given.has(l) && intersects(c, l) && !contains(c, l, 0.5));
    if (!cut) break;
    const options: Box[] = [];
    if (bottom(cut) + 2 <= keep.y) options.push(box(c.x, bottom(cut) + 2, right(c), bottom(c)));
    if (cut.y - 2 >= bottom(keep)) options.push(box(c.x, c.y, right(c), cut.y - 2));
    if (right(cut) + 2 <= keep.x) options.push(box(right(cut) + 2, c.y, right(c), bottom(c)));
    if (cut.x - 2 >= right(keep)) options.push(box(c.x, c.y, cut.x - 2, bottom(c)));
    const fair = options.filter((o) => o.width > 0 && o.height > 0).sort((a, b) => b.width * b.height - a.width * a.height);
    // A line wider or taller than any crop, or running off the screen, cannot be taken in whole: it is let be.
    if (!fair[0] && (cut.width > MAX.width || cut.height > MAX.height || cut.x < 0 || cut.y < 0 || right(cut) > vw || bottom(cut) > vh)) {
      given.add(cut);
      continue;
    }
    c = fair[0] ?? box(Math.max(0, Math.min(c.x, cut.x - 4)), Math.max(0, Math.min(c.y, cut.y - 2)), Math.min(vw, Math.max(right(c), right(cut) + 4)), Math.min(vh, Math.max(bottom(c), bottom(cut) + 2)));
  }
  return c;
}

/** Words on one line set as separate pieces of text (a link, a breakable address) are one line: an edge may not fall between them. */
export function joinLines(lines: Line[]): Line[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Line[] = [];
  for (const l of sorted) {
    const same = out.find((o) => Math.abs(o.y + o.height / 2 - (l.y + l.height / 2)) < Math.min(o.height, l.height) / 2 && l.x <= right(o) + Math.max(8, l.font * 0.6) && right(l) >= o.x - Math.max(8, l.font * 0.6));
    if (same) {
      const u = union(same, l);
      Object.assign(same, u, { font: Math.min(same.font, l.font) });
    } else out.push({ ...l });
  }
  return out;
}

function snapTo(crop: Box, things: Box[], keep: Box, vw: number, vh: number, takeNear: boolean): Box {
  let [l, t, r, b] = [crop.x, crop.y, right(crop), bottom(crop)];
  /**
   * Out, to take the thing in, when that is a small step and the crop still prints legibly; else
   * in, to leave it out, unless that cuts the subject; else out after all.
   */
  const decide = (step: number, size: number, max: number, inAllowed: boolean, whole: boolean): "out" | "in" => (takeNear && whole && step <= CROP.near && size + step <= max) || !inAllowed ? "out" : "in";
  for (let round = 0; round < 12; round++) {
    let moved = false;
    const move = (next: number, edge: number) => {
      if (next !== edge) moved = true;
      return next;
    };
    for (const thing of things) {
      const [tl, tt, tr, tb] = [thing.x, thing.y, right(thing), bottom(thing)];
      if (!(tl < r && tr > l && tt < b && tb > t)) continue;
      // Too big to take in whole, or running off the screen: the ground the crop sits on.
      const tallGround = thing.height > MAX.height || tt < 0 || tb > vh;
      const wideGround = thing.width > MAX.width || tl < 0 || tr > vw;
      const [top, foot, left, end] = [tt < t && tb > t, tb > b && tt < b, tl < l && tr > l, tr > r && tl < r];
      // A thing cut across the other way cannot be shown whole: it is better left out.
      const wholeAcross = !wideGround && !(left && end);
      const wholeDown = !tallGround && !(top && foot);
      if (!tallGround && top && !foot) t = move(decide(t - tt + 4, b - t, MAX.height, tb + 2 <= keep.y, wholeAcross) === "out" ? Math.max(0, tt - 4) : tb + 2, t);
      if (!tallGround && foot && !top) b = move(decide(tb + 4 - b, b - t, MAX.height, tt - 2 >= bottom(keep), wholeAcross) === "out" ? Math.min(vh, tb + 4) : tt - 2, b);
      if (!wideGround && left && !end) l = move(decide(l - tl + 4, r - l, MAX.width, tr + 2 <= keep.x, wholeDown) === "out" ? Math.max(0, tl - 4) : tr + 2, l);
      if (!wideGround && end && !left) r = move(decide(tr + 4 - r, r - l, MAX.width, tl - 2 >= right(keep), wholeDown) === "out" ? Math.min(vw, tr + 4) : tl - 2, r);
    }
    if (!moved) break;
  }
  return box(Math.max(0, l), Math.max(0, t), Math.min(vw, r), Math.min(vh, b));
}

/** The card a step's picture is cut around: the innermost card of a reasonable size that holds the subject, when it fits on paper. */
export function cardFor(subject: Box, ancestors: Scene["ancestors"]): Box | null {
  const card = ancestors.find((a) => a.card && a.box.width >= CROP.cardWidth && a.box.height >= CROP.cardHeight && contains(a.box, subject));
  return card ? card.box : null;
}

export function cropFor(input: Scene): Crop {
  let scene = input;
  const { width: vw, height: vh } = scene.viewport;
  const screen = box(0, 0, vw, vh);
  const ringed = scene.target && scene.ring ? union(scene.target, scene.ring) : (scene.target ?? scene.ring);
  // A dialog open over the ringed control is what the screen shows: the dialog is the picture.
  const subject = ringed && scene.dialog && !contains(scene.dialog, ringed) ? null : ringed;
  const fits = (c: Box) => c.width <= MAX.width && c.height <= MAX.height;
  // Under a dialog the page is a dimmed backdrop: only what is inside the dialog keeps the crop's edges off it.
  if (scene.dialog && (!subject || contains(scene.dialog, subject))) {
    const dialog = scene.dialog;
    scene = { ...scene, lines: scene.lines.filter((l) => contains(dialog, l)), boxes: (scene.boxes ?? []).filter((x) => contains(dialog, x)) };
  }
  let focus: Box;
  if (subject) {
    // The card when it fits on paper; else the control itself, with its surroundings.
    // A card the screen's edge cuts is taken as far as it shows.
    const card = cardFor(subject, scene.ancestors);
    const shown = card ? clampToScreen(box(Math.max(0, card.x), Math.max(0, card.y), Math.min(vw, right(card)), Math.min(vh, bottom(card))), vw, vh) : null;
    focus = clampToScreen(shown && fits(shown) ? shown : subject, vw, vh);
  } else {
    // No ring: the open dialog; else the page from its top left, as much as prints legibly.
    let region = clampToScreen(scene.dialog ?? scene.main ?? screen, vw, vh);
    // A page too big to print whole whose words sit in a smaller block (a card centred on the screen): that block.
    const words = joinLines(scene.lines).filter((l) => contains(region, l));
    if (!fits(region) && words.length) {
      const text = words.reduce((u, l) => union(u, l), words[0] as Box);
      const held = (scene.boxes ?? []).filter((x) => contains(x, text) && contains(region, x) && fits(x)).sort((a, b) => a.width * a.height - b.width * b.height)[0];
      if (fits(held ?? text)) region = held ?? text;
    }
    focus = fits(region) ? region : box(region.x, region.y, region.x + Math.min(region.width, CROP.minWidth), region.y + Math.min(region.height, CROP.minHeight));
    if (!fits(region)) {
      const window = clampToScreen(box(region.x, region.y, region.x + MAX.width, region.y + MAX.height), vw, vh);
      return finish(window, focus, scene, vw, vh);
    }
  }
  // A subject wider or taller than prints legibly (a whole band, a whole panel): from where it starts,
  // as much as prints; only its first corner must stay whole, so what crosses the far edges is left out.
  const oversized = focus.width > MAX.width - 2 * CROP.pad || focus.height > MAX.height - 2 * CROP.pad;
  focus = box(focus.x, focus.y, focus.x + Math.min(focus.width, MAX.width - 2 * CROP.pad), focus.y + Math.min(focus.height, MAX.height - 2 * CROP.pad));
  const corner = box(focus.x, focus.y, focus.x + Math.min(focus.width, CROP.minWidth), focus.y + Math.min(focus.height, CROP.minHeight));
  const width = Math.min(MAX.width, vw, Math.max(CROP.minWidth, focus.width + 2 * CROP.pad));
  const height = Math.min(MAX.height, vh, Math.max(CROP.minHeight, focus.height + 2 * CROP.pad));
  const [x0, x1] = span(focus.x, right(focus), width, [focus.x, right(focus)]);
  const [y0, y1] = span(focus.y, bottom(focus), height, [focus.y, bottom(focus)]);
  return finish(clampToScreen(box(x0, y0, x1, y1), vw, vh), oversized ? corner : focus, scene, vw, vh);
}

function finish(placed: Box, focus: Box, scene: Scene, vw: number, vh: number): Crop {
  const keep = box(Math.max(placed.x, focus.x), Math.max(placed.y, focus.y), Math.min(right(placed), right(focus)), Math.min(bottom(placed), bottom(focus)));
  const snapped = snap(placed, scene.lines, keep, vw, vh, scene.boxes ?? []);
  const rounded = box(Math.floor(snapped.x), Math.floor(snapped.y), Math.ceil(right(snapped)), Math.ceil(bottom(snapped)));
  const inside = scene.lines.filter((l) => contains(rounded, l) && intersects(rounded, l) && l.font > 0);
  return { box: rounded, font: inside.length ? Math.min(...inside.map((l) => l.font)) : 0 };
}

/** The size, in points, that text of `font` CSS pixels prints at when a crop `width` pixels wide is set on the page. */
export function printedPoints(font: number, width: number): number {
  return (font * printMmPerPx(width, font) * 72) / 25.4;
}
