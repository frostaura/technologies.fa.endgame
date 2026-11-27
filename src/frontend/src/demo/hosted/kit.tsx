/**
 * The app kit's primitives (`src/appkit/sdk-web/src/ui/*`), reproduced for the reading-list app.
 * The kit's package is not importable into the console's build (it ships from its own `dist`), so
 * these carry the kit's class strings unchanged; the kit's role names are a subset of the console's,
 * with the same values, so an app built on the kit and this one look the same.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const BUTTON_VARIANT = {
  primary: "bg-primary text-primary-ink hover:bg-primary-hover",
  outline: "border border-border-strong bg-surface text-ink hover:bg-ground",
  ghost: "text-ink hover:bg-ground",
} as const;
const BUTTON_SIZE = { sm: "h-11 px-3 sm:h-9", md: "h-11 px-4" } as const;

type ButtonLook = {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
};

function buttonClass(
  { variant = "primary", size = "md" }: ButtonLook,
  className?: string,
) {
  return cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
}

export function KitButton({
  variant,
  size,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size }, className)}
      {...props}
    />
  );
}

/** A link inside the app: a real address, followed by the demo instead of the browser. */
export function KitLink({
  href,
  onFollow,
  variant,
  size,
  plain = false,
  className,
  children,
  ...props
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> &
  ButtonLook & { href: string; onFollow: () => void; plain?: boolean }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onFollow();
      }}
      className={plain ? className : buttonClass({ variant, size }, className)}
      {...props}
    >
      {children}
    </a>
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md border bg-surface text-ink shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-base font-semibold leading-tight",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

const BADGE_TONE = {
  neutral: "bg-quiet text-quiet-text",
  info: "bg-primary-tint text-primary-hover",
  good: "bg-success-tint text-success-text",
  warn: "bg-warn-tint text-warn-text",
  bad: "bg-attention-tint text-attention-text",
  success: "bg-success-tint text-success-text",
  attention: "bg-attention-tint text-attention-text",
  primary: "bg-primary-tint text-primary-hover",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof BADGE_TONE }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-none",
        BADGE_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

const CONTROL =
  "w-full rounded-sm border border-border-field bg-surface px-3 text-base text-ink sm:text-sm placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        "h-11",
        invalid && "border-attention-text",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "h-11 w-auto pr-8", className)} {...props} />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-sm font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function FieldError({
  id,
  children,
}: {
  id: string;
  children?: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm text-attention-text">
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-state="empty"
      className={cn(
        "flex flex-col items-start gap-2 rounded-md border bg-surface p-6 sm:p-8",
        className,
      )}
    >
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children ? (
        <div className="max-w-prose text-ink-body">{children}</div>
      ) : null}
    </div>
  );
}

/** `NotFoundState`: the whole page when there is nothing at an address — what happened, then the way back. */
export function NotFoundState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-start justify-center py-8 sm:py-16">
      <div className="flex w-full max-w-form flex-col items-start gap-4 rounded-lg border bg-surface p-6 shadow-card sm:p-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        <div className="text-ink-body">{children}</div>
        <div className="pt-1 max-sm:w-full [&>*]:max-sm:w-full">{action}</div>
      </div>
    </div>
  );
}

export function FailedState({
  title,
  message,
  className,
}: {
  title: string;
  message: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      data-state="failed"
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border border-attention-text/20 bg-attention-tint p-6",
        className,
      )}
    >
      <p className="font-display text-base font-semibold text-attention-text">
        {title}
      </p>
      <p className="text-sm text-ink">{message}</p>
    </div>
  );
}
