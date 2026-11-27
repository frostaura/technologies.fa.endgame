import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A masonry of columns: as many columns as fit the container at `min` pixels each (never more than
 * `max`), and each item placed under whichever column is shortest so far — so a short division never
 * leaves a hole under it and a long one never runs alone far below the rest.
 *
 * Heights are measured once drawn (an item's height does not depend on which column it is in, since
 * every column is as wide as the others); until then `estimate` stands in, so the first frame is
 * already close to the last. Once every item is measured, the count and order are those whose columns end most nearly
 * level ({@link balancedLayout}): fewer columns, or the tallest placed first, when that closes a hole under one. That
 * layout then holds until the number of columns that fit, or the items or their `shape`, change — never because a
 * height drifted — so nothing moves under someone about to press it.
 */
export function useMasonry<T>(
  items: readonly T[],
  key: (item: T) => string,
  estimate: (item: T) => number,
  { min, gap, max, shape = () => "" }: { min: number; gap: number; max: number; shape?: (item: T) => string },
) {
  const container = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observed = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const [layout, setLayout] = useState<{ signature: string; count: number; tallFirst: boolean; used: Record<string, number> } | null>(null);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setHeights((was) => {
        let next = was;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.masonryItem;
          const h = Math.round((entry.target as HTMLElement).offsetHeight);
          if (id && was[id] !== h) next = { ...next, [id]: h };
        }
        return next;
      });
    });
    observer.current = ro;
    for (const el of observed.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The ref each item's wrapper takes, so its height is measured. */
  const measure = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      const was = observed.current.get(id);
      if (was && was !== el) observer.current?.unobserve(was);
      if (el) {
        el.dataset.masonryItem = id;
        observed.current.set(id, el);
        observer.current?.observe(el);
      } else observed.current.delete(id);
    },
    [],
  );

  const fit = width > 0 ? Math.floor((width + gap) / (min + gap)) : 1;
  const most = Math.max(1, Math.min(max, items.length, fit));
  const height = (item: T) => heights[key(item)] ?? estimate(item);
  // What the layout is decided for: how many columns fit, and the items and their shape.
  const signature = `${most}|${items.map((item) => `${key(item)}:${shape(item)}`).join(",")}`;
  const same = layout !== null && layout.signature === signature;
  let columns: T[][];
  let heightOf = height;
  if (items.every((item) => heights[key(item)] !== undefined)) {
    // Every item measured. The layout is decided again only when what it was decided for changed, or an item's height
    // moved by more than a line (a project came or went) — never for a drift, so a division does not jump column under the
    // reader's pointer. Within one signature the count only ever falls: fewer, wider columns draw each division shorter,
    // which must not argue for more columns again.
    const moved = !same || items.some((item) => Math.abs((layout.used[key(item)] ?? -1e6) - height(item)) > MATERIAL);
    const decided = moved ? { ...balancedLayout(items, same ? layout.count : most, height, gap), used: { ...heights } } : layout;
    if (moved) setLayout({ signature, ...decided });
    const used = (item: T) => decided.used[key(item)] ?? height(item);
    columns = placeInColumns(decided.tallFirst ? byHeight(items, used) : items, decided.count, used, gap);
    heightOf = height;
  } else {
    // The first frame, on estimates: every column that fits, in reading order.
    columns = placeInColumns(items, same ? layout.count : most, height, gap);
  }
  return { container, columns, measure, heightOf };
}

/**
 * Where each item sits: its column and its top, each column's items stacked with `gap` between them. Drawn as one grid of
 * 1 px rows with every item a direct child, so an item that changes column is moved, never drawn anew — nothing someone
 * is about to press is swapped for a copy, and nothing rises in twice.
 */
export function stack<T>(columns: T[][], height: (item: T) => number, gap: number): { item: T; column: number; top: number; height: number }[] {
  return columns.flatMap((column, c) => {
    let top = 0;
    return column.map((item) => {
      const h = Math.max(1, Math.round(height(item)));
      const at = { item, column: c, top, height: h };
      top += h + gap;
      return at;
    });
  });
}

/** A change in an item's height worth laying the columns out again for: more than a line or two of text. */
const MATERIAL = 48;

/** The tallest first, ties in their own order. */
function byHeight<T>(items: readonly T[], height: (item: T) => number): T[] {
  return items.map((item, i) => ({ item, i, h: height(item) })).sort((a, b) => b.h - a.h || a.i - b.i).map((x) => x.item);
}

/** How far the columns' feet are ragged: the tallest column's height above the mean, the hole the eye sees under the rest. */
export function raggedness(columns: number[]): number {
  if (columns.length === 0) return 0;
  return Math.max(...columns) - columns.reduce((a, b) => a + b, 0) / columns.length;
}

/** What a gap in raggedness is worth giving up a column, or the reading order, for. */
const WORTH = 80;

/**
 * The layout whose columns end most nearly level (console-desktop round one, real-stack 1): three divisions in three
 * columns leave a 600 px hole under the shortest, where two columns end within a few pixels of each other. In order of
 * preference — as many columns as fit, then the reading order — the first layout within {@link WORTH} of the most level.
 * Never fewer than two columns where two fit.
 */
export function balancedLayout<T>(items: readonly T[], most: number, height: (item: T) => number, gap = 0): { count: number; tallFirst: boolean } {
  const options: { count: number; tallFirst: boolean; ragged: number }[] = [];
  for (let count = most; count >= Math.min(2, most); count -= 1) {
    for (const tallFirst of [false, true]) {
      const columns = placeInColumns(tallFirst ? byHeight(items, height) : items, count, height, gap);
      const feet = columns.map((c) => c.reduce((sum, item, i) => sum + height(item) + (i > 0 ? gap : 0), 0));
      options.push({ count, tallFirst, ragged: raggedness(feet) });
    }
  }
  const level = Math.min(...options.map((o) => o.ragged));
  const pick = options.find((o) => o.ragged <= level + WORTH) ?? { count: most, tallFirst: false };
  return { count: pick.count, tallFirst: pick.tallFirst };
}

/** Each item, in order, under whichever of `count` columns is shortest so far (the leftmost on a tie). */
export function placeInColumns<T>(items: readonly T[], count: number, height: (item: T) => number, gap = 0): T[][] {
  const columns: T[][] = Array.from({ length: Math.max(1, count) }, () => []);
  const tall = new Array<number>(columns.length).fill(0);
  for (const item of items) {
    let at = 0;
    for (let i = 1; i < columns.length; i += 1) if ((tall[i] ?? 0) < (tall[at] ?? 0)) at = i;
    columns[at]?.push(item);
    tall[at] = (tall[at] ?? 0) + height(item) + gap;
  }
  return columns;
}
