import { useEffect, useId, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * The control a person last pressed, and where it was when they pressed it: the trigger a confirmation that
 * opens next is anchored to. Read at the press, because a page often hides the trigger while it asks.
 */
let lastPress: { rect: DOMRect; at: number } | null = null;
if (typeof document !== "undefined")
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest("button, a, [role='button']") : null;
      if (el) lastPress = { rect: el.getBoundingClientRect(), at: Date.now() };
    },
    true,
  );

/**
 * Anchor `card` horizontally to the control that opened it: under it, starting at its left edge when the
 * control sits in the left half of the card's column, ending at its right edge when it sits in the right
 * half. Vertically the card is in the flow — the page puts it in the same row or cell as its trigger, so it
 * pushes what follows down and never covers the next row.
 */
function anchorToTrigger(el: HTMLElement | null) {
    const column = el?.parentElement;
    const press = lastPress;
    if (!el || !column || !press || Date.now() - press.at > 2000) return;
    // The column's content box: the card lines up with the trigger inside the column's own padding.
    const outer = column.getBoundingClientRect();
    const pad = getComputedStyle(column);
    const left = outer.left + parseFloat(pad.paddingLeft || "0") + parseFloat(pad.borderLeftWidth || "0");
    const right = outer.right - parseFloat(pad.paddingRight || "0") - parseFloat(pad.borderRightWidth || "0");
    const box = { left, right, width: right - left };
    const width = Math.min(el.getBoundingClientRect().width, box.width);
    const trigger = press.rect;
    if (trigger.right < box.left || trigger.left > box.right) return;
    const atRight = trigger.left + trigger.width / 2 > box.left + box.width / 2;
    const offset = atRight ? Math.max(0, box.right - trigger.right) : Math.max(0, trigger.left - box.left);
    const room = Math.max(0, box.width - width);
    if (atRight) {
      el.style.marginLeft = "auto";
      el.style.marginRight = `${Math.min(offset, room)}px`;
    } else el.style.marginLeft = `${Math.min(offset, room)}px`;
}

/**
 * The one confirmation (ARCH-011), and the one inline form: a card in the flow, directly under the control
 * that asked (anchored to it, see {@link anchorToTrigger}), with the question, what follows, an optional field, and
 * on one line a confirm and an outlined safe choice of equal size. Used wherever something is dropped,
 * cancelled, declined, deleted, removed, revoked or let go — and, with `destructive={false}`, for a short
 * form that changes a setting in place (a budget, a manager). Escape is the way back. It scrolls itself fully
 * into view, above a phone's bottom bar.
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
  useLayoutEffect(() => anchorToTrigger(ref.current), []);
  // It opens where it was asked for, and all of it comes into view — above a phone's bottom bar (its scroll margin).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus) el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focus]);
  const body = (
    <>
      <p id={questionId} className="font-semibold text-ink">
        {question}
      </p>
      {detail && <p className="text-sm text-ink-body">{detail}</p>}
      {children}
      {/* The two choices, the same size, on one line: what was asked, then the safe way back. */}
      <div className="flex flex-wrap gap-2 pt-1 max-sm:[&>*]:grow sm:inline-grid sm:w-fit sm:auto-cols-fr sm:grid-flow-col">
        <Button variant={destructive ? "danger" : "primary"} type={onSubmit ? "submit" : "button"} onClick={onSubmit ? undefined : onConfirm} disabled={busy}>
          {confirm}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {cancel}
        </Button>
      </div>
    </>
  );
  const look = cn("flex w-full max-w-form shrink-0 scroll-mb-nav-safe scroll-mt-4 flex-col gap-2 rounded-md border border-border-strong bg-surface p-4 text-left shadow-raised outline-none", className);
  const keys = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
  return onSubmit ? (
    <form ref={ref as RefObject<HTMLFormElement>} data-confirm="" aria-label={label} tabIndex={-1} onKeyDown={keys} onSubmit={onSubmit} className={look}>
      {body}
    </form>
  ) : (
    <div ref={ref as RefObject<HTMLDivElement>} data-confirm="" role={role} aria-label={label} aria-describedby={questionId} tabIndex={-1} onKeyDown={keys} className={look}>
      {body}
    </div>
  );
}
