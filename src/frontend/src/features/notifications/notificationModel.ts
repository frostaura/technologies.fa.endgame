import { paths } from "@/lib/router";
import { shortTitle } from "@/lib/plain";
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

/** A notification as the owner reads it: a short title, one line, and what kind of thing it is. */
export function notificationLines(n: NotificationItem): { kind: string; title: string; line: string | null } {
  return { kind: KIND[n.kind] ?? "Update", title: shortTitle(n.title, 90), line: meaningfulLine(n.detail, 140) };
}
