import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * A masonry of columns: as many columns as fit the container at `min` pixels each (never more than
 * `max`), and each item placed under whichever column is shortest so far — so a short division never
 * leaves a hole under it and a long one never runs alone far below the rest.
 *
 * Heights are measured once drawn (an item's height does not depend on which column it is in, since
 * every column is as wide as the others); until then `estimate` stands in, so the first frame is
 * already close to the last.
 */
export function useMasonry<T>(items: readonly T[], key: (item: T) => string, estimate: (item: T) => number, { min, gap, max }: { min: number; gap: number; max: number }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observed = useRef(new Map<string, HTMLElement>());
  const observer = useRef<ResizeObserver | null>(null);

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
  const count = Math.max(1, Math.min(max, items.length, fit));
  const columns = placeInColumns(items, count, (item) => heights[key(item)] ?? estimate(item), gap);
  return { container, columns, measure };
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
