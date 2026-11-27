import { screen } from "@testing-library/react";
import { expectPageShape, jsonResponse, renderApp, type PageKind } from "@endgame/appkit/testing";
import { describe, it, vi } from "vitest";
import { App } from "./App";

/**
 * Every page's shape (AGENTS.md, "What good looks like"): the real app at each page, its data loaded, checked for the
 * worst layout mistakes — a list held to a narrow column or one column on a desktop, a form with no title or no Cancel, a
 * field whose edge a person cannot see, a detail page with no way back. Every page the app has gets a row here.
 */

const ada = { id: "usr_1", email: "ada@example.test", displayName: "Ada", kind: "member", role: "builder" };
const groceries = { id: "n1", title: "Groceries", authorName: "Ada", createdAt: "2026-11-24T10:00:00Z" };
const api: Record<string, unknown> = {
  me: { user: ada },
  notes: [groceries, { ...groceries, id: "n2", title: "Dive plan" }],
  "notes/n1": { ...groceries, body: "Milk", followers: 0, happensAt: null },
  "notes/n1/follow": { id: null, following: false, since: null },
};

const PAGES: { at: string; page: string; kind: PageKind; ready: string }[] = [
  { at: "/", page: "page-home", kind: "list", ready: "note-item" },
  { at: "/notes/new", page: "page-new-note", kind: "form", ready: "note-title" },
  { at: "/notes/n1", page: "page-note", kind: "detail", ready: "set-following-true" },
];

describe("every page has the shape a person expects", () => {
  it.each(PAGES)("$page ($kind)", async ({ at, page, kind, ready }) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const path = String(input).slice(new URL("api/", document.baseURI).toString().length);
      return path in api ? jsonResponse(200, api[path]) : jsonResponse(404, { title: `No route for ${path}` });
    });
    renderApp(<App />, { at });
    await screen.findAllByTestId(ready);
    expectPageShape(screen.getByTestId(page), kind);
  });
});
