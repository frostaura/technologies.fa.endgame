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

export function FailedState({
  error,
  message,
  onRetry,
  title = "This could not be loaded",
  className,
  children,
}: {
  /** The failed call: its message is shown. */
  error?: ApiError;
  /** Or the reason in words, when there is no call behind it. */
  message?: string;
  onRetry?: () => void;
  /** What failed, e.g. "The note was not saved". */
  title?: string;
  className?: string;
  /** Further actions beside "Try again". */
  children?: React.ReactNode;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-md bg-attention-tint p-6", className)}>
      <p className="font-display text-base font-semibold text-attention-text">{title}</p>
      <p className="text-sm text-ink">{message ?? error?.message}</p>
      {onRetry || children ? (
        <div className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
