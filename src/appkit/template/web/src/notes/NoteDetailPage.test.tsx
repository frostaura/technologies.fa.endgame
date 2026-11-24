import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import NoteDetailPage from "./NoteDetailPage";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const renderAt = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/notes/${id}`]}>
      <Routes>
        <Route path="/notes/:id" element={<NoteDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("NoteDetailPage", () => {
  it("shows the note", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { id: "n1", title: "Groceries", body: "Milk", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" }),
    );
    renderAt("n1");
    expect(await screen.findByText("Milk")).toBeTruthy();
  });

  it("tells a missing note apart from a failed read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(404, { title: "No such note" }));
    const missing = renderAt("gone");
    expect(await screen.findByText("There is no such note")).toBeTruthy();
    missing.unmount();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(500, { detail: "Database unreachable." }));
    renderAt("n1");
    expect((await screen.findByRole("alert")).textContent).toContain("Database unreachable.");
  });
});
