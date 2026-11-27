// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CROP, MAX, contains, cropFor, printedPoints, snap, type Box, type Line, type Scene } from "./print-crop.ts";

const viewport = { width: 1180, height: 760 };
const b = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });
const line = (x: number, y: number, width: number, font = 14): Line => ({ x, y, width, height: font * 1.4, font });
const scene = (over: Partial<Scene>): Scene => ({ viewport, target: null, ring: null, ancestors: [], dialog: null, main: null, lines: [], ...over });

describe("a step's print crop", () => {
  it("takes the whole card the ringed control sits in, with padding, not a fixed window around the ring", () => {
    const card = b(300, 200, 520, 300);
    const crop = cropFor(scene({ target: b(320, 420, 120, 36), ring: b(318, 418, 124, 40), ancestors: [{ box: b(320, 420, 120, 36), card: true }, { box: card, card: true }, { box: b(0, 0, 1180, 760), card: false }] }));
    expect(contains(crop.box, card)).toBe(true);
    expect(crop.box.x).toBe(card.x - CROP.pad);
    expect(crop.box.width).toBe(card.width + 2 * CROP.pad);
  });

  it("passes over a control-sized box (a bordered button) to the card around it", () => {
    const card = b(100, 100, 600, 200);
    const crop = cropFor(scene({ target: b(120, 250, 90, 32), ancestors: [{ box: b(120, 250, 90, 32), card: true }, { box: card, card: true }] }));
    expect(contains(crop.box, card)).toBe(true);
  });

  it("grows a small card to the minimum size, still inside the screen", () => {
    const crop = cropFor(scene({ target: b(1100, 700, 60, 40), ancestors: [{ box: b(1000, 680, 170, 70), card: true }] }));
    expect(crop.box.width).toBeGreaterThanOrEqual(CROP.minWidth);
    expect(crop.box.height).toBeGreaterThanOrEqual(CROP.minHeight);
    expect(crop.box.x + crop.box.width).toBeLessThanOrEqual(viewport.width);
    expect(crop.box.y + crop.box.height).toBeLessThanOrEqual(viewport.height);
  });

  it("windows a card too wide to print legibly around the ringed control, never wider than the page holds", () => {
    const target = b(980, 20, 140, 40);
    const crop = cropFor(scene({ target, ancestors: [{ box: b(0, 0, 1180, 80), card: true }] }));
    expect(crop.box.width).toBeLessThanOrEqual(MAX.width);
    expect(contains(crop.box, target)).toBe(true);
  });

  it("with no ring, takes the open dialog", () => {
    const dialog = b(320, 294, 760 - 320 + 300, 313);
    const crop = cropFor(scene({ dialog, main: b(0, 60, 1180, 700) }));
    expect(contains(crop.box, dialog)).toBe(true);
    expect(crop.box.width).toBeLessThanOrEqual(dialog.width + 2 * CROP.pad);
  });

  it("takes a dialog open over the ringed control, not the control under it", () => {
    const dialog = b(270, 248, 640, 264);
    const crop = cropFor(scene({ target: b(73, 624, 234, 48), ancestors: [{ box: b(73, 288, 444, 384), card: true }], dialog }));
    expect(contains(crop.box, dialog)).toBe(true);
    expect(crop.box.y).toBeGreaterThan(200);
  });

  it("never cuts a line of text: an edge across one moves to take it in or leave it out", () => {
    const card = b(300, 300, 400, 200);
    // A sentence in the next card, its first words inside the padding.
    const words = line(250, 240, 300);
    const crop = cropFor(scene({ target: b(320, 320, 100, 30), ancestors: [{ box: card, card: true }], lines: [words, line(320, 330, 200)] }));
    const cut = [words].filter((l) => l.x < crop.box.x + crop.box.width && l.x + l.width > crop.box.x && l.y < crop.box.y + crop.box.height && l.y + l.height > crop.box.y && !contains(crop.box, l));
    expect(cut).toEqual([]);
    expect(contains(crop.box, card)).toBe(true);
  });

  it("snap leaves out a long line rather than stretching across the screen, unless that would cut the card", () => {
    const keep = b(400, 300, 300, 100);
    const crop = snap(b(380, 280, 340, 140), [line(0, 270, 1100)], keep, 1180, 760);
    expect(crop.y).toBeGreaterThanOrEqual(270 + 14 * 1.4);
    expect(contains(crop, keep)).toBe(true);
  });

  it("reports the smallest text inside, and what it prints at", () => {
    const crop = cropFor(scene({ target: b(320, 320, 100, 30), ancestors: [{ box: b(300, 300, 500, 200), card: true }], lines: [line(320, 330, 100, 12), line(320, 380, 100, 16)] }));
    expect(crop.font).toBe(12);
    expect(printedPoints(12, crop.box.width)).toBeGreaterThanOrEqual(7);
    expect(printedPoints(12, MAX.width)).toBeGreaterThanOrEqual(6.95);
  });
});
