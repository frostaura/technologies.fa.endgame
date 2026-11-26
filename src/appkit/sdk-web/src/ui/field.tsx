import * as React from "react";
import { cn } from "./cn.js";

/** A phone zooms into a box set under 16px when it takes the focus: on a phone the text is 16px. */
const control =
  "w-full rounded-sm border bg-surface px-3 text-base text-ink sm:text-sm placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

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
