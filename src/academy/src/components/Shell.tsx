import type { ReactNode } from "react";
import { href, useLocation } from "../lib/router.ts";
import { Mark } from "./Mark.tsx";
import { Search } from "./Search.tsx";

/**
 * The academy's frame: a slim header with the mark, the three ways in, search and the live demo.
 * The operator handbook has its own header tone and never mixes into client navigation.
 */
export function Shell({ children, operator = false }: { children: ReactNode; operator?: boolean }) {
  const { parts } = useLocation();
  const here = parts[0] ?? "";
  const nav = operator
    ? [
        { to: "/operator", label: "Handbook", on: here === "operator" && parts.length === 1 },
        { to: "/operator/browse", label: "Browse", on: here === "operator" && parts.length > 1 },
        { to: "/demo", label: "Live demo", on: here === "demo" },
      ]
    : [
        { to: "/learn", label: "Learn", on: here === "learn" || here === "path" },
        { to: "/browse", label: "Browse", on: ["browse", "area", "who", "reach"].includes(here) },
        { to: "/demo", label: "Live demo", on: here === "demo" },
      ];
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink">
        Skip to the content
      </a>
      <header className={`sticky top-0 z-30 border-b backdrop-blur ${operator ? "bg-night text-primary-ink" : "bg-surface/90"}`} data-print="hide">
        <div className="mx-auto flex max-w-page items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
          <a href={href(operator ? "/operator" : "/")} className="flex shrink-0 items-center gap-2.5" aria-label={operator ? "Operator handbook home" : "The Endgame Academy, cover"}>
            <Mark className="h-8 w-8" />
            <span className="hidden font-display text-base font-semibold tracking-tight sm:block">
              Endgame <span className={operator ? "text-live" : "text-primary"}>{operator ? "Operator handbook" : "Academy"}</span>
            </span>
          </a>
          <nav aria-label="Academy" className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <a key={n.to} href={href(n.to)} aria-current={n.on ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${operator ? (n.on ? "bg-surface/15" : "text-primary-ink-soft hover:bg-surface/10") : n.on ? "bg-primary-tint text-primary-link" : "text-ink-body hover:bg-ground"}`}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 flex-1 justify-end text-ink"><Search scope={operator ? "operator" : "client"} /></div>
        </div>
        <nav aria-label="Academy, small screens" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {nav.map((n) => (
            <a key={n.to} href={href(n.to)} aria-current={n.on ? "page" : undefined}
              className={`min-h-touch shrink-0 rounded-full px-3.5 py-2.5 text-sm font-medium ${operator ? (n.on ? "bg-surface/15" : "text-primary-ink-soft") : n.on ? "bg-primary-tint text-primary-link" : "text-ink-body"}`}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>
      <footer className="border-t bg-ground" data-print="hide">
        <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center gap-2"><Mark className="h-5 w-5" /> The Endgame Academy, built from the product's own flow documents.</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <a className="hover:text-ink" href={href("/about")}>About this academy</a>
            <a className="hover:text-ink" href={href("/finish")}>Share it</a>
            {operator ? <a className="hover:text-ink" href={href("/")}>Client academy</a> : <a className="hover:text-ink" href={href("/operator")}>Operator handbook (FrostAura)</a>}
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-page px-4 py-10 sm:px-6 sm:py-14 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-sans text-eyebrow font-semibold uppercase text-primary">{children}</p>;
}
