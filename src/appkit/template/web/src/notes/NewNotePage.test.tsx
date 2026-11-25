import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { jsonResponse as json } from "@endgame/appkit/testing";
import { describe, expect, it, vi } from "vitest";
import NewNotePage from "./NewNotePage";

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
    expect(screen.getByTestId("page-new-note")).toBeTruthy();
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn.getAttribute("href")).toContain(new URL("_endgame/auth/sign-in?returnTo=", document.baseURI).toString());
  });

  it("shows the server's field errors beside the field", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(400, { title: "Validation failed", errors: { Title: ["The Title field is required."] } }));
    renderPage();
    fireEvent.click(await screen.findByTestId("save-note"));
    expect((await screen.findByRole("alert")).textContent).toBe("The Title field is required.");
    expect(screen.getByTestId("note-title").getAttribute("aria-invalid")).toBe("true");
  });

  it("opens the saved note", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(201, { id: "n9", title: "Hi", body: "", authorName: "ada", createdAt: "2026-11-24T10:00:00Z" }));
    renderPage();
    // Each input has a visible label, the test id <entity>-<field> and the API field as its name.
    const title = await screen.findByTestId("note-title");
    expect(screen.getByLabelText("Title")).toBe(title);
    expect(title.getAttribute("name")).toBe("title");
    expect(screen.getByTestId("note-body").getAttribute("name")).toBe("body");
    fireEvent.change(title, { target: { value: "Hi" } });
    fireEvent.click(screen.getByTestId("save-note"));
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
    fireEvent.change(await screen.findByTestId("note-title"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByTestId("save-note"));
    expect((await screen.findByRole("alert")).textContent).toContain("The note was not saved");
  });
});
