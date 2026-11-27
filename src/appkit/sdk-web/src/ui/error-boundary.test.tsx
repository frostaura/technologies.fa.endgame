import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, PAGE_ERROR_LOG, rootOptions } from "./error-boundary.js";

/**
 * R7-1: a render error in one page of a built app ("RangeError: Invalid time value" from a preview card) unmounted the whole
 * app — `#root` empty, a white page, no way back but reload. The kit's boundary keeps the rest of the screen, says plainly
 * that the page went wrong, offers "Try again" and "Back to the start", and reports the error once.
 */
function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new RangeError("Invalid time value");
  return <p>The page</p>;
}

afterEach(() => vi.restoreAllMocks());

describe("a page that fails to render", () => {
  it("shows a plain failed state in its place, keeps what is around it, and reports the error once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <div>
        <header>The app's header</header>
        <AppErrorBoundary>
          <Bomb explode />
        </AppErrorBoundary>
      </div>,
    );
    const failed = screen.getByRole("alert");
    expect(failed.textContent).toContain("Something went wrong on this page");
    expect(failed.textContent).toContain("Nothing you saved is lost");
    // The reason a person reads is plain: never the error's own words.
    expect(failed.textContent).not.toContain("Invalid time value");
    expect(screen.getByText("The app's header")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the start" }).getAttribute("href")).toBe("./");
    expect(failed.closest("[data-endgame-error]")?.getAttribute("data-endgame-error")).toBe("page");
    const ours = log.mock.calls.filter((call) => call[0] === PAGE_ERROR_LOG);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.[1]).toBeInstanceOf(RangeError);
  });

  it("tries the page again, and shows it once it renders", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Page() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button onClick={() => setBroken(false)}>Mend it</button>
          <AppErrorBoundary>
            <Bomb explode={broken} />
          </AppErrorBoundary>
        </>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByText("Mend it"));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("The page")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts afresh when the page it guards changes (a link to another page)", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <AppErrorBoundary resetKey="/dives/new">
        <Bomb explode />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(
      <AppErrorBoundary resetKey="/">
        <Bomb explode={false} />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("The page")).toBeTruthy();
  });

  it("gives the root options that leave the boundary's report the only one", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boundary = new AppErrorBoundary({ children: null });
    rootOptions.onCaughtError(new Error("caught by the kit"), { componentStack: "", errorBoundary: boundary });
    expect(log).not.toHaveBeenCalled();
    rootOptions.onCaughtError(new Error("caught elsewhere"), { componentStack: "" });
    expect(log).toHaveBeenCalledOnce();
  });
});
