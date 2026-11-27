import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A masonry of columns: as many columns as fit the container at `min` pixels each (never more than
 * `max`), and each item placed under whichever column is shortest so far — so a short division never
 * leaves a hole under it and a long one never runs alone far below the rest.
 *
 * Heights are measured once drawn (an item's height does not depend on which column it is in, since
 * every column is as wide as the others); until then `estimate` stands in, so the first frame is
 * already close to the last. Once every item is measured, the count and order are those whose columns end most nearly
 * level ({@link balancedLayout}): fewer columns, or the tallest placed first, when that closes a hole under one.
 */
export function useMasonry<T>(items: readonly T[], key: (item: T) => string, estimate: (item: T) => number, { min, gap, max }: { min: number; gap: number; max: number }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observed = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);
  const settled = useRef<{ signature: string; count: number } | null>(null);

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
  // Balance only on measured heights: an estimate is close enough to draw the first frame, not to give up a column.
  const measured = items.every((item) => heights[key(item)] !== undefined);
  const best = measured ? balancedLayout(items, most, height, gap) : { count: most, tallFirst: false };
  // Fewer, wider columns draw each division shorter, which could argue for more columns again: for one width and one set
  // of items the count only ever falls, so the layout settles instead of flipping between two answers.
  const signature = `${width}|${items.map(key).join(",")}`;
  const kept = settled.current;
  const count = kept && kept.signature === signature ? Math.min(kept.count, best.count) : best.count;
  settled.current = { signature, count };
  const tallFirst = count === best.count ? best.tallFirst : false;
  const columns = placeInColumns(tallFirst ? byHeight(items, height) : items, count, height, gap);
  return { container, columns, measure };
}

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
