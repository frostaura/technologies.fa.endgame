import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../errors.js";
import { EmptyState, FailedState, LoadingState } from "./states.js";

describe("the three states look different and say different things", () => {
  it("loading is a polite status", () => {
    render(<LoadingState />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
  });

  it("empty names what is missing", () => {
    render(<EmptyState title="No notes yet">Write the first one.</EmptyState>);
    expect(screen.getByText("No notes yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("failed is an alert with the reason and a retry", () => {
    const retry = vi.fn();
    render(<FailedState error={new ApiError(500, { detail: "The database is unreachable." })} onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("The database is unreachable.");
    screen.getByText("Try again").click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
