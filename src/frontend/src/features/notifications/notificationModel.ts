import { paths } from "@/lib/router";
import { plainDetail } from "@/lib/plain";
import type { NotificationItem } from "@/store/types";
import { meaningfulLine } from "../home/needsYouModel";

/** Where a notification takes the person: to what needs them. */
export function notificationHref(n: NotificationItem): string {
  const s = n.subject;
  if (s) {
    switch (s.kind) {
      case "idea":
        return paths.idea(s.id);
      case "run":
        return paths.run(s.id);
      case "hire":
        return paths.hire(s.id);
      case "app":
        return paths.app(s.id);
      case "employee":
        return paths.employee(s.id);
      case "topup_request":
        return paths.operator();
      default:
        break;
    }
  }
  if (n.kind.startsWith("budget") || n.kind.startsWith("credits") || n.kind.startsWith("overdraft")) return paths.credits();
  if (n.kind === "hire") return paths.hires(n.scope);
  return paths.notifications();
}

const KIND: Record<string, string> = {
  verdict: "Verdict",
  approval: "Approval",
  hire: "Hire",
  "budget.80": "Budget",
  "budget.cap": "Budget",
  "credits.zero": "Credits",
  "overdraft.half": "Overdraft",
  "overdraft.limit": "Overdraft",
  "app.crashed": "App",
  "security.finding": "Security",
  "topup.requested": "Top-up request",
};

/** A notification as the owner reads it: a short title, one line, what kind of thing it is, and its technical line. */
export function notificationLines(n: NotificationItem): { kind: string; title: string; line: string | null; technical: string | null } {
  const { detail, technical } = plainDetail(n.detail, n.technical);
  const line = meaningfulLine(detail, 2000);
  return { kind: KIND[n.kind] ?? "Update", title: noticeTitle(n.title), line: line ? excerpt(line, 150) : null, technical };
}

/** An expired approval's title (R3-2): the question is what is cut when it is long, never why it stopped waiting. */
const EXPIRED_TITLE = /^(No longer waiting: “)(.*)(” — the work ended before it was answered)$/;

function noticeTitle(title: string): string {
  const expired = EXPIRED_TITLE.exec(title);
  if (expired) return `${expired[1]}${excerpt(expired[2] ?? "", 60, false)}${expired[3]}`;
  return excerpt(title, 90);
}

/** The server's title for an approval its run closed before anyone answered it (`NotificationService`, R3-2). */
const NO_LONGER_WAITING = /^No longer waiting: /;

/**
 * What a settled notice is marked: "Answered", or "Closed" for an approval nobody answered because the work ended first —
 * it reads as settled, quietly, without claiming that anyone answered it.
 */
export function settledLabel(n: NotificationItem): string {
  return n.kind === "approval" && NO_LONGER_WAITING.test(n.title) ? "Closed" : "Answered";
}

/** How many notifications the feed shows at first beside every unread one, at every size, and how many more each "Show older" adds. */
export const PHONE_PAGE = 10;

/** What the feed shows, newest first: every unread notice, and the newest {@link PHONE_PAGE} plus `older` more. */
export function phoneShown<T extends { read: boolean; resolved: boolean; createdAt?: string }>(items: T[], older: number): T[] {
  const newest = PHONE_PAGE + older;
  const order = items.some((n) => n.createdAt) ? [...items].sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "")) : items;
  return order.filter((n, i) => i < newest || (!n.read && !n.resolved));
}

const OPENERS = new Set(["“", '"', "‘", "(", "«"]);
const CLOSES: Record<string, string> = { "“": "”", "‘": "’", "(": ")", "«": "»", '"': '"' };

/**
 * A run of text cut to at most `max` characters for a notice: at a word boundary, never inside a quotation
 * mark or a bracket it opened, and with "…" where it was cut (real-stack 23). Text the server already cut
 * ("…definition of sur...") loses its broken last word too. `closeQuote`: false when the text sits inside
 * quotation marks of its own, so an open quote is the caller's to close.
 */
export function excerpt(text: string, max: number, closeQuote = true): string {
  let clean = text.replace(/\s+/g, " ").trim();
  let cut = false;
  // The server's own cut: whatever was cut mid-word is dropped with it.
  if (/(\.{3}|…)$/.test(clean)) {
    clean = clean.replace(/(\.{3}|…)$/, "").replace(/\s*\S*$/, "").trim();
    cut = true;
  }
  if (clean.length > max) {
    const room = clean.slice(0, max);
    const space = room.lastIndexOf(" ");
    clean = space > max * 0.5 ? room.slice(0, space) : room;
    cut = true;
  }
  if (!cut) return clean;
  // Never end inside a quotation or bracket: go back to before the one left open.
  const open = unclosed(clean);
  if (open !== null && closeQuote) {
    const before = clean.slice(0, open).trimEnd();
    clean = before.length >= Math.min(24, max / 3) ? before : clean;
  }
  clean = clean.replace(/[\s,;:—–-]+$/, "").replace(/[.]+$/, "");
  return `${clean}…`;
}

/** Where the last quotation mark or bracket that is never closed opens, or null. */
function unclosed(text: string): number | null {
  const stack: { at: number; close: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    const top = stack[stack.length - 1];
    if (top && c === top.close) stack.pop();
    else if (OPENERS.has(c)) stack.push({ at: i, close: CLOSES[c] ?? c });
  }
  return stack.length > 0 ? (stack[0]?.at ?? null) : null;
}

/** The notices grouped by the day they came, newest day first, each newest first: "Today", "Yesterday", then the date. */
export function byDay<T extends { createdAt: string }>(items: readonly T[], now: Date = new Date()): { day: string; items: T[] }[] {
  const sorted = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = key(now);
  const yesterday = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: { day: string; items: T[] }[] = [];
  for (const item of sorted) {
    const at = new Date(item.createdAt);
    const k = key(at);
    const day = k === today ? "Today" : k === yesterday ? "Yesterday" : at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
