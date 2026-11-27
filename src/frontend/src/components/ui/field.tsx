import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** The one look for a text box, a select and a text area. */
export const inputClass = "min-h-touch w-full min-w-0 rounded-xs border border-border-field bg-surface px-3 text-sm text-ink disabled:cursor-not-allowed disabled:bg-quiet disabled:text-ink-muted touch:text-base";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

/**
 * The house select: the browser's own control underneath (so a phone opens its own picker, and a keyboard works
 * as it always does), drawn in the house look — the field's edge, the house chevron, never the OS chrome.
 * `className` sizes it (its width); the box inside fills it.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <span data-select="" className={cn("relative flex w-full min-w-0", className)}>
    <select ref={ref} className={cn(inputClass, "appearance-none truncate pr-9")} {...props} />
    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
  </span>
));
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputClass, "py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

/** A labelled control with an optional hint and problem, wired for screen readers. */
export function Field({ id, label, hint, problem, children, className }: { id: string; label: React.ReactNode; hint?: React.ReactNode; problem?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </span>
      )}
      {problem && (
        <span id={`${id}-problem`} role="alert" className="text-sm text-attention-text">
          {problem}
        </span>
      )}
    </div>
  );
}
