import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

let broken = true;
function Fragile() {
  if (broken) throw new TypeError("t.existing.map is not a function");
  return <p>Drawn</p>;
}

describe("ErrorBoundary", () => {
  it("draws a branded failure that says what failed and offers a way back, instead of a blank page", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    broken = true;
    render(
      <div>
        <p>Outside</p>
        <ErrorBoundary name="The verdict">
          <Fragile />
        </ErrorBoundary>
      </div>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.dataset.state).toBe("crashed");
    expect(alert.textContent).toContain("The verdict stopped working.");
    expect(alert.textContent).toContain("t.existing.map is not a function");
    expect(screen.getByRole("link", { name: "Back to the org chart" }).getAttribute("href")).toBe("/");
    // Everything outside the boundary still works.
    expect(screen.getByText("Outside")).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Drawn")).toBeTruthy();
  });

  it("as a route, draws its own frame with the mark", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    broken = true;
    render(
      <ErrorBoundary name="This screen" variant="route">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Endgame")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("This screen stopped working.");
  });
});
