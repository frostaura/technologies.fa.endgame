import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Icon } from "./Icon";
import type { IconName } from "./iconNames";

/** A grey placeholder the shape of what is loading, so nothing moves when it arrives. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-xs bg-shimmer motion-reduce:animate-none", className)} />;
}

/** The loading state of a whole region: announced once, drawn as skeletons. */
export function Loading({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-state="loading" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * A failed read, recorded on the page where the data would have been. Never shown as an empty
 * list, and never only as a toast.
 */
export function Failed({ title, reason, onRetry, className }: { title: string; reason: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" data-state="failed" className={cn("flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint p-5", className)}>
      <div className="flex items-start gap-3">
        <Icon name="verdict" className="mt-0.5 text-attention-text" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-attention-text">{title}</p>
          <p className="text-sm text-ink">{reason} Nothing here is known until it loads.</p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" className="self-start" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A later refresh failed; the data shown is the last that loaded. */
export function Stale({ reason, className }: { reason: string; className?: string }) {
  return (
    <p role="alert" data-state="stale" className={cn("rounded-xs bg-attention-tint px-4 py-3 text-sm text-attention-text", className)}>
      The latest refresh failed: {reason} What you see is from the last one that worked.
    </p>
  );
}

/** A genuinely empty result — the read worked and there is nothing. */
export function Empty({ icon, title, children, action, className }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div data-state="empty" className={cn("flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong bg-surface p-6", className)}>
      <Icon name={icon} tinted className="size-7" />
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="text-ink-body">{children}</div>}
      {action}
    </div>
  );
}

/** A bar that grows in when it first appears. */
export function Bar({ value, label, tone = "primary", live = false, className }: { value: number; label: string; tone?: "primary" | "soft" | "ink" | "success" | "attention"; live?: boolean; className?: string }) {
  const fill = { primary: "bg-primary", soft: "bg-primary-soft", ink: "bg-ink", success: "bg-success", attention: "bg-attention-text" }[tone];
  return (
    <div role="img" aria-label={label} className={cn("h-2 w-full overflow-hidden rounded-full bg-border", className)}>
      <div
        className={`h-full origin-left rounded-full motion-reduce:animate-none ${fill} ${live ? "animate-live bg-stripe" : "animate-grow"}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
