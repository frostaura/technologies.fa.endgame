import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Failed } from "./states";

afterEach(cleanup);

describe("a failed read", () => {
  it("that broke says nothing is known until it loads, and offers a retry", () => {
    render(<Failed title="Credits could not be loaded" reason="Endgame could not be reached just now." status={503} onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("Endgame could not be reached just now. Nothing here is known until it loads.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("that was answered not found is the whole message, with the way back instead of a retry (D62)", () => {
    render(<Failed title="This employee could not be found" reason="This was not found, or you cannot see it." status={404} onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toContain("Nothing here is known");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the org chart" }).getAttribute("href")).toBe("/");
  });

  it("that was refused is the whole message", () => {
    render(<Failed title="You cannot see the secrets here" reason="Only an Admin or the Owner can do this here. You are a Builder here." status={403} />);
    expect(screen.getByRole("alert").textContent).not.toContain("Nothing here is known");
  });
});
