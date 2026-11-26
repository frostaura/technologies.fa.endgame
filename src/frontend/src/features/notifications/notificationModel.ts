import { paths } from "@/lib/router";
import { plainDetail, shortTitle } from "@/lib/plain";
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
  return { kind: KIND[n.kind] ?? "Update", title: noticeTitle(n.title), line: meaningfulLine(detail, 140), technical };
}

/** An expired approval's title (R3-2): the question is what is cut when it is long, never why it stopped waiting. */
const EXPIRED_TITLE = /^(No longer waiting: “)(.*)(” — the work ended before it was answered)$/;

function noticeTitle(title: string): string {
  const expired = EXPIRED_TITLE.exec(title);
  if (expired) return `${expired[1]}${shortTitle(expired[2] ?? "", 60)}${expired[3]}`;
  return shortTitle(title, 90);
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
