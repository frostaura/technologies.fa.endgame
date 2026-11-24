import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { NotesPage } from "./NotesPage";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
    expect(await screen.findByText("No notes yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("loaded: one link per note, addressed inside the app", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, [{ id: "n1", title: "Groceries", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" }]),
    );
    renderPage();
    const link = await screen.findByRole("link", { name: /Groceries/ });
    expect(link.getAttribute("href")).toBe("/notes/n1");
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
