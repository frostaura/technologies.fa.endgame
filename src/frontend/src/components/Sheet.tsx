import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVisibleViewport } from "@/lib/useVisibleViewport";

/**
 * A sheet over the page: on a phone it rises from the bottom (`bottom`) or takes the whole screen
 * (`full`); on a tablet it can come in from the side (`side`). It is a modal dialog — named by its
 * title, the focus kept inside it and given back when it closes, closed by Escape, by its own close
 * button or by tapping the page behind it — and the page behind does not scroll while it is open.
 *
 * `keepMounted` keeps what it holds alive while it is closed (hidden, not removed): a conversation
 * keeps streaming its reply and its draft. Its height follows the part of the screen above the
 * on-screen keyboard (see {@link useVisibleViewport}), so a text box at its foot is never under it.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  side = "bottom",
  keepMounted = false,
  hideTitle = false,
  children,
  footer,
  fill = false,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  side?: "bottom" | "full" | "side";
  keepMounted?: boolean;
  /** The title names the dialog for screen readers only: what it holds carries its own heading. */
  hideTitle?: boolean;
  children: ReactNode;
  /** Pinned to the sheet's foot, above the safe area: a primary action, a text box. */
  footer?: ReactNode;
  /** What it holds fills it and scrolls itself (a conversation: its log scrolls, its text box stays at the foot). */
  fill?: boolean;
  testId?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useVisibleViewport(open);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The first thing to type into, or the sheet itself: never a control that would act on a stray key.
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]");
    (first ?? panel.current)?.focus({ preventScroll: true });
    return () => {
      const back = returnTo.current;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") trapTab(e, panel.current);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);

  if (!open && !keepMounted) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div data-sheet={side} data-testid={testId} hidden={!open} className="fixed inset-x-0 top-visible-top z-50 h-visible">
      <div aria-hidden data-sheet-backdrop="" onClick={onClose} className="absolute inset-0 bg-ink/40 motion-safe:animate-fade" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "absolute flex flex-col bg-surface text-ink shadow-raised outline-none",
          side === "bottom" && "inset-x-0 bottom-0 max-h-sheet rounded-t-lg pb-safe-b motion-safe:animate-sheet",
          side === "full" && "inset-0 pb-safe-b pt-safe-t motion-safe:animate-sheet",
          side === "side" && "inset-y-0 right-0 w-full max-w-dock border-l pb-safe-b pt-safe-t motion-safe:animate-slide",
        )}
      >
        {side === "bottom" && <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" />}
        {hideTitle ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <div className="flex shrink-0 items-center gap-2 border-b py-1.5 pl-4 pr-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="text-sm text-ink-muted">{description}</p>}
            </div>
            <CloseButton title={title} onClose={onClose} />
          </div>
        )}
        <div data-sheet-body="" className={cn("relative min-h-0 flex-1", fill ? "flex flex-col overflow-hidden" : "overflow-y-auto overscroll-contain px-4 pb-4 pt-3")}>
          {/* With no title row, the close button sits in the corner of what the sheet holds, which leaves room for it. */}
          {hideTitle && <CloseButton title={title} onClose={onClose} className="absolute right-1 top-1 z-10" />}
          {children}
        </div>
        {footer && <div className="shrink-0 border-t bg-surface px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab go round the sheet's own controls, never out to the page behind it. */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last?.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first?.focus();
  }
}

let locks = 0;

/** The page behind a sheet stays where it was. Counted, so two sheets do not unlock each other. */
function useScrollLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    locks += 1;
    document.documentElement.dataset.sheetOpen = "";
    return () => {
      locks -= 1;
      if (locks === 0) delete document.documentElement.dataset.sheetOpen;
    };
  }, [on]);
}

function CloseButton({ title, onClose, className }: { title: string; onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={`Close: ${title}`}
      className={cn("flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-xs bg-surface text-ink-muted hover:bg-ground hover:text-ink", className)}
    >
      <X aria-hidden className="size-5" />
    </button>
  );
}
