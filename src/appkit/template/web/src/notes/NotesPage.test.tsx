import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { jsonResponse as json } from "@endgame/appkit/testing";
import { describe, expect, it, vi } from "vitest";
import { NotesPage } from "./NotesPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <NotesPage />
    </MemoryRouter>,
  );

describe("NotesPage shows each state distinctly", () => {
  it("loading", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status").textContent).toContain("Loading notes");
  });

  it("empty: loaded with no notes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, []));
    renderPage();
    // The list's test id is there when it is empty too, holding the empty state.
    expect(within(await screen.findByTestId("note-list")).getByText("No notes yet")).toBeTruthy();
    expect(screen.queryByTestId("note-item")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loaded: one item per note, each with its id and a link to it inside the app", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, [
        { id: "n1", title: "Groceries", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" },
        { id: "n2", title: "Ideas", authorName: "ada", createdAt: "2026-11-24T11:00:00Z" },
      ]),
    );
    renderPage();
    const items = within(await screen.findByTestId("note-list")).getAllByTestId("note-item");
    expect(items.map((item) => item.getAttribute("data-id"))).toEqual(["n1", "n2"]);
    const open = within(items[0] as HTMLElement).getByTestId("open-note");
    expect(open.textContent).toContain("Groceries");
    expect(open.getAttribute("href")).toBe("/notes/n1");
  });

  it("carries the page's test id, and the way to add one, in every state", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(within(screen.getByTestId("page-home")).getByTestId("new-note").getAttribute("href")).toBe("/notes/new");
  });

  it("failed: an alert with the reason — never 'No notes yet'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(500, { title: "Server error", detail: "The database is unreachable." }));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toContain("The database is unreachable.");
    expect(screen.queryByText("No notes yet")).toBeNull();
  });

  it("calls the API relative to the page's base", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, []));
    renderPage();
    await screen.findByText("No notes yet");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(new URL("api/notes", document.baseURI).toString());
  });
});
