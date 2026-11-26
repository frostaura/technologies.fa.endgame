import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { useViewport, type Viewport } from "@/lib/useViewport";
import { cn } from "@/lib/utils";

/**
 * A section a phone folds away: its title and a line about it, one tap to open. On a tablet or a
 * desktop (or wherever `on` does not include the viewport) it is not drawn at all — what it holds
 * is shown as it always was, with its own heading — so a page reads as one column of named rows on
 * a phone and as its full layout everywhere else.
 *
 * Folded content stays in the page (hidden, not removed), so what it was doing carries on. The
 * academy's spotlight opens a fold whose content it points at (`endgame:reveal`, see the demo bridge).
 */
export function Fold({
  title,
  summary,
  icon,
  defaultOpen = false,
  on = ["phone"],
  tone = "plain",
  children,
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** The layouts that fold it; elsewhere it is not there. */
  on?: Viewport[];
  tone?: "plain" | "attention";
  children: ReactNode;
}) {
  const viewport = useViewport();
  if (!on.includes(viewport)) return <>{children}</>;
  return (
    <Disclosure title={title} summary={summary} icon={icon} defaultOpen={defaultOpen} tone={tone}>
      {children}
    </Disclosure>
  );
}

/** A disclosure on every layout: a named row that opens to what it holds. */
export function Disclosure({
  title,
  summary,
  icon,
  defaultOpen = false,
  tone = "plain",
  children,
  className,
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  tone?: "plain" | "attention";
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const root = useRef<HTMLElement>(null);

  // Something asked to be shown that sits inside (the academy pointing at it, a link to it): open.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);

  // Closed, it is a card naming what it holds; open, that line becomes a quiet bar above what it holds,
  // which keeps its own card and heading — never a card inside a card.
  return (
    <section ref={root} aria-label={title} data-fold="" data-open={open || undefined} className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((x) => !x)}
        className={cn(
          "flex min-h-touch w-full items-center gap-3 rounded-md text-left",
          open ? "px-1 text-ink-muted" : "border bg-surface px-4 py-3 shadow-card",
          !open && tone === "attention" && "border-attention-line bg-attention-wash",
        )}
      >
        {icon && <span className="flex shrink-0">{icon}</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("font-display font-semibold", open ? "text-sm" : "text-base text-ink")}>{title}</span>
          {summary && !open && <span className="text-sm text-ink-muted">{summary}</span>}
        </span>
        <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div id={bodyId} data-fold-body="" hidden={!open} className={open ? "flex flex-col gap-4" : "hidden"}>
        {children}
      </div>
    </section>
  );
}

/**
 * Words a phone clamps to a few lines, with a control to read the rest: a heading that is a whole
 * request ("Build: a members' locker booking app for…"), or a long explanation above the buttons it
 * explains, never takes the screen. Wider screens show it whole.
 */
function useClamp(text: string) {
  const ref = useRef<HTMLElement>(null);
  const [whole, setWhole] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return { ref, whole, cut, toggle: () => setWhole((x) => !x) };
}

function MoreOrLess({ id, whole, onToggle, more }: { id: string; whole: boolean; onToggle: () => void; more: string }) {
  return (
    <button type="button" aria-controls={id} aria-expanded={whole} onClick={onToggle} className="min-h-touch self-start rounded-xs text-sm font-semibold text-primary-link sm:hidden">
      {whole ? "Show less" : more}
    </button>
  );
}

export function ClampedHeading({ children, className, id }: { children: string; className?: string; id?: string }) {
  const { ref, whole, cut, toggle } = useClamp(children);
  const ownId = useId();
  const hid = id ?? ownId;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <h1 ref={ref as RefObject<HTMLHeadingElement>} id={hid} className={cn(className, !whole && "max-sm:line-clamp-2")}>
        {children}
      </h1>
      {(cut || whole) && <MoreOrLess id={hid} whole={whole} onToggle={toggle} more="Show all of it" />}
    </div>
  );
}

/** A paragraph a phone clamps to four lines. */
export function ClampedText({ children, className }: { children: string; className?: string }) {
  const { ref, whole, cut, toggle } = useClamp(children);
  const id = useId();
  return (
    <>
      <p ref={ref as RefObject<HTMLParagraphElement>} id={id} className={cn(className, !whole && "max-sm:line-clamp-4")}>
        {children}
      </p>
      {(cut || whole) && <MoreOrLess id={id} whole={whole} onToggle={toggle} more="Read all of it" />}
    </>
  );
}
