import { fireEvent, screen, within } from "@testing-library/react";
import { jsonResponse, renderApp } from "@endgame/appkit/testing";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

/**
 * Navigation: the real <App /> with a real router, moving between pages by clicking — exactly as a
 * person does. A page that renders when its address is loaded directly can still fail to appear
 * when a link routes to it; only a test that clicks the link catches that. Every link or button
 * that moves between pages gets one.
 */

const ada = { id: "usr_1", email: "ada@example.test", displayName: "ada", kind: "member", role: "builder" };
const groceries = { id: "n1", title: "Groceries", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" };

/** The API as a table of paths (relative to the app's api/), each answered with JSON. */
function serve(routes: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input).slice(new URL("api/", document.baseURI).toString().length);
    return path in routes ? jsonResponse(200, routes[path]) : jsonResponse(404, { title: `No route for ${path}` });
  });
}

const api = { me: { user: ada }, notes: [groceries], "notes/n1": { ...groceries, body: "Milk", followers: 0 } };

describe("moving between pages", () => {
  it("home → “New note” shows the form", async () => {
    serve(api);
    renderApp(<App />, { at: "/" });
    fireEvent.click(await screen.findByTestId("new-note"));
    const page = await screen.findByTestId("page-new-note");
    expect(await within(page).findByTestId("note-title")).toBeTruthy();
    expect(within(page).getByTestId("save-note")).toBeTruthy();
  });

  it("home → a note shows that note, and the navigation goes back home", async () => {
    serve(api);
    renderApp(<App />, { at: "/" });
    const item = await screen.findByTestId("note-item");
    expect(item.getAttribute("data-id")).toBe("n1");
    fireEvent.click(within(item).getByTestId("open-note"));
    expect(await within(await screen.findByTestId("page-note")).findByText("Milk")).toBeTruthy();

    fireEvent.click(screen.getByTestId("nav-home"));
    expect(await screen.findByTestId("page-home")).toBeTruthy();
  });

  it("works the same under a path prefix", async () => {
    serve(api);
    renderApp(<App />, { at: "/", base: "https://endgame.example.test/acme/labs/demo/" });
    const newNote = await screen.findByTestId("new-note");
    expect(newNote.getAttribute("href")).toBe("/acme/labs/demo/notes/new");
    fireEvent.click(newNote);
    expect(await screen.findByTestId("page-new-note")).toBeTruthy();
  });

  it("an unknown address shows the not-found page, with a way home", async () => {
    serve(api);
    renderApp(<App />, { at: "/no/such/page" });
    fireEvent.click(within(await screen.findByTestId("page-not-found")).getByRole("link"));
    expect(await screen.findByTestId("page-home")).toBeTruthy();
  });

  it("names the tab after the page and the app, not the template", async () => {
    serve(api);
    renderApp(<App />, { at: "/" });
    await screen.findByTestId("note-item");
    expect(document.title).toBe("All notes · Notes");
    fireEvent.click(screen.getByTestId("new-note"));
    await screen.findByTestId("page-new-note");
    expect(document.title).toBe("New note · Notes");
  });
});
