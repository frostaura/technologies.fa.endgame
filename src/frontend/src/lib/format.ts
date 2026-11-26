/** Plain-language numbers and times. One locale for the whole console, so figures read alike. */

const LOCALE = "en-GB";

/**
 * Whole numbers, except small fractional amounts (a model call can cost 1.5 credits), kept to one decimal. An amount
 * too small for one decimal is never shown as nothing: it keeps two ("0.05"), or reads "less than 0.01" (D12).
 */
export function formatNumber(n: number): string {
  const rounded = !Number.isInteger(n) && Math.abs(n) < 10 ? Math.round(n * 10) / 10 : Math.round(n);
  if (rounded === 0 && n > 0) {
    const hundredths = Math.round(n * 100) / 100;
    return hundredths === 0 ? "less than 0.01" : hundredths.toLocaleString(LOCALE);
  }
  // A tiny debt rounds to -0, which would read "-0 credits"; zero has no sign.
  return (rounded === 0 ? 0 : rounded).toLocaleString(LOCALE);
}

export function formatCredits(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? "credit" : "credits"}`;
}

/** The first letter in capitals: a requirement written as a clause reads as an item (D31). */
export function capitalise(text: string): string {
  const t = text.trimStart();
  return t.charAt(0).toUpperCase() + t.slice(1);
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
