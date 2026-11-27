import * as React from "react";
import { cn } from "./cn.js";

/**
 * A phone zooms into a box set under 16px when it takes the focus: on a phone the text is 16px. The edge is
 * `border-field`, 3:1 against the surface and the ground (WCAG 1.4.11), so a person sees where to type.
 */
const control =
  "w-full rounded-sm border border-border-field bg-surface px-3 text-base text-ink sm:text-sm placeholder:text-ink-muted hover:border-ink-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50";

/** `invalid` marks the control for sighted users and screen readers alike. */
type Invalid = { invalid?: boolean };

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & Invalid>(
  ({ className, invalid, ...props }, ref) => (
    <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11", invalid && "border-attention-text", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid>(
  ({ className, invalid, ...props }, ref) => (
    <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, "min-h-32 py-2", invalid && "border-attention-text", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & Invalid>(
  ({ className, invalid, ...props }, ref) => (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-11 pr-8", invalid && "border-attention-text", className)} {...props} />
  ),
);
Select.displayName = "Select";

/**
 * A check box: the browser's own control in the accent, 20px, its edge at 3:1. Put it inside a `<label>` with its words,
 * so the whole row is the target — or use {@link ChecklistItem}, which does.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(({ className, ...props }, ref) => (
  <input ref={ref} type="checkbox" className={cn("size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed", className)} {...props} />
));
Checkbox.displayName = "Checkbox";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn("text-sm font-semibold text-ink", className)} {...props} />
));
Label.displayName = "Label";

/** A field's error text, announced to screen readers. Point the control's `aria-describedby` at this id. */
export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm text-attention-text">
      {children}
    </p>
  );
}

/** A line under a field that says what it takes ("Up to 200 characters"). */
export function FieldHint({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-ink-muted">
      {children}
    </p>
  );
}

/**
 * One field, laid out the one way: its label above, the control, a hint, then its error. The control is the child; give it
 * the `id` named by `htmlFor`, and `aria-describedby` naming `errorId`.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  errorId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
