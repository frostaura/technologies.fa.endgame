import { useState, type ReactNode } from "react";
import { href, useLocation } from "../lib/router.ts";
import { flow } from "../lib/data.ts";
import { catalogue, useProgress } from "../lib/progress.ts";
import { overallNext } from "../progress/derive.ts";
import { CLIENT_LEVELS } from "../content/types.ts";
import { PDFS } from "../lib/site.ts";
import { Mark } from "./Mark.tsx";
import { Search } from "./Search.tsx";
import { Sheet } from "./Sheet.tsx";
import { ui } from "./ui.ts";

/**
 * The academy's frame: a slim header with the mark, the ways in, where the learner left off, search
 * and the live demo. On a phone the header is one row — the mark, the way back to where the learner
 * left off, search and a menu — and the rest opens as a sheet from the bottom edge, in reach of a
 * thumb. The operator handbook is named in the header and never mixes into client navigation.
 */
export function Shell({ children, operator = false, player = false }: { children: ReactNode; operator?: boolean; player?: boolean }) {
  const { parts } = useLocation();
  const here = parts[0] ?? "";
  const [menu, setMenu] = useState<null | "menu" | "search">(null);
  const nav = operator
    ? [
        { to: "/operator", label: "Handbook", on: here === "operator" && parts.length === 1 },
        { to: "/operator/browse", label: "Browse", on: here === "operator" && parts.length > 1 },
        { to: "/progress", label: "Progress", on: here === "progress" },
        { to: "/demo", label: "Live demo", on: here === "demo" },
      ]
    : [
        { to: "/learn", label: "Learn", on: here === "learn" || here === "path" },
        { to: "/browse", label: "Browse", on: ["browse", "area", "who", "reach"].includes(here) },
        { to: "/progress", label: "Progress", on: here === "progress" },
        { to: "/demo", label: "Live demo", on: here === "demo" },
      ];
  // The handbook is the same light page as the academy: its name in the header says where you are, not a second colour.
  const pill = (on: boolean) => (on ? "bg-primary-tint text-primary-link" : "text-ink-body hover:bg-ground");
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">
        Skip to the content
      </a>
      {/* Opaque and a fixed height: nothing shows through it, and nothing under it moves when what it holds changes. */}
      <header className={`sticky top-0 z-30 h-header-sm border-b md:h-header short:h-header-short bg-surface`} data-print="hide">
        <div className={`${ui.container} flex h-full items-center gap-2 md:gap-5`}>
          <a href={href(operator ? "/operator" : "/")} className="flex min-h-touch shrink-0 items-center gap-2.5" aria-label={operator ? "Operator handbook home" : "The Endgame Academy, cover"}>
            <Mark className="h-8 w-8" />
            <span className="hidden font-display text-base font-semibold tracking-tight xl:block">
              Endgame <span className="text-primary">{operator ? "Operator handbook" : "Academy"}</span>
            </span>
          </a>
          <nav aria-label="Academy" className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <a key={n.to} href={href(n.to)} aria-current={n.on ? "page" : undefined} className={`whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${pill(n.on)}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <ResumePill />
          <div className="ml-auto hidden w-40 shrink-0 text-ink md:block lg:w-search xl:w-search-lg"><Search scope={operator ? "operator" : "client"} /></div>
          <div className="ml-auto flex items-center md:hidden">
            <button type="button" className={ui.icon} aria-label="Search the academy" aria-haspopup="dialog" onClick={() => setMenu("search")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className={ui.icon} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menu === "menu"} onClick={() => setMenu("menu")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      </header>
      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={operator ? "Operator handbook" : "The Endgame Academy"}>
        {menu !== null && (
          <div className="mt-4">
            <Search scope={operator ? "operator" : "client"} wide inline autoFocus={menu === "search"} onChoose={() => setMenu(null)} />
            <nav aria-label="Academy, small screens" className="mt-5">
              <ul className="grid grid-cols-2 gap-2">
                {nav.map((n) => (
                  <li key={n.to}>
                    <a href={href(n.to)} onClick={() => setMenu(null)} aria-current={n.on ? "page" : undefined} className={`flex min-h-touch items-center rounded-md border px-4 py-3 text-base font-medium ${n.on ? "border-primary bg-primary-tint text-primary-link" : "text-ink"}`}>
                      {n.label === "Progress" ? "Your progress" : n.label}
                    </a>
                  </li>
                ))}
              </ul>
              <ul className="mt-4 space-y-1 text-sm">
                <li><a className="flex min-h-touch items-center text-ink-body" href={href("/about")} onClick={() => setMenu(null)}>About this academy</a></li>
                <li><a className="flex min-h-touch items-center text-ink-body" href={href("/finish")} onClick={() => setMenu(null)}>Share it (QR code)</a></li>
                {PDFS && <li><a className="flex min-h-touch items-center text-ink-body" href="./academy.pdf" download>Download the academy (PDF)</a></li>}
                <li>
                  {operator ? (
                    <a className="flex min-h-touch items-center text-ink-body" href={href("/")} onClick={() => setMenu(null)}>Client academy</a>
                  ) : (
                    <a className="flex min-h-touch items-center text-ink-body" href={href("/operator")} onClick={() => setMenu(null)}>Operator handbook (FrostAura)</a>
                  )}
                </li>
              </ul>
            </nav>
          </div>
        )}
      </Sheet>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      {/* The player fills the window under the header on a wide screen; its footer would only be scrolled to by accident. */}
      <footer className={`border-t bg-ground ${player ? "split:hidden short:block" : ""}`} data-print="hide">
        {/* The brand line and the links share one top edge; on a narrow screen the links are a tidy two-column list. */}
        <div className={`${ui.container} flex flex-col gap-4 py-6 text-sm text-ink-muted lg:flex-row lg:items-start lg:justify-between lg:gap-10`}>
          <span className="flex min-h-touch items-center gap-2"><Mark className="h-5 w-5" /> The Endgame Academy, built from the product's own flow documents.</span>
          <ul className="grid grid-cols-2 gap-x-6 sm:flex sm:flex-wrap sm:gap-x-6">
            <li><a className={footLink} href={href("/progress")}>Your progress</a></li>
            <li><a className={footLink} href={href("/about")}>About this academy</a></li>
            <li><a className={footLink} href={href("/finish")}>Share it</a></li>
            <li>{operator ? <a className={footLink} href={href("/")}>Client academy</a> : <a className={footLink} href={href("/operator")}>Operator handbook</a>}</li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

const footLink = "-mx-2 inline-flex min-h-touch items-center rounded-full px-2 hover:text-ink";

/**
 * Back to the step last viewed, from any page but that flow itself: the flow's id and how far in,
 * one tap. Read before the first paint, so it never pushes the header about when it appears.
 */
function ResumePill() {
  const { parts } = useLocation();
  const progress = useProgress();
  const { last } = progress;
  const f = last ? flow(last.flow) : undefined;
  if (!f || !last) return null;
  // The flow last read is finished: the way on is what is next up, not its last step again.
  const next = progress.flows[f.id]?.done ? overallNext(progress, catalogue, CLIENT_LEVELS)?.flow : undefined;
  if (progress.flows[f.id]?.done && !next) return null;
  // On a flow the player carries its own way on: the header adds no second "next".
  if (parts[0] === "flow") return null;
  return (
    <a
      href={href(next ? `/flow/${next.id}` : `/flow/${f.id}/step/${last.step}`)}
      aria-label={next ? `Next up: ${next.id} ${next.title}` : `Pick up where you left off: ${f.id} ${f.title}, step ${last.step} of ${f.steps.length}`}
      className={`inline-flex min-h-touch shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium md:border-l md:rounded-l-none md:pl-5 text-primary-link hover:bg-primary-tint`}
      data-testid="header-resume"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
      <span>{next ? "Next up" : "Resume"}</span>
      <span className="hidden tabular-nums lg:inline">{next ? next.id : f.id}</span>
    </a>
  );
}

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${ui.container} py-8 sm:py-12 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={`font-sans text-primary ${ui.eyebrow}`}>{children}</p>;
}
