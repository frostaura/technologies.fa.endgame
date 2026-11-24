import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-ground text-ink-muted",
      quiet: "bg-quiet text-quiet-text",
      success: "bg-success-tint text-success-text",
      attention: "bg-attention-tint text-attention-text",
      "attention-strong": "bg-attention-chip text-attention-text",
      primary: "bg-primary-tint text-primary-hover",
      solid: "bg-primary text-primary-ink",
      violet: "bg-violet-tint text-violet-text",
      teal: "bg-teal-tint text-teal-text",
      white: "bg-surface text-attention-text",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
