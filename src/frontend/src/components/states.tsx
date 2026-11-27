import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { paths } from "@/lib/router";
import { Button, buttonVariants } from "./ui/button";
import { Link } from "./Link";
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
 *
 * `status` is the read's HTTP status, when it had one. A refusal (401, 403) or a not-found (404) is
 * an answer rather than a read that broke, so its reason is the whole message and it never offers a
 * retry that would only answer the same (R2-1): it offers the way back to the org chart instead, or
 * nothing where the page's own navigation already serves (`back={false}`: the org chart itself, a
 * panel inside a page).
 */
export function Failed({
  title,
  reason,
  onRetry,
  status,
  unknown = "Nothing here is known until it loads.",
  back = true,
  className,
}: {
  title: string;
  reason: string;
  onRetry?: () => void;
  status?: number | null;
  /** What a failed read leaves unknown; said only when the failure is not an answer (401, 403, 404). */
  unknown?: string;
  /** Whether an answered failure offers "Back to the org chart"; false where the page's own navigation serves. */
  back?: boolean;
  className?: string;
}) {
  const answered = status === 404 || status === 401 || status === 403;
  // A whole page that is not there, or not this person's, is the not-found page: one design for both (ARCH-011).
  if (answered && back)
    return (
      <div role="alert" data-state="failed" className={cn("flex flex-1 flex-col", className)}>
        <NotFoundPage title={title}>{reason}</NotFoundPage>
      </div>
    );
  return (
    <div role="alert" data-state="failed" className={cn("flex flex-col gap-3 rounded-md border border-attention-line bg-attention-tint p-5", className)}>
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-attention-text" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold text-attention-text">{title}</p>
          <p className="text-sm text-ink">{answered ? reason : `${reason} ${unknown}`}</p>
        </div>
      </div>
      {answered ? (
        back && <Link href={paths.home()} className={cn(buttonVariants({ size: "sm" }), "self-start")}>
          Back to the org chart
        </Link>
      ) : (
        onRetry && (
          <Button size="sm" className="self-start" onClick={onRetry}>
            Try again
          </Button>
        )
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

/**
 * A genuinely empty result — the read worked and there is nothing. Quiet text and the one thing to do
 * next: no box, and never a dashed outline (a dashed outline is a drop zone).
 */
export function Empty({ icon, title, children, action, className }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div data-state="empty" className={cn("flex max-w-prose flex-col items-start gap-2 py-2", className)}>
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Icon name={icon} className="size-5 text-ink-muted" />
        {title}
      </p>
      {children && <div className="text-ink-body">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** Something is being worked out: a spinner and the words, never a greyed button. */
export function Working({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={cn("flex items-center gap-2 text-ink-body", className)}>
      <Spinner />
      {children}
    </p>
  );
}

/** `inherit`: drawn in the text's own colour, for inside a button that is working ("Working it out…"). */
export function Spinner({ className, inherit = false }: { className?: string; inherit?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-4 shrink-0 animate-spin rounded-full border-2 motion-reduce:animate-none",
        inherit ? "border-current border-t-transparent" : "border-border-strong border-t-primary",
        className,
      )}
    />
  );
}

/**
 * A page that is not there, or not yours to see: it fills the frame with what happened, what to do,
 * and the places to go instead. The console's own not-found and every page's answered failure share it.
 */
export function NotFoundPage({ title, children, links }: { title: string; children: ReactNode; links?: { label: string; href: string }[] }) {
  const to = links ?? [
    { label: "Back to the org chart", href: paths.home() },
    { label: "Notifications", href: paths.notifications() },
    { label: "Credits", href: paths.credits() },
  ];
  return (
    <section aria-label={title} className="flex flex-1 items-center justify-center py-10">
      <div className="flex w-full max-w-form flex-col items-start gap-4 rounded-lg border bg-surface px-8 py-10 shadow-card max-sm:px-5 max-sm:py-7">
        <img src="/brand/endgame-mark.svg" alt="" width={40} height={40} className="size-10" />
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight max-sm:text-2xl">{title}</h1>
        <div className="text-ink-body">{children}</div>
        <nav aria-label="Where to go instead" className="flex flex-wrap gap-2 pt-1">
          {to.map((l, i) => (
            <Link key={l.href} href={l.href} className={buttonVariants({ variant: i === 0 ? "primary" : "soft" })}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
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
