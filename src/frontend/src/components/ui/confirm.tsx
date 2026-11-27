import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * The one confirmation (ARCH-011): a card in place, under the control that asked, with the question,
 * what follows, a destructive-styled confirm and a quiet way back. Used wherever something is dropped,
 * cancelled, declined, deleted, removed, revoked or let go. Escape is the way back.
 *
 * `onSubmit` makes it a form, for a confirmation that takes a field (`children`), such as a reason.
 */
export function ConfirmCard({
  label,
  question,
  detail,
  confirm,
  cancel,
  onConfirm,
  onCancel,
  onSubmit,
  busy = false,
  destructive = true,
  role = "group",
  focus = false,
  className,
  children,
}: {
  /** The accessible name of the card ("Confirm letting go"). */
  label: string;
  question: ReactNode;
  detail?: ReactNode;
  confirm: string;
  cancel: string;
  onConfirm?: () => void;
  onCancel: () => void;
  onSubmit?: (event: FormEvent) => void;
  busy?: boolean;
  /** False for a confirmation that commits rather than removes (building against a verdict). */
  destructive?: boolean;
  role?: "group" | "alertdialog";
  /** Move the focus to the card when it opens. */
  focus?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const questionId = useId();
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const body = (
    <>
      <p id={questionId} className="font-semibold text-ink">
        {question}
      </p>
      {detail && <p className="text-sm text-ink-body">{detail}</p>}
      {children}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant={destructive ? "danger" : "primary"} type={onSubmit ? "submit" : "button"} onClick={onSubmit ? undefined : onConfirm} disabled={busy}>
          {confirm}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </>
  );
  const look = cn("flex w-full max-w-form flex-col gap-2 rounded-md border bg-surface p-4 text-left shadow-card outline-none", className);
  const keys = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
  return onSubmit ? (
    <form ref={ref as RefObject<HTMLFormElement>} aria-label={label} tabIndex={-1} onKeyDown={keys} onSubmit={onSubmit} className={look}>
      {body}
    </form>
  ) : (
    <div ref={ref as RefObject<HTMLDivElement>} role={role} aria-label={label} aria-describedby={questionId} tabIndex={-1} onKeyDown={keys} className={look}>
      {body}
    </div>
  );
}
