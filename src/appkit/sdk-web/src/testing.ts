/**
 * `@endgame/appkit/testing` — helpers for an app's front-end tests (Vitest + Testing Library).
 * Never imported by app code: it pulls in `@testing-library/react`.
 */
import { createElement, type ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
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

/**
 * The title every bad-input test carries, for `it.each([...])(BAD_INPUT_TEST, …)`: "holds up against bad input: dive-when".
 * The factory's gate runs the app's front-end tests itself and finds, for each form field a part adds, the passing test
 * with this title naming the field's test id (ARCH-006, "A form holds up against bad input").
 */
export const BAD_INPUT_TEST = "holds up against bad input: %s";

/** Options for {@link holdsUpAgainstBadInput}. */
export interface BadInputOptions {
  /** Renders the page with its form ready to fill in — signed in, its reads answered. Called afresh for each bad value. */
  render: () => unknown;
  /** The page's own test id (`page-new-dive`): it must still be on screen after every bad value. */
  page: string;
  /** The form's submit button (`save-dive`). */
  submit: string;
}

/** One value a field is fed, what it is in words, and whether the form must refuse it on submit. */
interface BadValue {
  value: string;
  refuse: boolean;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The year before an input's own `min` (or year 1), written as that input's value. */
function belowMin(input: HTMLInputElement): string {
  const year = /^(\d{4,})/.exec(input.min)?.[1];
  const before = pad(Math.max(1, (year ? Number(year) : 2) - 1), 4);
  return input.type === "date" ? `${before}-01-01` : input.type === "month" ? `${before}-01` : input.type === "week" ? `${before}-W01` : `${before}-01-01T00:00`;
}

/**
 * What a person can put in this field that the page must survive: a six-digit year a date field keeps (typed into its year
 * segment), a date before any sane limit, a number far past any limit, an option that is not there, a blank required field,
 * text past its limit. Each must leave the page on screen; those the field cannot accept must be refused on submit.
 */
function badValuesFor(field: HTMLElement): BadValue[] {
  if (field instanceof HTMLSelectElement) return [{ value: "__not-an-option__", refuse: field.required || field.getAttribute("aria-required") === "true" }];
  if (field instanceof HTMLInputElement) {
    const required = field.required || field.getAttribute("aria-required") === "true";
    switch (field.type) {
      case "date":
        return [{ value: "202612-12-12", refuse: true }, { value: belowMin(field), refuse: true }];
      case "datetime-local":
        return [{ value: "202612-12-12T08:00", refuse: true }, { value: belowMin(field), refuse: true }];
      case "month":
        return [{ value: "202612-12", refuse: true }, { value: belowMin(field), refuse: true }];
      case "week":
        return [{ value: "202612-W01", refuse: true }, { value: belowMin(field), refuse: true }];
      case "number":
      case "range":
        return [{ value: "99999999999999999999", refuse: true }, { value: "-99999999999999999999", refuse: true }];
      case "checkbox":
      case "radio":
      case "file":
      case "hidden":
      case "submit":
      case "button":
      case "reset":
      case "image":
      case "color":
      case "time":
        throw new Error(`holdsUpAgainstBadInput: ${field.dataset.testid ?? "the field"} is a ${field.type} input: there is nothing a person types into it that this check feeds.`);
      default:
        return textValues(field.maxLength, required);
    }
  }
  if (field instanceof HTMLTextAreaElement) return textValues(field.maxLength, field.required || field.getAttribute("aria-required") === "true");
  throw new Error(`holdsUpAgainstBadInput: ${field.dataset.testid ?? "the element"} is a <${field.tagName.toLowerCase()}>, not an input, select or textarea: put the test id on the control itself.`);
}

function textValues(maxLength: number, required: boolean): BadValue[] {
  // Mixed scripts, an emoji, a right-to-left mark and markup: what a paste brings.
  const unusual = "Ünïcødé 𝔡𝔦𝔳𝔢 🤿 \u202Eright-to-left <b>bold</b> ";
  const long = (n: number) => unusual.repeat(Math.ceil(n / unusual.length)).slice(0, n);
  return [
    { value: "   ", refuse: required },
    maxLength > 0 ? { value: long(maxLength + 1), refuse: true } : { value: long(5000), refuse: false },
  ];
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The field's own error text: what its `aria-describedby` (or `aria-errormessage`) points at. */
function errorTextOf(field: HTMLElement): string {
  const ids = `${field.getAttribute("aria-describedby") ?? ""} ${field.getAttribute("aria-errormessage") ?? ""}`.split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
}

/**
 * The kit's check that a form holds up against bad input (R7-1): feeds the field with test id `field` each hostile but
 * plausible value a person can give it, and fails unless the page stays on screen — no throw, no error boundary showing —
 * and, on submit, every value the field cannot accept is refused beside it (`aria-invalid="true"` and the text its
 * `aria-describedby` names). Use one per form field, titled with {@link BAD_INPUT_TEST}:
 *
 * ```ts
 * it.each(["dive-site", "dive-when", "dive-depth"])(BAD_INPUT_TEST, (field) =>
 *   holdsUpAgainstBadInput(field, { render: renderSignedIn, page: "page-new-dive", submit: "save-dive" }));
 * ```
 */
export async function holdsUpAgainstBadInput(field: string, options: BadInputOptions): Promise<void> {
  cleanup();
  await act(async () => {
    await options.render();
  });
  const first = await screen.findByTestId(field).catch(() => {
    throw new Error(`holdsUpAgainstBadInput: no element with data-testid="${field}" on the page ${options.page}.`);
  });
  const values = badValuesFor(first);
  for (const [index, bad] of values.entries()) {
    if (index > 0) {
      cleanup();
      await act(async () => {
        await options.render();
      });
    }
    const caught: unknown[] = [];
    // A render that throws is reported to the window (and, inside act, thrown): either way it is this value's fault.
    const onError = (event: ErrorEvent) => {
      caught.push(event.error ?? event.message);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    const shown = `${field}: ${JSON.stringify(bad.value.length > 40 ? `${bad.value.slice(0, 40)}…` : bad.value)}`;
    const whole = () => {
      if (caught.length > 0) throw new Error(`${shown} broke the page: ${describeError(caught[0])}`);
      if (document.querySelector("[data-endgame-error]")) throw new Error(`${shown} broke the page: it threw while rendering, and the kit's error boundary is showing.`);
      if (!screen.queryByTestId(options.page)) throw new Error(`${shown} broke the page: ${options.page} is no longer on screen.`);
    };
    try {
      const input = await screen.findByTestId(field);
      try {
        fireEvent.change(input, { target: { value: bad.value } });
      } catch (error) {
        caught.push(error);
      }
      await act(async () => undefined);
      whole();
      if (!bad.refuse) continue;
      try {
        fireEvent.click(screen.getByTestId(options.submit));
      } catch (error) {
        caught.push(error);
      }
      await act(async () => undefined);
      whole();
      await waitFor(
        () => {
          whole();
          const now = screen.getByTestId(field);
          if (now.getAttribute("aria-invalid") !== "true" || !errorTextOf(now)) {
            throw new Error(`${shown} was not refused beside the field: on submit it must be marked aria-invalid="true" with its error in the element its aria-describedby names.`);
          }
        },
        { timeout: 1000 },
      );
    } finally {
      window.removeEventListener("error", onError);
    }
  }
  cleanup();
}


// ---------------------------------------------------------------------------------------------
// Page shape: the worst layout mistakes, caught by a test (AGENTS.md, "What good looks like")
// ---------------------------------------------------------------------------------------------

/** What a page is, for {@link pageShapeProblems}: a list of things, a form to add or change one, or one thing's own page. */
export type PageKind = "list" | "form" | "detail";

/** The desktop a list page is judged at, and the share of it a list's content must be allowed to fill. */
export const SHAPE_VIEWPORT = 1440;
export const LIST_MIN_SHARE = 0.6;

const REM = 16;
/** Tailwind's named max-widths, in pixels. The kit's `max-w-page` (96rem) and `max-w-form` (42rem) are its own. */
const MAX_WIDTHS: Record<string, number> = {
  "0": 0, px: 1, xs: 20 * REM, sm: 24 * REM, md: 28 * REM, lg: 32 * REM, xl: 36 * REM, "2xl": 42 * REM, "3xl": 48 * REM,
  "4xl": 56 * REM, "5xl": 64 * REM, "6xl": 72 * REM, "7xl": 80 * REM, prose: 65 * 8.5, form: 42 * REM, aside: 22 * REM,
  page: 96 * REM, "screen-sm": 640, "screen-md": 768, "screen-lg": 1024, "screen-xl": 1280, "screen-2xl": 1536,
};
/** Fractions of the width that hold a list to part of the page (`w-1/2`, `lg:w-1/3`). */
const FRACTION = /^(?:[a-z0-9]+:)*w-(\d+)\/(\d+)$/;
const MAX_WIDTH = /^(?:[a-z0-9]+:)*max-w-(\[[^\]]+\]|[a-z0-9-]+)$/;

function widthLimit(token: string): number | null {
  const fraction = FRACTION.exec(token);
  if (fraction) return (Number(fraction[1]) / Number(fraction[2])) * SHAPE_VIEWPORT;
  const max = MAX_WIDTH.exec(token);
  if (!max) return null;
  const name = max[1] ?? "";
  if (name.startsWith("[")) {
    const value = /^\[(\d+(?:\.\d+)?)(px|rem)\]$/.exec(name);
    return value ? Number(value[1]) * (value[2] === "rem" ? REM : 1) : null;
  }
  return MAX_WIDTHS[name] ?? null;
}

/** A control a person types or chooses in: its edge must be the field border, 3:1 against the page. */
function isField(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !["hidden", "checkbox", "radio", "submit", "button", "reset", "image", "file", "range", "color"].includes(el.type);
}

/**
 * What is wrong with a rendered page's shape, in words — empty when nothing is. The page is the element carrying its
 * `page-<view>` test id, rendered with its data loaded. Every page has one `<h1>`, and every text box, select and text area
 * has the kit's field edge (`border-border-field`, 3:1) — use the kit's `Input`, `Select` and `Textarea`. Then by kind:
 *
 * - `list`: the `…-list` element, and everything around it up to `<main>`, may use at least 60% of a 1440px desktop (no
 *   `max-w-2xl`, no `w-1/3`), and it is more than one column on a desktop: the kit's `CardGrid`, a grid with columns from
 *   `sm:` up, or a table.
 * - `form`: a `<form>` with a submit button and a "Cancel" beside it (the kit's `FormActions`).
 * - `detail`: a way back to the page above (the kit's `BackLink`, or `PageHeader`'s `back`).
 *
 * jsdom draws nothing, so this reads the classes the page asks for, which is what a browser would honour.
 */
export function pageShapeProblems(page: HTMLElement, kind: PageKind): string[] {
  const problems: string[] = [];
  const name = page.getAttribute("data-testid") ?? "the page";
  const headings = page.querySelectorAll("h1");
  if (headings.length !== 1) problems.push(`${name} has ${headings.length} <h1> headings; a page has exactly one, its title (the kit's PageHeader).`);

  for (const field of Array.from(page.querySelectorAll("input, textarea, select")).filter(isField)) {
    if (!field.classList.contains("border-border-field")) {
      const id = field.getAttribute("data-testid") ?? field.getAttribute("name") ?? field.tagName.toLowerCase();
      problems.push(`The field ${id} does not have the field edge (border-border-field, 3:1): use the kit's Input, Select or Textarea.`);
    }
  }

  if (kind === "list") {
    const list = page.querySelector('[data-testid$="-list"]');
    if (!list) {
      problems.push(`${name} has no element with a "<entity>-list" test id.`);
    } else {
      const floor = SHAPE_VIEWPORT * LIST_MIN_SHARE;
      for (let el: Element | null = list; el && el.tagName !== "MAIN" && el !== document.body; el = el.parentElement) {
        for (const token of Array.from(el.classList)) {
          const limit = widthLimit(token);
          if (limit !== null && limit < floor) {
            problems.push(`The list is held to ${Math.round(limit)}px by "${token}" on <${el.tagName.toLowerCase()}>: a list page uses the width (at least ${Math.round(floor)}px of a ${SHAPE_VIEWPORT}px desktop).`);
          }
        }
        if (el === page) break;
      }
      const classes = Array.from(list.classList);
      const columns =
        list.tagName === "TABLE" ||
        list.getAttribute("role") === "table" ||
        list.querySelector("table") !== null ||
        classes.includes("grid-cols-cards") ||
        classes.some((c) => /^(?:sm|md|lg|xl|2xl):grid-cols-(?:[2-9]|1[0-2])$/.test(c));
      if (!columns) problems.push(`The list is one column at every width: use the kit's CardGrid (or a grid with columns from sm: up, or a table).`);
    }
  }

  if (kind === "form") {
    const form = page.querySelector("form");
    if (!form) {
      problems.push(`${name} has no <form>.`);
    } else {
      if (!form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')) problems.push("The form has no submit button.");
      const cancel = Array.from(page.querySelectorAll("a, button")).some((el) => /^cancel$/i.test((el.textContent ?? "").trim()));
      if (!cancel) problems.push(`The form has no "Cancel" beside its main action: a person can always leave without saving (the kit's FormActions).`);
    }
  }

  if (kind === "detail" && !page.querySelector('[data-slot="back-link"]')) {
    problems.push(`${name} has no way back to the page above: give PageHeader a "back" link (the kit's BackLink).`);
  }

  return problems;
}

/** Fails, naming every problem, unless the page's shape is right (see {@link pageShapeProblems}). */
export function expectPageShape(page: HTMLElement, kind: PageKind): void {
  const problems = pageShapeProblems(page, kind);
  if (problems.length > 0) throw new Error(`The page's shape is wrong:\n  - ${problems.join("\n  - ")}`);
}
