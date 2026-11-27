import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Icon } from "@/components/Icon";
import type { IconName } from "@/components/iconNames";
import { Link } from "@/components/Link";
import { Disclosure } from "@/components/Fold";
import { buttonVariants } from "@/components/ui/button";
import { useViewport } from "@/lib/useViewport";
import { cn } from "@/lib/utils";
import { MENU, MENU_ITEM } from "@/components/ui/layout";

export interface QuickLink {
  key: string;
  href: string;
  icon: IconName;
  label: string;
}

const ITEM = cn(buttonVariants({ variant: "quiet", size: "sm" }), "shrink-0 text-ink-body hover:text-ink");
/** Room kept for "More" when anything is in it, and the space between two links. */
const MORE_WIDTH = 96;
const GAP = 4;

/**
 * The pages for the level selected, as a secondary navigation: one line that never wraps. What does
 * not fit goes into "More", in order, so the first links (Manage, Hiring, Autonomy) are always in view.
 * A phone's More sheet already holds the organisation's pages: there, only a level below the top gets
 * its own, folded under one row — and at the top nothing is drawn, though a lesson that points at a
 * link can still open it (`endgame:reveal`).
 */
export function QuickLinks({ links, name, atTop, className }: { links: QuickLink[]; name: string; atTop: boolean; className?: string }) {
  const phone = useViewport() === "phone";
  if (phone) return <PhoneLinks links={links} name={name} atTop={atTop} className={className} />;
  return <WideLinks links={links} className={className} />;
}

function WideLinks({ links, className }: { links: QuickLink[]; className?: string }) {
  const nav = useRef<HTMLElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(links.length);
  const signature = links.map((l) => l.label).join("|");

  const measure = useCallback(() => {
    const box = nav.current;
    const row = ruler.current;
    if (!box || !row) return;
    const room = box.clientWidth - 8;
    const widths = [...row.children].map((c) => (c as HTMLElement).offsetWidth);
    if (room <= 0 || widths.every((w) => w === 0)) return setFit(links.length);
    // All of them, if all of them fit with no "More"; otherwise as many as fit beside "More".
    const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? GAP : 0), 0);
    if (total <= room) return setFit(widths.length);
    let used = 0;
    let n = 0;
    for (const w of widths) {
      const next = used + (n > 0 ? GAP : 0) + w;
      if (next + GAP + MORE_WIDTH > room) break;
      used = next;
      n += 1;
    }
    setFit(n);
  }, [links.length]);

  useLayoutEffect(() => {
    measure();
    const box = nav.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    // The links' own widths change once the web fonts arrive: measure again then, and whenever the ruler changes.
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    if (ruler.current) ro.observe(ruler.current);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [measure, signature]);

  const shown = links.slice(0, fit);
  const more = links.slice(fit);
  return (
    <nav ref={nav} aria-label="Manage" className={cn("relative flex min-w-0 items-center gap-1 rounded-md border bg-surface p-1 shadow-card", className)}>
      {/* The ruler: every link's width, measured where nobody sees it. Plain text, so no one can land on it. */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={ruler} className="flex w-max gap-1 whitespace-nowrap">
          {links.map((l) => (
            <span key={l.key} className={ITEM}>
              <span className="size-4" />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      {shown.map((l) => (
        <Link key={l.key} href={l.href} className={ITEM}>
          <Icon name={l.icon} className="size-4" />
          {l.label}
        </Link>
      ))}
      {more.length > 0 && <MoreMenu links={more} />}
    </nav>
  );
}

/** "More": the links that did not fit, in a list that opens under it. Escape, a click elsewhere or a choice closes it. */
function MoreMenu({ links }: { links: QuickLink[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative ml-auto shrink-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((x) => !x)} className={cn(ITEM, open && "bg-ground")}>
        More
        <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <div ref={panel} id={id} data-fold-body="" hidden={!open} className={cn(MENU, "absolute right-0 top-full min-w-60")}>
        <ul className="flex flex-col">
          {links.map((l) => (
            <li key={l.key}>
              <Link href={l.href} onClick={() => setOpen(false)} className={MENU_ITEM}>
                <Icon name={l.icon} className="size-4" />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PhoneLinks({ links, name, atTop, className }: { links: QuickLink[]; name: string; atTop: boolean; className?: string }) {
  const list = (
    <ul className="flex flex-col divide-y rounded-md border bg-surface">
      {links.map((l) => (
        <li key={l.key}>
          <Link href={l.href} className="flex min-h-touch items-center gap-3 px-4 py-2 text-ink">
            <Icon name={l.icon} className="size-4 text-ink-muted" />
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  if (atTop) return <HiddenUntilAsked className={className}>{list}</HiddenUntilAsked>;
  return (
    <nav aria-label="Manage" className={className}>
      <Disclosure title={`Pages for ${name}`} summary={links.map((l) => l.label).join(" · ")}>
        {list}
      </Disclosure>
    </nav>
  );
}

/** Not drawn — the More sheet holds the same pages — until a lesson points at one of them. */
function HiddenUntilAsked({ className, children }: { className?: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const reveal = () => setShown(true);
    el.addEventListener("endgame:reveal", reveal);
    return () => el.removeEventListener("endgame:reveal", reveal);
  }, []);
  return (
    <nav aria-label="Manage" className={cn(!shown && "hidden", className)}>
      <div ref={box} data-fold-body="" hidden={!shown}>
        {children}
      </div>
    </nav>
  );
}
