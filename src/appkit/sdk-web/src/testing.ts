/**
 * `@endgame/appkit/testing` — helpers for an app's front-end tests (Vitest + Testing Library).
 * Never imported by app code: it pulls in `@testing-library/react`.
 */
import { createElement, type ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { routerBasename } from "./router.js";

/** Puts a `<base>` on the page, as the app's server does on every request. */
export function setBase(href: string): void {
  document.head.querySelectorAll("base").forEach((b) => b.remove());
  const base = document.createElement("base");
  base.href = href;
  document.head.prepend(base);
}

/** A `fetch` answer: JSON with `status`, as problem details when it is an error. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });
}

/** Options for {@link renderApp}. */
export interface RenderAppOptions {
  /** The in-app address to start at, as the router writes it: `"/"`, `"/notes/new"`. */
  at: string;
  /**
   * The page's `<base href>`, i.e. the app's own address. Defaults to the test page's origin root;
   * pass e.g. `"https://endgame.example.test/acme/labs/demo/"` to run the app under a path.
   */
  base?: string;
}

/**
 * Renders the whole app — `renderApp(<App />, { at: "/" })` — with a real router, as `main.tsx`
 * does in the browser: the page's `<base>` is set, the router's basename comes from it, and the
 * app starts at `at`. Clicking a `<Link>` then routes exactly as it does for a person, so a test
 * that clicks from one page to another proves the navigation itself, not only each page alone.
 */
export function renderApp(app: ReactElement, { at, base = `${window.location.origin}/` }: RenderAppOptions): RenderResult {
  if (!at.startsWith("/")) throw new Error(`renderApp: 'at' is an in-app route such as "/" or "/notes/new", not "${at}".`);
  setBase(base);
  const basename = routerBasename();
  return render(createElement(MemoryRouter, { basename, initialEntries: [`${basename}${at}`] }, app));
}
