import { fireEvent, screen } from "@testing-library/react";
import { jsonResponse, renderApp } from "@endgame/appkit/testing";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

// A page that throws while it renders — here the first page, made to fail as a bad date did in a built app (R7-1).
vi.mock("./notes/NotesPage", () => ({
  NotesPage: () => {
    throw new RangeError("Invalid time value");
  },
}));

/**
 * A render error in one page never blanks the app: the kit's boundary around the routed page shows "Something went wrong
 * on this page" with a way back, and the header — the app's name, its navigation, the person's menu — stays.
 */
describe("a page that fails to render", () => {
  it("keeps the header and offers Try again and Back to the start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, { user: null }));
    renderApp(<App />, { at: "/" });
    const failed = await screen.findByRole("alert");
    expect(failed.textContent).toContain("Something went wrong on this page");
    expect(screen.getByTestId("nav-home")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the start" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // Still broken: the same plain state, never a white page.
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong on this page");
    expect(screen.getByTestId("nav-home")).toBeTruthy();
  });
});
