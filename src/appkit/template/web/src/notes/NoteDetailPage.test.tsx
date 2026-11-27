import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { jsonResponse as json } from "@endgame/appkit/testing";
import { describe, expect, it, vi } from "vitest";
import NoteDetailPage from "./NoteDetailPage";

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
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/follow")
        ? json(200, { id: null, signedIn: false, following: false, since: null, followers: 0 })
        : json(200, { id: "n1", title: "Groceries", body: "Milk", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" }),
    );
    renderAt("n1");
    expect(await within(screen.getByTestId("page-note")).findByText("Milk")).toBeTruthy();
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

  it("reads the person's own follow on every visit: someone who comes back sees Following, never Follow again", async () => {
    const note = { id: "n1", title: "Dive briefing", body: "Fins", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" };
    const follow = { id: "f1", signedIn: true, following: true, since: "2026-11-24T11:00:00Z", followers: 1 };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/follow") ? json(200, follow) : json(200, note),
    );
    renderAt("n1");
    expect(await screen.findByTestId("set-following-false")).toBeTruthy();
    expect(screen.queryByTestId("set-following-true")).toBeNull();
    expect(screen.getByText("1 person follows this note")).toBeTruthy();
  });

  it("follows with a PUT, which answers the follow the person has, and shows it", async () => {
    const note = { id: "n1", title: "Dive briefing", body: "Fins", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" };
    let following = false;
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url.slice(url.indexOf("notes/"))}`);
      if (!url.endsWith("/follow")) return json(200, note);
      if (init?.method === "PUT") following = true;
      return json(200, { id: following ? "f1" : null, signedIn: true, following, since: null, followers: following ? 1 : 0 });
    });
    renderAt("n1");
    fireEvent.click(await screen.findByTestId("set-following-true"));
    expect(await screen.findByTestId("set-following-false")).toBeTruthy();
    expect(calls).toContain("PUT notes/n1/follow");
  });

  it("offers nothing to follow to someone signed out, but still says how many follow it", async () => {
    const note = { id: "n1", title: "Dive briefing", body: "Fins", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/follow") ? json(200, { id: null, signedIn: false, following: false, since: null, followers: 2 }) : json(200, note),
    );
    renderAt("n1");
    expect(await screen.findByText("2 people follow this note")).toBeTruthy();
    expect(screen.queryByTestId("set-following-true")).toBeNull();
  });
});
