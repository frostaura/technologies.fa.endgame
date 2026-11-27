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
    <div role="status" aria-live="polite" data-state="loading" className={cn("flex items-center gap-3 p-6 text-sm text-ink-muted", className)}>
      <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-primary motion-reduce:animate-none" />
      {label}
    </div>
  );
}

/**
 * A read that worked and found nothing: what is missing, a line on what to do, and the one action that fills it. A solid
 * card, never a dashed outline — a dashed box reads as a placeholder or a drop zone.
 */
export function EmptyState({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div data-state="empty" className={cn("flex flex-col items-start gap-2 rounded-md border bg-surface p-6 sm:p-8", className)}>
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children ? <div className="max-w-prose text-ink-body">{children}</div> : null}
      {action ? <div className="pt-2 max-sm:w-full [&>*]:max-sm:w-full">{action}</div> : null}
    </div>
  );
}

/**
 * The whole page when there is nothing at an address (the router's `*`, or a record that does not exist): what happened,
 * then where to go. `action` is the way onward — usually a link back to the first page.
 */
export function NotFoundState({
  title = "There is nothing at this address",
  children = "It may have been removed, or the address is wrong.",
  action,
  className,
}: {
  title?: string;
  children?: React.ReactNode;
  action: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 items-start justify-center py-8 sm:py-16", className)}>
      <div className="flex w-full max-w-form flex-col items-start gap-4 rounded-lg border bg-surface p-6 shadow-card sm:p-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
        <div className="text-ink-body">{children}</div>
        <div className="pt-1 max-sm:w-full [&>*]:max-sm:w-full">{action}</div>
      </div>
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
    <div role="alert" data-state="failed" className={cn("flex flex-col items-start gap-3 rounded-md border border-attention-text/20 bg-attention-tint p-6", className)}>
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
