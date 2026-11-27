import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Hand, Info, PauseCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeTone } from "./badge";

/**
 * The status vocabulary as code (ARCH-011): the states pages get wrong, each with its one tone, its words and
 * its icon, so a page names the state and cannot pick the colour. Use {@link StatusTag} for a tag and
 * {@link Alert} with `state` for a panel.
 *
 * - Held by a budget is `warn` (amber, a pause), never the red crashed panel; its action raises the budget.
 * - An approval asked or answered is a hand, `info` while it waits and `neutral` once answered — never the
 *   danger shield.
 * - Cancelled, withdrawn and declined are `neutral` everywhere; a withdrawn hire carries no budget warning.
 * - Failed, crashed, down, refused are `bad`.
 */
export const STATES = {
  "paused-by-budget": { tone: "warn", label: "Paused by its budget", icon: PauseCircle },
  paused: { tone: "warn", label: "Paused", icon: PauseCircle },
  "waiting-for-budget": { tone: "warn", label: "Waiting for budget", icon: PauseCircle },
  "approval-asked": { tone: "info", label: "Asked for your approval", icon: Hand },
  "approval-answered": { tone: "neutral", label: "You answered", icon: Hand },
  cancelled: { tone: "neutral", label: "Cancelled", icon: Info },
  withdrawn: { tone: "neutral", label: "Withdrawn", icon: Info },
  declined: { tone: "neutral", label: "Declined", icon: Info },
  done: { tone: "good", label: "Done", icon: CircleCheck },
  failed: { tone: "bad", label: "Did not succeed", icon: CircleAlert },
  crashed: { tone: "bad", label: "Stopped", icon: CircleAlert },
} as const satisfies Record<string, { tone: BadgeTone; label: string; icon: LucideIcon }>;

export type StateName = keyof typeof STATES;

/** A state's tag, in its one tone, with its own words unless the page has more exact ones. */
export function StatusTag({ state, children, className }: { state: StateName; children?: ReactNode; className?: string }) {
  const s = STATES[state];
  return (
    <Badge tone={s.tone} className={className}>
      {children ?? s.label}
    </Badge>
  );
}

const PANEL: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface",
  info: "border-primary-line bg-primary-tint",
  good: "border-border bg-success-tint",
  warn: "border-border bg-warn-tint",
  bad: "border-attention-line bg-attention-tint",
};
const ICON_TONE: Record<BadgeTone, string> = {
  neutral: "text-ink-muted",
  info: "text-primary-hover",
  good: "text-success-text",
  warn: "text-warn-text",
  bad: "text-attention-text",
};
const DEFAULT_ICON: Record<BadgeTone, LucideIcon> = { neutral: Info, info: Info, good: CircleCheck, warn: PauseCircle, bad: CircleAlert };

/**
 * A panel that says what state something is in and what fixes it: an icon, a title, the explanation, and the
 * one action. `state` takes tone and icon from {@link STATES}; otherwise `tone` (default neutral).
 */
export function Alert({
  state,
  tone,
  title,
  children,
  action,
  role,
  className,
  testId,
}: {
  state?: StateName;
  tone?: BadgeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status" | "note";
  className?: string;
  testId?: string;
}) {
  const t: BadgeTone = state ? STATES[state].tone : (tone ?? "neutral");
  const Glyph = state ? STATES[state].icon : DEFAULT_ICON[t];
  return (
    <div role={role ?? (t === "bad" ? "alert" : "status")} data-tone={t} data-testid={testId} className={cn("flex flex-col gap-3 rounded-md border p-4 sm:p-5", PANEL[t], className)}>
      <div className="flex items-start gap-3">
        <Glyph aria-hidden className={cn("mt-0.5 size-5 shrink-0", ICON_TONE[t])} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold text-ink">{title}</p>
          {children && <div className="text-sm text-ink-body">{children}</div>}
        </div>
      </div>
      {action && <div className="flex flex-wrap gap-2 pl-8">{action}</div>}
    </div>
  );
}
