import { describe, expect, it } from "vitest";
import { overlap, placeNote, ringBox, ringInsets, RING_PAD, type Box } from "./placement";

const view = { width: 1180, height: 760 };
const note = { width: 300, height: 40 };
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("the ring", () => {
  it("stands its full distance off a control with room around it", () => {
    expect(ringInsets(box(100, 100, 200, 120), [])).toEqual({ top: RING_PAD, right: RING_PAD, bottom: RING_PAD, left: RING_PAD });
  });

  it("sets its line in the gap when a neighbour's words come close, never over them", () => {
    const target = box(100, 100, 300, 116);
    const above = box(100, 80, 180, 96); // "Healthy", 4 px above
    const insets = ringInsets(target, [above, box(110, 102, 200, 114) /* its own words */]);
    expect(insets.top).toBe(1);
    const ring = ringBox(target, insets, view);
    expect(ring.top).toBeGreaterThanOrEqual(above.bottom);
    expect(insets.bottom).toBe(RING_PAD);
  });

  it("is kept inside the page for a control taller than it", () => {
    const ring = ringBox(box(20, -400, 600, 2400), ringInsets(box(20, -400, 600, 2400), []), view);
    expect(ring.top).toBeGreaterThanOrEqual(0);
    expect(ring.bottom).toBeLessThanOrEqual(view.height);
  });
});

describe("the note", () => {
  const at = (p: { left: number; top: number }) => box(p.left, p.top, p.left + note.width, p.top + note.height);

  it("goes below the ring when nothing is there", () => {
    const ring = box(100, 100, 300, 130);
    const p = placeNote(ring, note, view, []);
    expect(p.top).toBeGreaterThanOrEqual(ring.bottom);
    expect(overlap(at(p), ring)).toBe(0);
  });

  it("flips above when the next line and a button sit below", () => {
    const ring = box(100, 300, 500, 324);
    const below = [box(100, 330, 480, 350), box(100, 360, 180, 400)];
    const p = placeNote(ring, note, view, below);
    expect(p.top + note.height).toBeLessThanOrEqual(ring.top);
    for (const b of below) expect(overlap(at(p), b)).toBe(0);
  });

  it("goes beside the ring when words fill above and below", () => {
    const ring = box(100, 300, 400, 324);
    const lines = Array.from({ length: 20 }, (_, i) => box(100, 100 + i * 30, 400, 120 + i * 30)).filter((b) => overlap(b, ring) === 0);
    const p = placeNote(ring, note, view, lines);
    expect(overlap(at(p), ring)).toBe(0);
    for (const b of lines) expect(overlap(at(p), b)).toBe(0);
  });

  it("never leaves the page", () => {
    const p = placeNote(box(1100, 700, 1170, 740), note, view, []);
    expect(p.left + note.width).toBeLessThanOrEqual(view.width);
    expect(p.top + note.height).toBeLessThanOrEqual(view.height);
    expect(p.left).toBeGreaterThanOrEqual(0);
  });

  it("sits where it hides least when the ring fills the page", () => {
    const ring = box(2, 2, 1178, 758);
    const words = [box(10, 10, 1170, 300)];
    const p = placeNote(ring, note, view, words);
    expect(overlap(at(p), words[0] as Box)).toBe(0);
  });
});
