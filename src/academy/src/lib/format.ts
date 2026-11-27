/** A day as the learner reads it: "26 Nov". */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "1 flow", "12 flows". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A percentage as it reads: "<1%" for a start too small to round up, never a misleading "0%". */
export function percent(done: number, total: number): string {
  if (!total || !done) return "0%";
  const pct = (100 * done) / total;
  return pct < 1 ? "<1%" : `${Math.floor(pct)}%`;
}
