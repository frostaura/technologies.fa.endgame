import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn.js";

/**
 * The status tag, in the console's closed vocabulary of five tones — so a status reads the same in every app:
 *
 * - `neutral` — a fact with no judgement: to do, private, not started, cancelled.
 * - `info` — under way or a plain setting: in progress, booked, open.
 * - `good` — finished well: done, confirmed, paid, packed.
 * - `warn` — waits on a person or is held: pending, waiting for you, full.
 * - `bad` — failed or refused: declined, overdue, failed.
 *
 * A tag is one line: it never wraps, and a label too long for its room is cut, with the whole of it in the tooltip. It is a
 * status, never an action — a button beside it does the action. (`success`, `attention` and `primary` are the older names
 * of `good`, `bad` and `info`.)
 */
const TONES = {
  neutral: "bg-quiet text-quiet-text",
  info: "bg-primary-tint text-primary-hover",
  good: "bg-success-tint text-success-text",
  warn: "bg-warn-tint text-warn-text",
  bad: "bg-attention-tint text-attention-text",
  success: "bg-success-tint text-success-text",
  attention: "bg-attention-tint text-attention-text",
  primary: "bg-primary-tint text-primary-hover",
} as const;

const badgeVariants = cva("inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none", {
  variants: { tone: TONES },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = keyof typeof TONES;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, title, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} title={title ?? (typeof children === "string" ? children : undefined)} {...props}>
      {typeof children === "string" ? <span className="truncate">{children}</span> : children}
    </span>
  );
}
