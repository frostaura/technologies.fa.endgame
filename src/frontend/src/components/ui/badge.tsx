import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The status tag. The vocabulary is closed (ARCH-011): five tones, and every status the console
 * shows maps to one of them.
 *
 * - `neutral` — a fact with no judgement: private, asleep, archived, to do, declined by you, not published.
 * - `info` — under way or a plain setting: working, building, researching, awake, shared, set here.
 * - `good` — finished well: healthy, done, passed its check, live, hired, added.
 * - `warn` — waits on a person or is held: waiting for you, paused, sent back, struggling, below zero.
 * - `bad` — failed or refused: did not succeed, down, stopped, refused, at its limit.
 *
 * A tag is one line: it never wraps, and a label too long for its room is cut with the whole of it
 * in the tooltip.
 */
const badgeVariants = cva("inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-quiet text-quiet-text",
      info: "bg-primary-tint text-primary-hover",
      good: "bg-success-tint text-success-text",
      warn: "bg-warn-tint text-warn-text",
      bad: "bg-attention-tint text-attention-text",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, title, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} title={title ?? (typeof children === "string" ? children : undefined)} {...props}>
      {typeof children === "string" ? <span className="truncate">{children}</span> : children}
    </span>
  );
}

export { badgeVariants };
