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
    <Disclosure title={title} summary={summary} icon={icon} defaultOpen={defaultOpen} tone={tone} titleOnce>
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
  titleOnce = false,
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  tone?: "plain" | "attention";
  children: ReactNode;
  className?: string;
  /**
   * Open, the title is said once: when what it holds starts with a heading of the same words (a
   * section's own "Dashboard" under the row "Dashboard"), that heading is not drawn and the row
   * becomes the section's heading, at the same level.
   */
  titleOnce?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const echo = useEcho(body, titleOnce && open, title);

  // Something asked to be shown that sits inside (the academy pointing at it, a link to it): open.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);

  // ONE fold (ARCH-011): always a card that fills its column. Its header row is the same open or closed — the
  // title, the line about it while closed, a chevron at the right — and what it holds opens inside the same
  // card under a rule. A card that what it holds draws for itself is flattened into it: never a card in a card.
  const toggle = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={bodyId}
      onClick={() => setOpen((x) => !x)}
      className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left hover:bg-ground max-sm:px-4"
    >
      {icon && <span className="flex shrink-0">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display text-base font-semibold text-ink">{title}</span>
        {summary && !open && <span className="text-sm text-ink-muted">{summary}</span>}
      </span>
      <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-ink-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
    </button>
  );
  const Heading = echo ? (`h${echo}` as "h2") : null;

  return (
    <section
      ref={root}
      aria-label={title}
      data-fold=""
      data-open={open || undefined}
      className={cn(
        "flex w-full min-w-0 flex-col self-stretch overflow-hidden rounded-md border bg-surface shadow-card",
        tone === "attention" && "border-attention-line",
        className,
      )}
    >
      {Heading ? <Heading className="flex">{toggle}</Heading> : toggle}
      <div
        ref={body}
        id={bodyId}
        data-fold-body=""
        hidden={!open}
        className={cn(
          open ? "flex flex-col gap-4 border-t px-4 pb-4 pt-4 [&_[data-fold-echo]]:hidden" : "hidden",
          FLATTEN,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * What a fold holds may already be a card (a section that is a card on a desktop, where the fold is not drawn):
 * inside the fold it loses its own edge, fill, shadow and padding, so the fold is the only card.
 */
const FLATTEN =
  "[&>[class*='shadow-card']]:!rounded-none [&>[class*='shadow-card']]:!border-0 [&>[class*='shadow-card']]:!bg-transparent [&>[class*='shadow-card']]:!p-0 [&>[class*='shadow-card']]:!shadow-none [&>[data-fold]]:!shadow-none";

const HEADINGS = "h1, h2, h3, h4";

/**
 * The level (1–4) of the first heading inside `body` when its words are `title`'s, marked
 * `data-fold-echo` so the body leaves it undrawn; null when there is none. Watched while `on`,
 * since what a section holds may draw its heading only once it has loaded.
 */
function useEcho(body: RefObject<HTMLDivElement | null>, on: boolean, title: string): number | null {
  const [level, setLevel] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !on) return;
    const want = words(title);
    const mark = () => {
      const first = el.querySelector<HTMLElement>(HEADINGS);
      for (const h of el.querySelectorAll<HTMLElement>("[data-fold-echo]")) if (h !== first) delete h.dataset.foldEcho;
      if (first && words(first.textContent) === want) {
        first.dataset.foldEcho = "";
        setLevel(Number(first.tagName.slice(1)));
      } else {
        if (first) delete first.dataset.foldEcho;
        setLevel(null);
      }
    };
    mark();
    const watch = new MutationObserver(mark);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      for (const h of el.querySelectorAll<HTMLElement>("[data-fold-echo]")) delete h.dataset.foldEcho;
    };
  }, [body, on, title]);
  return on ? level : null;
}

function words(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
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
