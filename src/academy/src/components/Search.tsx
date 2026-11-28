import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchFlows } from "../lib/data.ts";
import { go, href } from "../lib/router.ts";
import { snippet } from "../lib/snippet.ts";
import { useProgress, stateOf } from "../lib/progress.ts";
import { LevelBadge, ProgressWord } from "./Chips.tsx";
import { highlight } from "./highlight.tsx";
import { Inline } from "./Inline.tsx";

/**
 * Instant search over titles, steps, on-screen labels, refusal messages and flow ids. `/` focuses
 * it from anywhere; arrows move through the results; Enter opens one; Escape closes. `inline` sets the
 * results in the page's flow rather than over it (the phone's menu sheet, where there is no room to
 * drop a list over anything); `onChoose` is told when a result is opened.
 */
export function Search({ scope = "client", autoFocus = false, inline = false, onChoose }: { scope?: "client" | "operator"; autoFocus?: boolean; wide?: boolean; inline?: boolean; onChoose?: () => void }) {
  const progress = useProgress();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hits = useMemo(() => (q.trim().length >= 2 ? searchFlows(q, scope, inline ? 8 : 6) : []), [q, scope, inline]);

  useEffect(() => {
    // In the sheet, the header's own box already answers "/".
    if (inline) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inline]);

  const choose = (i: number) => {
    const h = hits[i];
    setOpen(false);
    input.current?.blur();
    onChoose?.();
    if (h) {
      setQ("");
      go(`/flow/${h.flow.id}`);
    } else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}${scope === "operator" ? "&scope=operator" : ""}`);
  };

  return (
    <div className="relative w-full">
      <label htmlFor={`${listId}-input`} className="sr-only">Search the academy</label>
      <div className="flex items-center gap-2 rounded-full border bg-surface px-4 shadow-toggle focus-within:border-primary focus-within:ring-2 focus-within:ring-primary-tint">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-muted"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <input
          id={`${listId}-input`}
          ref={input}
          autoFocus={autoFocus}
          data-autofocus={autoFocus || undefined}
          type="search"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          placeholder="Search flows"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            if (!inline) window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          className="min-h-touch w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <kbd className="hidden rounded-xxs border px-1.5 font-mono text-xs text-ink-muted mouse:block" aria-hidden="true">/</kbd>
      </div>
      {(open || inline) && q.trim().length >= 2 && (
        // Over the page, the panel is wider than the box (about 600 px, never wider than the window), held to the box's right edge.
        <div className={inline ? "mt-3 overflow-hidden rounded-md border bg-surface" : "absolute right-0 top-full z-40 mt-2 w-search-panel overflow-hidden rounded-md border bg-surface shadow-raised"}>
          {hits.length ? (
            <ul id={listId} role="listbox" aria-label="Matching flows" className="py-1">
              {hits.map((h, i) => (
                <li key={h.flow.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <a
                    href={href(`/flow/${h.flow.id}`)}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      onChoose?.();
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-touch items-start gap-3 px-4 py-3 ${i === active ? "bg-ground" : ""}`}
                  >
                    {/* The id in a fixed column; the title on up to two lines with the words searched for marked; the line it matched; then its path and, once begun, how far. */}
                    <span className="mt-0.5 w-16 shrink-0 font-mono text-xs font-semibold leading-5 text-primary-link">{h.flow.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium leading-5 text-ink">{highlight(h.flow.title, h.terms)}</span>
                      <span className="mt-0.5 line-clamp-1 text-xs text-ink-muted"><Inline text={snippet(h.flow, h.terms)} plainIds mark={h.terms} /></span>
                      <span className="mt-1.5 flex items-center gap-2"><LevelBadge level={h.flow.level} /><ProgressWord state={stateOf(progress, h.flow.id)} /></span>
                    </span>
                  </a>
                </li>
              ))}
              <li role="presentation" className="border-t px-4 py-2 text-xs">
                <a href={href(`/search?q=${encodeURIComponent(q.trim())}${scope === "operator" ? "&scope=operator" : ""}`)} onMouseDown={(e) => e.preventDefault()} onClick={() => onChoose?.()} className="inline-flex min-h-touch items-center font-medium text-primary-link">
                  See every result for “{q.trim()}”
                </a>
              </li>
            </ul>
          ) : (
            <div className="px-5 py-5">
              <p className="font-medium text-ink">No flow mentions “{q.trim()}”</p>
              <p className="mt-1 text-sm text-ink-muted">Try a word from the screen, a message you saw, or a flow id such as ID-02.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
