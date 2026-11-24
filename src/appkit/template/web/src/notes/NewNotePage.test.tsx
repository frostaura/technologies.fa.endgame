import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import NewNotePage from "./NewNotePage";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ada = { id: "usr_1", email: "ada@example.test", displayName: "ada", kind: "member", role: "builder" };

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/notes/new"]}>
      <Routes>
        <Route path="/notes/new" element={<NewNotePage />} />
        <Route path="/notes/:id" element={<p>opened note</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("NewNotePage", () => {
  it("offers sign-in, under the app's own address, to someone signed out", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { user: null }));
    renderPage();
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toContain(new URL("_endgame/auth/sign-in?returnTo=", document.baseURI).toString());
  });

  it("shows the server's field errors beside the field", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(400, { title: "Validation failed", errors: { Title: ["The Title field is required."] } }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Save note" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The Title field is required.");
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
  });

  it("opens the saved note", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(201, { id: "n9", title: "Hi", body: "", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" }));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText("opened note")).toBeTruthy();
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "Hi", body: "" }));
  });

  it("says the save failed, distinctly from a load failure", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(503, { title: "Unavailable", detail: "Try again in a moment." }));
    renderPage();
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The note was not saved");
  });
});
