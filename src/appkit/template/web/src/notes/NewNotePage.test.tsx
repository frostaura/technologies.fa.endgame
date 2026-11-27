import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { BAD_INPUT_TEST, holdsUpAgainstBadInput, jsonResponse as json } from "@endgame/appkit/testing";
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

  it("asks for a title before sending anything", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { user: ada }));
    renderPage();
    fireEvent.change(await screen.findByTestId("note-title"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("save-note"));
    expect((await screen.findByRole("alert")).textContent).toBe("Give the note a title.");
    expect(screen.getByTestId("note-title").getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes the focus to the first wrong field, and clears its error as soon as it is corrected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { user: ada }));
    renderPage();
    const title = await screen.findByTestId("note-title");
    const when = screen.getByTestId("note-happens-at");
    fireEvent.change(when, { target: { value: "2120-01-01T08:00" } });
    fireEvent.click(screen.getByTestId("save-note"));
    expect(document.activeElement).toBe(title);
    expect(when.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(title, { target: { value: "Reef dive" } });
    expect(title.getAttribute("aria-invalid")).toBeNull();
    expect(document.getElementById("title-error")).toBeNull();
    expect(when.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the server's field errors beside the field", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(400, { title: "Validation failed", errors: { Title: ["The Title field is required."] } }));
    renderPage();
    fireEvent.change(await screen.findByTestId("note-title"), { target: { value: "Hi" } });
    fireEvent.click(screen.getByTestId("save-note"));
    expect((await screen.findByRole("alert")).textContent).toBe("The Title field is required.");
    expect(screen.getByTestId("note-title").getAttribute("aria-invalid")).toBe("true");
    // The server's "Title" is the field named "title": changing it clears the error.
    fireEvent.change(screen.getByTestId("note-title"), { target: { value: "Hello" } });
    expect(screen.queryByRole("alert")).toBeNull();
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
    expect(init?.body).toBe(JSON.stringify({ title: "Hi", body: "", happensAt: null }));
  });

  it("survives a date the field lets through that no date can be (a six-digit year), and refuses it by the field (R7-1)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json(200, { user: ada }));
    renderPage();
    fireEvent.change(await screen.findByTestId("note-title"), { target: { value: "Reef dive" } });
    const when = screen.getByTestId("note-happens-at");
    expect(when.getAttribute("type")).toBe("datetime-local");
    expect([when.getAttribute("min"), when.getAttribute("max")]).toEqual(["2000-01-01T00:00", "2099-12-31T23:59"]);
    // Typed into the year segment by keyboard: the browser keeps it, and Date cannot read it.
    fireEvent.change(when, { target: { value: "202612-12-12T08:00" } });
    expect(screen.getByTestId("page-new-note")).toBeTruthy();
    expect(screen.getByLabelText("How it will read").textContent).toContain("No date yet");
    fireEvent.click(screen.getByTestId("save-note"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Enter a date between .+2000 and .+2099\.$/);
    expect(when.getAttribute("aria-invalid")).toBe("true");
    // Refused before it was sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a real date as the instant the person meant, and the preview shows it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, { user: ada }))
      .mockResolvedValueOnce(json(201, { id: "n9", title: "Reef dive", body: "", authorName: "ada", createdAt: "2026-11-24T10:00:00Z", followers: 0, happensAt: "2026-12-12T08:00:00Z" }));
    renderPage();
    fireEvent.change(await screen.findByTestId("note-title"), { target: { value: "Reef dive" } });
    fireEvent.change(screen.getByTestId("note-happens-at"), { target: { value: "2026-12-12T08:00" } });
    expect(screen.getByLabelText("How it will read").textContent).toContain("2026");
    fireEvent.click(screen.getByTestId("save-note"));
    expect(await screen.findByText("opened note")).toBeTruthy();
    const sent = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { happensAt: string };
    expect(sent.happensAt).toBe(new Date(2026, 11, 12, 8, 0).toISOString());
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

  // Every form field is fed what a person can put there — a six-digit year, a blank title, text past its limit — and the
  // page must stay whole and say what is wrong beside the field. The factory runs these itself (ARCH-006).
  it.each(["note-title", "note-happens-at", "note-body"])(BAD_INPUT_TEST, async (field) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(200, { user: ada }));
    await holdsUpAgainstBadInput(field, { render: renderPage, page: "page-new-note", submit: "save-note" });
  });
});
