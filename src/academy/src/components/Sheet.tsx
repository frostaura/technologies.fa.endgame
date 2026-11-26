import { useEffect, useId, useRef, type ReactNode } from "react";
import { ui } from "./ui.ts";

/**
 * A modal sheet on the browser's own `<dialog>`: it traps focus, closes on Escape, and gives the
 * focus back to what opened it. On a phone it rises from the bottom edge, in reach of a thumb and
 * clear of the home indicator; on a wider screen it is a centred panel.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      // The dialog focuses its first control; a field marked to take the focus (search) takes it instead.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => {
        // A tap on the backdrop (the dialog element itself, outside its panel) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-sheet w-full max-w-none overflow-y-auto rounded-t-lg bg-surface p-0 text-ink shadow-raised backdrop:bg-ink/40 sm:inset-0 sm:m-auto sm:max-w-sheet sm:rounded-lg"
    >
      <div className="px-5 pb-sheet-b pt-3 sm:px-6 sm:pb-6 sm:pt-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="min-w-0 flex-1 font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className={`${ui.icon} ml-auto`} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
