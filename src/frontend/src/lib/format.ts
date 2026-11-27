/** Plain-language numbers and times. One locale for the whole console, so figures read alike. */

const LOCALE = "en-GB";

/** The minus sign (U+2212), set tight to its digits: "−120", never "- 120" or a hyphen. */
export const MINUS = "\u2212";

/**
 * The one way a number of credits (or any count) is written (ARCH-011), everywhere — a tile, a table, a run's
 * step, a sentence:
 *
 * - 10 or more: whole, grouped — "1,840".
 * - under 10: up to two decimals, trailing zeros dropped — "7.47", "0.2", "1.5", "3".
 * - under a hundredth but more than nothing: "<0.01". A real cost never reads as nothing (D12).
 * - a debt: a true minus sign tight to the digits — "−120". A debt too small to show is "0": zero has no sign.
 */
export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.005) return n > 0 ? "<0.01" : "0";
  const rounded = abs >= 10 || Number.isInteger(n) ? Math.round(abs) : Math.round(abs * 100) / 100;
  if (rounded === 0) return "0";
  const text = rounded.toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  return n < 0 ? `${MINUS}${text}` : text;
}

/** "1 credit", "7.47 credits", "<0.01 credits": singular only when what is shown is exactly 1. */
export function formatCredits(n: number): string {
  const shown = formatNumber(n);
  return `${shown} ${shown === "1" ? "credit" : "credits"}`;
}

/** A change to a balance: "+3,000", "−120" (a top-up, a charge). */
export function signedNumber(n: number): string {
  const shown = formatNumber(n);
  return n > 0 && shown !== "0" ? `+${shown}` : shown;
}

/** A figure standing alone as a headline: the same rule as every other number (one precision rule, ARCH-011). */
export function headlineNumber(n: number): string {
  return formatNumber(n);
}

export function headlineCredits(n: number): string {
  return formatCredits(n);
}

/**
 * A usual, approximate cost said in a sentence ("usually about 0.5 credits"): the same rule, except that below a
 * tenth it reads "less than 0.1 credits" — an approximation is never more precise than it is, and never "about 0"
 * (D77).
 */
export function approxCredits(n: number): string {
  return n < 0.1 ? "less than 0.1 credits" : formatCredits(n);
}

/** The first letter in capitals: a requirement written as a clause reads as an item (D31). */
export function capitalise(text: string): string {
  const t = text.trimStart();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Credit amounts inside a sentence the server wrote, rounded as the console rounds them:
 * "277.323824 credits are left" reads "277 credits are left".
 */
export function tidyCreditAmounts(text: string): string {
  return text.replace(/(?<![\d.])(-?\d[\d,]*\.\d+)(?=\s+credits?\b)/g, (raw) => {
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? formatNumber(n) : raw;
  });
}

/** "Acme’s", and "Harbour Tutors’" for a name that already ends in s. */
export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name}’` : `${name}’s`;
}

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "just now", "5 minutes ago", "2 days ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.round(hours / 24);
  return `${plural(days, "day")} ago`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** A share as a whole percentage, as it is: 130 when the part is 30% more than the whole (D16). */
export function share(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.round((part / whole) * 100));
}

/** A share as a whole percentage, clamped for drawing a bar. */
export function percent(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/** A slug from a name: lowercase letters, digits and hyphens, 2 to 40 characters (ARCH-004). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug);
}
