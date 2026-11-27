import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readDock, useDockState, WIDE_FROM } from "./dockLayout";

afterEach(() => localStorage.clear());

describe("the docked pane's layout (TALK-23)", () => {
  it("remembers width and collapsed per person, never full width", () => {
    const { result, rerender } = renderHook(({ person }) => useDockState(person), { initialProps: { person: "u1" as string | null } });
    act(() => result.current.setWide(true));
    act(() => result.current.setCollapsed(true));
    expect(readDock("u1")).toEqual({ wide: true, collapsed: true });
    act(() => result.current.setFull(true));
    // Full width opens the pane, and is never stored.
    expect(result.current.full).toBe(true);
    expect(result.current.collapsed).toBe(false);
    expect(JSON.parse(localStorage.getItem("endgame.dock.u1") ?? "{}")).toEqual({ wide: true, collapsed: false });
    // Someone else on this tab gets their own layout, not the last person's.
    rerender({ person: "u2" });
    expect(result.current.wide).toBe(window.innerWidth >= WIDE_FROM);
    expect(result.current.collapsed).toBe(false);
  });
});
