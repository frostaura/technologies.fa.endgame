/**
 * Dates and numbers, as people read them, without ever throwing (AGENTS.md, "Dates and numbers").
 *
 * `Intl.DateTimeFormat(...).format(date)` and `date.toLocaleString()` throw `RangeError: Invalid time value` on an invalid
 * date, and a browser lets plenty through: a `datetime-local` field takes a six-digit year ("202612-12-12T08:00") typed into
 * its year segment. A throw while a page renders unmounts it — a built app's "Add a dive" page went blank on exactly that
 * (R7-1). These helpers answer a stated fallback instead, and the `check*Input` helpers turn what a person typed into a
 * value or a field error before it is sent.
 */

/** What every date helper accepts: an ISO string, an input's value, a `Date`, epoch milliseconds, or nothing yet. */
export type DateLike = string | number | Date | null | undefined;

export interface DateFormatOptions {
  /** What to show when there is no usable date. Defaults to "No date yet". */
  fallback?: string;
  /** Defaults to the reader's own. */
  locale?: string;
  /** Defaults to the reader's own. */
  timeZone?: string;
}

export interface NumberFormatOptions extends Intl.NumberFormatOptions {
  /** What to show when there is no usable number. Defaults to "No number yet". */
  fallback?: string;
  locale?: string;
}

const NO_DATE = "No date yet";
const NO_NUMBER = "No number yet";

/** An input's own value: `2026-12-12`, `2026-12-12T08:00`, `2026-12-12T08:00:30.5` — local time, no zone. */
const INPUT_VALUE = /^(\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** An instant as an API writes it: `2026-12-12T08:00:00Z`, `2026-12-12T08:00:00.1234567+02:00`. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The input value as the local time a person typed, or null when it names no real day (31 February, year 0, year 10000+). */
function fromInputValue(text: string): Date | null {
  const parts = INPUT_VALUE.exec(text);
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1).map((p) => (p === undefined ? 0 : Number(p))) as [number, number, number, number, number, number];
  if (year < 1 || year > 9999) return null;
  const date = new Date(2000, month - 1, day, hour, minute, second);
  // new Date(y, …) reads 0–99 as 1900–1999: set the year itself.
  date.setFullYear(year);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute ? date : null;
}

/** A usable date — a real day in years 1 to 9999 — or null. Never throws. */
export function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined) return null;
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else {
    const text = value.trim();
    if (!text) return null;
    if (INPUT_VALUE.test(text)) return fromInputValue(text);
    // Anything else must be an ISO date and time with its zone, as an API answers: a browser's own parsing reads "-12-12"
    // as a day in 2001.
    if (!ISO_WITH_ZONE.test(text)) return null;
    date = new Date(text);
  }
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const year = date.getFullYear();
  return year >= 1 && year <= 9999 ? date : null;
}

function formatWith(value: DateLike, options: DateFormatOptions, style: Intl.DateTimeFormatOptions): string {
  const fallback = options.fallback ?? NO_DATE;
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(options.locale, { ...style, timeZone: options.timeZone }).format(date);
  } catch {
    return fallback;
  }
}

/** "12 Dec 2026, 08:00" in the reader's own words; the fallback ("No date yet") for anything that is not a usable date. */
export function formatDateTime(value: DateLike, options: DateFormatOptions = {}): string {
  return formatWith(value, options, { dateStyle: "medium", timeStyle: "short" });
}

/** "12 Dec 2026"; the fallback ("No date yet") for anything that is not a usable date. */
export function formatDate(value: DateLike, options: DateFormatOptions = {}): string {
  return formatWith(value, options, { dateStyle: "medium" });
}

/** A finite number (or a numeric string), grouped as the reader reads it; the fallback ("No number yet") otherwise. */
export function formatNumber(value: number | string | null | undefined, options: NumberFormatOptions = {}): string {
  const { fallback = NO_NUMBER, locale, ...style } = options;
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  try {
    return new Intl.NumberFormat(locale, style).format(number);
  } catch {
    return fallback;
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A `Date` as an input's own value — `date` (`2026-12-12`) or `datetime-local` (`2026-12-12T08:05`) — for `min`, `max` or a default. */
export function dateInputValue(date: Date, kind: "date" | "datetime-local"): string {
  if (!Number.isFinite(date.getTime())) return "";
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return kind === "date" ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface DateInputLimits {
  /** The input's own `min` (same form as its value). */
  min?: string;
  /** The input's own `max`. */
  max?: string;
  required?: boolean;
  /** For the dates named in the error. */
  locale?: string;
}

/**
 * What a person typed into a `date` or `datetime-local` field, checked before it is sent: the date, or the field's error in
 * plain words. Give it the same `min` and `max` as the input: a browser does not stop a person typing past them.
 */
export function checkDateInput(value: string, limits: DateInputLimits = {}): { date: Date | null; error: string | null } {
  const text = value.trim();
  if (!text) return { date: null, error: limits.required ? "Enter a date." : null };
  const min = toDate(limits.min);
  const max = toDate(limits.max);
  const named = (d: Date) => formatDate(d, { locale: limits.locale });
  const range =
    min && max ? `Enter a date between ${named(min)} and ${named(max)}.` : min ? `Enter a date on or after ${named(min)}.` : max ? `Enter a date on or before ${named(max)}.` : null;
  const parts = INPUT_VALUE.exec(text);
  // A year outside 1–9999 is a real-looking value no formatter can show: outside the limits when there are some.
  if (parts && (Number(parts[1]) > 9999 || Number(parts[1]) < 1)) return { date: null, error: range ?? "Enter a real date." };
  const date = parts ? fromInputValue(text) : null;
  if (!date) return { date: null, error: "Enter a real date." };
  if ((min && date < min) || (max && date > max)) return { date: null, error: range };
  return { date, error: null };
}

export interface NumberInputLimits {
  min?: number;
  max?: number;
  required?: boolean;
  /** Only whole numbers. */
  whole?: boolean;
  locale?: string;
}

/** What a person typed into a `number` field, checked before it is sent: the number, or the field's error in plain words. */
export function checkNumberInput(value: string, limits: NumberInputLimits = {}): { value: number | null; error: string | null } {
  const text = value.trim();
  if (!text) return { value: null, error: limits.required ? "Enter a number." : null };
  const number = Number(text);
  if (!Number.isFinite(number)) return { value: null, error: "Enter a number." };
  if (limits.whole && !Number.isInteger(number)) return { value: null, error: "Enter a whole number." };
  const { min, max } = limits;
  const named = (n: number) => formatNumber(n, { locale: limits.locale });
  if ((min !== undefined && number < min) || (max !== undefined && number > max)) {
    const error = min !== undefined && max !== undefined ? `Enter a number from ${named(min)} to ${named(max)}.` : min !== undefined ? `Enter a number of at least ${named(min)}.` : `Enter a number of at most ${named(max ?? 0)}.`;
    return { value: null, error };
  }
  return { value: number, error: null };
}
