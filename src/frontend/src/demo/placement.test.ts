import { describe, expect, it } from "vitest";
import { chooseSubject, keepInside, markerAt, MARKER, ringBox, ringInsets, RING_MIN, RING_PAD, shownFraction, snapScroll, type Box } from "./placement";

const view = { width: 1280, height: 800 };
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("the ring", () => {
  it("stands its full distance off what it surrounds when there is room", () => {
    expect(ringInsets(box(100, 100, 200, 120), [])).toEqual({ top: RING_PAD, right: RING_PAD, bottom: RING_PAD, left: RING_PAD });
  });

  it("sets its line in the gap when a neighbour's words come close, never over them", () => {
    const target = box(100, 100, 300, 116);
    const above = box(100, 70, 180, 88); // a line 12 px above
    const insets = ringInsets(target, [above, box(110, 102, 200, 114) /* its own words */]);
    expect(insets.top).toBeLessThan(RING_PAD);
    const ring = ringBox(target, insets);
    expect(ring.top).toBeGreaterThanOrEqual(above.bottom);
    expect(insets.bottom).toBe(RING_PAD);
  });

  it("always keeps a little breathing room, even between cards close together", () => {
    const target = box(100, 100, 300, 160);
    expect(ringInsets(target, [box(100, 160 + 2, 300, 200)]).bottom).toBe(RING_MIN);
  });
});

describe("what the ring surrounds", () => {
  const named = box(120, 110, 260, 130); // a heading's line
  it("is the card a heading sits in, not the line of words", () => {
    const chain = [{ box: box(110, 100, 400, 140), card: false }, { box: box(100, 90, 420, 260), card: true }, { box: box(0, 0, 1280, 3000), card: false }];
    expect(chooseSubject(named, chain, view)).toEqual(box(100, 90, 420, 260));
  });

  it("never grows to a whole column or page", () => {
    const chain = [{ box: box(0, 60, 1280, 2000), card: true }];
    expect(chooseSubject(named, chain, view)).toEqual(named);
  });

  it("takes a card that spans a phone's width", () => {
    const phone = { width: 390, height: 640 };
    const card = box(0, 135, 390, 505);
    expect(chooseSubject(box(25, 240, 365, 272), [{ box: box(25, 240, 365, 332), card: false }, { box: card, card: true }], phone)).toEqual(card);
  });

  it("grows a speck (a 6 px dot) to the first thing around it big enough to see", () => {
    const dot = box(10, 10, 16, 16);
    const chain = [{ box: box(8, 8, 18, 18), card: false }, { box: box(0, 0, 400, 44), card: false }];
    expect(chooseSubject(dot, chain, view)).toEqual(box(0, 0, 400, 44));
  });
});

describe("scrolling a subject into view", () => {
  const v = box(0, 64, 1280, 800); // under a 64 px sticky header
  it("leaves a subject already in view, with room around it, where it is", () => {
    expect(snapScroll(box(0, 200, 400, 400), box(0, 210, 100, 230), v)).toBe(0);
  });

  it("snaps a card cut by the view's top to a margin under the header, never slicing it", () => {
    const by = snapScroll(box(0, 30, 400, 300), box(0, 40, 100, 60), v, 20);
    expect(30 - by).toBe(64 + 20);
  });

  it("brings a card below the fold up whole, its actions at its foot included", () => {
    const card = box(0, 700, 400, 960); // Approve and Decline at its foot
    const by = snapScroll(card, box(0, 710, 100, 730), v, 20);
    expect(card.bottom - by).toBeLessThanOrEqual(800 - 20);
    expect(card.top - by).toBeGreaterThanOrEqual(64);
  });

  it("keeps what was named in view inside a subject taller than the view", () => {
    const tall = box(0, 100, 400, 2000);
    const named = box(0, 1500, 100, 1520);
    const by = snapScroll(tall, named, v, 20);
    expect(named.top - by).toBeGreaterThanOrEqual(64);
    expect(named.bottom - by).toBeLessThanOrEqual(800);
  });
});

describe("the step's number and what shows", () => {
  it("draws a ring round a card at the view's edge just inside it", () => {
    expect(keepInside(box(-13, 100, 403, 300), box(0, 0, 390, 640))).toEqual(box(1, 100, 389, 300));
  });

  it("sits on the ring's corner, inside the view", () => {
    expect(markerAt(box(100, 100, 300, 200), box(0, 0, 1280, 800))).toEqual({ left: 100 - MARKER / 2, top: 100 - MARKER / 2 });
    const at = markerAt(box(0, 0, 300, 200), box(0, 0, 1280, 800));
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });

  it("measures how much of a box is in view", () => {
    expect(shownFraction(box(0, 0, 100, 100), box(0, 50, 100, 200))).toBeCloseTo(0.5);
    expect(shownFraction(box(0, 0, 100, 100), box(0, 0, 1280, 800))).toBe(1);
  });
});
