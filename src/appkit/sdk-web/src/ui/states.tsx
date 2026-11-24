import * as React from "react";
import { Button } from "./button.js";
import { cn } from "./cn.js";
import type { ApiError } from "../errors.js";

/**
 * The three states of every read, each looking different on purpose. Use them for any
 * `useApiQuery` result: `LoadingState` while loading, `FailedState` when it failed, and
 * `EmptyState` only when it loaded and there is truly nothing.
 */
export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center gap-3 p-6 text-sm text-ink-muted", className)}>
      <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-md border border-dashed bg-surface p-6", className)}>
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {children ? <div className="text-sm text-ink-muted">{children}</div> : null}
    </div>
  );
}

export function FailedState({ error, onRetry, className }: { error: ApiError; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-md bg-attention-tint p-6", className)}>
      <p className="font-display text-base font-semibold text-attention-text">This could not be loaded</p>
      <p className="text-sm text-ink">{error.message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
