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

/** The API as the page reads it: the note (with its count, for anyone), who is signed in, and — signed in — their follow. */
function serve(o: { followers?: number; signedIn?: boolean; following?: boolean; onWrite?: (method: string) => void; calls?: string[] }) {
  let following = o.following ?? false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    o.calls?.push(`${method} ${url.slice(url.indexOf("api/") + 4)}`);
    if (url.endsWith("/me")) return json(200, { user: o.signedIn === false ? null : ada });
    if (url.endsWith("/follow")) {
      // Reading someone's own record requires sign-in: signed out, the app answers 401.
      if (o.signedIn === false) return json(401, { title: "Sign in required", signInUrl: "/_endgame/auth/sign-in" });
      if (method !== "GET") {
        following = method === "PUT";
        o.onWrite?.(method);
      }
      return json(200, { id: following ? "f1" : null, following, since: following ? "2026-11-24T11:00:00Z" : null });
    }
    return json(200, { id: "n1", title: "Dive briefing", body: "Fins", authorName: "ada", createdAt: "2026-11-24T10:00:00Z", followers: (o.followers ?? 0) + (following && !o.following ? 1 : 0) });
  });
}

const ada = { id: "usr_1", email: "ada@example.test", displayName: "ada", kind: "member", role: "builder" };

describe("NoteDetailPage", () => {
  it("shows the note", async () => {
    serve({});
    renderAt("n1");
    expect(await within(screen.getByTestId("page-note")).findByText("Fins")).toBeTruthy();
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
    serve({ following: true, followers: 1 });
    renderAt("n1");
    expect(await screen.findByTestId("set-following-false")).toBeTruthy();
    expect(screen.queryByTestId("set-following-true")).toBeNull();
    expect(screen.getByText("1 person follows this note")).toBeTruthy();
  });

  it("follows with a PUT, which answers the follow the person has, and shows it", async () => {
    const calls: string[] = [];
    serve({ calls });
    renderAt("n1");
    fireEvent.click(await screen.findByTestId("set-following-true"));
    expect(await screen.findByTestId("set-following-false")).toBeTruthy();
    expect(calls).toContain("PUT notes/n1/follow");
    expect(await screen.findByText("1 person follows this note")).toBeTruthy();
  });

  it("offers nothing to follow to someone signed out and never asks for their follow, but still says how many follow it", async () => {
    const calls: string[] = [];
    serve({ signedIn: false, followers: 2, calls });
    renderAt("n1");
    expect(await screen.findByText("2 people follow this note")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Sign in to follow" })).toBeTruthy();
    expect(screen.queryByTestId("set-following-true")).toBeNull();
    expect(calls).not.toContain("GET notes/n1/follow");
  });
});
