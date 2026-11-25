import * as React from "react";
import { cn } from "@/lib/utils";

/** The one look for a text box, a select and a text area. */
export const inputClass = "min-h-touch w-full min-w-0 rounded-xs border border-border-strong bg-surface px-3 text-ink";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(inputClass, className)} {...props} />
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
